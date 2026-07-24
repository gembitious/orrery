import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { getCommit } from '../revision';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo base > f.txt', 'git add .', 'git commit -m c1'];
// feature: c1에서 분기해 fx, fy 두 커밋 / main: m1 커밋 → 갈라진 상태
const DIVERGED = [
  ...BASE,
  'git checkout -b feature',
  'echo x > x.txt', 'git add .', 'git commit -m fx',
  'echo y > y.txt', 'git add .', 'git commit -m fy',
  'git checkout main',
  'echo m > m.txt', 'git add .', 'git commit -m m1',
  'git checkout feature',
];

describe('git rebase', () => {
  it('커밋들이 대상 위에 재적용되고 해시가 바뀐다 — 원본은 unreachable로 남는다', () => {
    const before = run(DIVERGED);
    const oldFx = getCommit(before, getCommit(before, before.refs.get('refs/heads/feature') ?? '').parents[0]);
    const oldTip = before.refs.get('refs/heads/feature') ?? '';
    const mainSha = before.refs.get('refs/heads/main') ?? '';

    const result = execute(before, 'git rebase main');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(['Successfully rebased and updated refs/heads/feature.']);

    const repo = result.repo;
    const newTip = repo.refs.get('refs/heads/feature') ?? '';
    expect(newTip).not.toBe(oldTip); // 해시가 바뀌었다

    // 새 체인: fy' → fx' → m1 → c1
    const newFy = getCommit(repo, newTip);
    expect(newFy.message).toBe('fy\n');
    const newFx = getCommit(repo, newFy.parents[0]);
    expect(newFx.message).toBe('fx\n');
    expect(newFx.parents).toEqual([mainSha]); // 대상 위로 옮겨탔다
    expect(newFx.author.timestamp).toBe(oldFx.author.timestamp); // author 유지

    // 원본 커밋들은 여전히 object store에 있다 (unreachable)
    expect(repo.objects.has(oldTip)).toBe(true);
    // working tree는 양쪽 내용을 모두 가진다
    expect(repo.workingTree.get('m.txt')).toBe('m');
    expect(repo.workingTree.get('y.txt')).toBe('y');
    expect(computeStatus(repo).clean).toBe(true);
  });

  it('대상이 이미 조상이면 up to date', () => {
    const repo = run(DIVERGED);
    // feature 위에서 c1(조상)으로 rebase
    const result = execute(repo, 'git rebase HEAD~2');
    expect(result.output).toEqual(['Current branch feature is up to date.']);
    expect(result.repo).toBe(repo);
  });

  it('내가 대상의 조상이면 fast-forward (새 커밋 없음)', () => {
    // main(c1)은 feature(c1←fx)의 조상 — 재적용할 것 없이 포인터만 전진
    const repo = run([
      ...BASE,
      'git checkout -b feature',
      'echo x > x.txt', 'git add .', 'git commit -m fx',
      'git checkout main',
    ]);
    const featSha = repo.refs.get('refs/heads/feature') ?? '';
    const result = execute(repo, 'git rebase feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.refs.get('refs/heads/main')).toBe(featSha);
    expect(result.repo.objects.size).toBe(repo.objects.size);
    expect(result.output).toEqual(['Successfully rebased and updated refs/heads/main.']);
  });

  it('재적용 충돌은 rebase 전체를 취소한다 (상태 불변)', () => {
    const repo = run([
      ...BASE,
      'git checkout -b rc',
      'echo R > f.txt', 'git add .', 'git commit -m rc1',
      'git checkout main',
      'echo M > f.txt', 'git add .', 'git commit -m m2',
      'git checkout rc',
    ]);
    const result = execute(repo, 'git rebase main');
    expect(result.error).toContain('CONFLICT (content): Merge conflict in f.txt');
    expect(result.error).toMatch(/error: could not apply [0-9a-f]{7}\.\.\. rc1/);
    expect(result.repo).toBe(repo);
  });

  it('dirty 상태는 실제 git 문구로 거부', () => {
    const unstaged = run([...DIVERGED, 'echo d > f.txt']);
    expect(execute(unstaged, 'git rebase main').error).toBe(
      'error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.',
    );
    const staged = run([...DIVERGED, 'echo s > s.txt', 'git add s.txt']);
    expect(execute(staged, 'git rebase main').error).toBe(
      'error: cannot rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.',
    );
  });

  it('모르는 대상 / unborn은 invalid upstream', () => {
    expect(execute(run(BASE), 'git rebase zzz').error).toBe("fatal: invalid upstream 'zzz'");
    expect(execute(run(['git init']), 'git rebase main').error).toBe(
      "fatal: invalid upstream 'main'",
    );
  });

  it('머지 커밋이 포함된 구간은 명시적으로 거부', () => {
    const repo = run([
      ...DIVERGED,
      'git merge main', // feature에 머지 커밋 생성
      'git checkout -b other main~0'.replace('~0', ''),
      'git checkout feature',
      'echo z > z.txt', 'git add .', 'git commit -m fz',
      'git checkout main',
      'echo n > n.txt', 'git add .', 'git commit -m m3',
      'git checkout feature',
    ]);
    expect(execute(repo, 'git rebase main').error).toMatch(/머지 커밋이 포함된/);
  });

  it('같은 시퀀스는 같은 재적용 해시 (결정론)', () => {
    const a = execute(run(DIVERGED), 'git rebase main').repo.refs.get('refs/heads/feature');
    const b = execute(run(DIVERGED), 'git rebase main').repo.refs.get('refs/heads/feature');
    expect(a).toBe(b);
  });
});
