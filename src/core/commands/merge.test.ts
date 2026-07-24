import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { getCommit } from '../revision';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo base > f.txt', 'git add .', 'git commit -m c1'];
// feature가 g.txt를 추가하고, main은 c1에 머문 상태 → FF 가능
const FF_READY = [
  ...BASE,
  'git checkout -b feature',
  'echo feat > g.txt', 'git add .', 'git commit -m feat1',
  'git checkout main',
];
// 양쪽이 서로 다른 파일을 추가 → 3-way
const DIVERGED = [
  ...FF_READY.slice(0, -1), // feature에 feat1까지
  'git checkout main',
  'echo m > m.txt', 'git add .', 'git commit -m m1',
];

describe('fast-forward', () => {
  it('커밋을 만들지 않고 브랜치 포인터만 민다', () => {
    const before = run(FF_READY);
    const featSha = before.refs.get('refs/heads/feature') ?? '';
    const result = execute(before, 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([
      `Updating ${(before.refs.get('refs/heads/main') ?? '').slice(0, 7)}..${featSha.slice(0, 7)}`,
      'Fast-forward',
    ]);
    expect(result.repo.refs.get('refs/heads/main')).toBe(featSha);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/main' });
    expect(result.repo.workingTree.get('g.txt')).toBe('feat');
    expect(result.repo.objects.size).toBe(before.objects.size); // 새 객체 없음
    expect(result.diff.movedRefs).toEqual([
      { ref: 'refs/heads/main', from: before.refs.get('refs/heads/main'), to: featSha },
    ]);
    expect(computeStatus(result.repo).clean).toBe(true);
  });

  it('무관한 로컬 변경은 FF를 넘어 살아남는다 (checkout 규칙)', () => {
    const repo = run([...FF_READY, 'echo dirty > f.txt']);
    const result = execute(repo, 'git merge feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('f.txt')).toBe('dirty');
    expect(result.repo.workingTree.get('g.txt')).toBe('feat');
  });

  it('이미 포함된 대상은 Already up to date.', () => {
    const merged = run([...FF_READY, 'git merge feature']);
    const result = execute(merged, 'git merge feature');
    expect(result.output).toEqual(['Already up to date.']);
    expect(result.repo).toBe(merged);
  });
});

describe('3-way merge', () => {
  it('부모 2개짜리 머지 커밋을 만들고 양쪽 변경을 합친다', () => {
    const before = run(DIVERGED);
    const mainSha = before.refs.get('refs/heads/main') ?? '';
    const featSha = before.refs.get('refs/heads/feature') ?? '';
    const result = execute(before, 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(["Merge made by the 'ort' strategy."]);

    const mergeSha = result.repo.refs.get('refs/heads/main') ?? '';
    const merge = getCommit(result.repo, mergeSha);
    expect(merge.parents).toEqual([mainSha, featSha]); // ours가 첫 부모
    expect(merge.message).toBe("Merge branch 'feature'\n");
    // 양쪽 변경이 모두 반영
    expect(result.repo.workingTree.get('m.txt')).toBe('m');
    expect(result.repo.workingTree.get('g.txt')).toBe('feat');
    expect(result.repo.workingTree.get('f.txt')).toBe('base');
    expect(computeStatus(result.repo).clean).toBe(true);
  });

  it('main이 아닌 브랜치로 머지하면 into가 붙는다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b dev',
      'git checkout -b side',
      'echo s > s.txt', 'git add .', 'git commit -m s1',
      'git checkout dev',
      'echo d > d.txt', 'git add .', 'git commit -m d1',
    ]);
    const result = execute(repo, 'git merge side');
    const merge = getCommit(result.repo, result.repo.refs.get('refs/heads/dev') ?? '');
    expect(merge.message).toBe("Merge branch 'side' into dev\n");
  });

  it('한쪽의 삭제는 그대로 반영된다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b cleanup',
      'rm f.txt', 'git add f.txt', 'git commit -m del-f',
      'git checkout main',
      'echo m > m.txt', 'git add .', 'git commit -m m1',
    ]);
    const result = execute(repo, 'git merge cleanup');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.has('f.txt')).toBe(false);
    expect(result.repo.index.has('f.txt')).toBe(false);
  });

  it('양쪽이 같은 내용으로 바꿨으면 충돌이 아니다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b same',
      'echo agreed > f.txt', 'git add .', 'git commit -m a1',
      'git checkout main',
      'echo agreed > f.txt', 'git add .', 'git commit -m a2',
    ]);
    const result = execute(repo, 'git merge same');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('f.txt')).toBe('agreed');
  });

  it('양쪽이 서로 다르게 바꾸면 CONFLICT — 머지 중 상태가 된다 (상세는 conflict.test.ts)', () => {
    const repo = run([
      ...BASE,
      'git checkout -b clash',
      'echo A > f.txt', 'git add .', 'git commit -m ca',
      'git checkout main',
      'echo B > f.txt', 'git add .', 'git commit -m cb',
    ]);
    const result = execute(repo, 'git merge clash');
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('CONFLICT (content): Merge conflict in f.txt');
    expect(result.repo.merging).toBeDefined();
    expect(result.repo.index.get('f.txt')?.conflicted).toBe(true);
  });

  it('staged 변경이 있으면 ort 전략 거부', () => {
    const repo = run([...DIVERGED, 'echo x > staged.txt', 'git add staged.txt']);
    const result = execute(repo, 'git merge feature');
    expect(result.error).toBe(
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        '  staged.txt\n' +
        'Merge with strategy ort failed.',
    );
  });

  it('머지가 건드릴 파일의 unstaged 변경은 거부, 무관한 파일은 허용', () => {
    const touched = run([...DIVERGED, 'echo local > g.txt']); // g.txt는 feature가 가져올 파일
    const blocked = execute(touched, 'git merge feature');
    expect(blocked.error).toContain('would be overwritten by merge');
    expect(blocked.error).toContain('\tg.txt');

    const unrelated = run([...DIVERGED, 'echo local > f.txt']); // f.txt는 양쪽 동일
    const ok = execute(unrelated, 'git merge feature');
    expect(ok.error).toBeUndefined();
    expect(ok.repo.workingTree.get('f.txt')).toBe('local'); // 로컬 변경 유지
  });

  it('같은 시퀀스는 같은 머지 커밋 해시 (결정론)', () => {
    const a = execute(run(DIVERGED), 'git merge feature').repo.refs.get('refs/heads/main');
    const b = execute(run(DIVERGED), 'git merge feature').repo.refs.get('refs/heads/main');
    expect(a).toBe(b);
  });
});

describe('merge 에러 경로', () => {
  it('모르는 대상 / unborn', () => {
    expect(execute(run(BASE), 'git merge zzz').error).toBe(
      'merge: zzz - not something we can merge',
    );
    expect(execute(run(['git init']), 'git merge main').error).toBe(
      'merge: main - not something we can merge',
    );
  });

  it('인자가 없거나 옵션이면 안내', () => {
    expect(execute(run(BASE), 'git merge').error).toMatch(/형식으로 입력하세요/);
    expect(execute(run(BASE), 'git merge --no-ff x').error).toMatch(/'--no-ff'.*지원하지 않습니다/);
  });
});
