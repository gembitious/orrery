import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { getCommit } from '../revision';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo base > f.txt', 'git add .', 'git commit -m c1'];
// feature에 fx(x.txt 추가), fy(y.txt 추가) — main은 c1에 머묾
const SETUP = [
  ...BASE,
  'git checkout -b feature',
  'echo x > x.txt', 'git add .', 'git commit -m fx',
  'echo y > y.txt', 'git add .', 'git commit -m fy',
  'git checkout main',
];

function fxShaOf(repo: ReturnType<typeof run>): string {
  const tip = repo.refs.get('refs/heads/feature') ?? '';
  return getCommit(repo, tip).parents[0]; // fy의 부모 = fx
}

describe('git cherry-pick', () => {
  it('한 커밋의 변경분만 HEAD 위에 새 커밋으로 재적용된다', () => {
    const before = run(SETUP);
    const fx = fxShaOf(before);
    const result = execute(before, `git cherry-pick ${fx.slice(0, 7)}`);

    expect(result.error).toBeUndefined();
    const repo = result.repo;
    const picked = getCommit(repo, repo.refs.get('refs/heads/main') ?? '');
    expect(picked.message).toBe('fx\n');
    expect(picked.parents).toEqual([before.refs.get('refs/heads/main')]);
    expect(repo.workingTree.get('x.txt')).toBe('x'); // fx의 변경만
    expect(repo.workingTree.has('y.txt')).toBe(false); // fy는 안 왔다
    expect(computeStatus(repo).clean).toBe(true);
    // 출력: 커밋 요약 + 원본 author 날짜
    expect(result.output[0]).toMatch(/^\[main [0-9a-f]{7}\] fx$/);
    expect(result.output[1]).toMatch(/^ Date: Thu Jan 1 00:00:0\d 1970 \+0000$/);
    // 원본과 다른 해시 (부모가 다르므로)
    expect(repo.refs.get('refs/heads/main')).not.toBe(fx);
    expect(getCommit(repo, repo.refs.get('refs/heads/main') ?? '').author.timestamp).toBe(
      getCommit(before, fx).author.timestamp, // author 유지
    );
  });

  it('머지 커밋은 -m이 없으므로 거부 (실제 git 문구)', () => {
    const repo = run([
      ...SETUP,
      'echo m > m.txt', 'git add .', 'git commit -m m1',
      'git merge feature',
      'git checkout feature', // 머지 커밋이 HEAD가 아닌 곳에서 pick 시도
    ]);
    const mergeSha = repo.refs.get('refs/heads/main') ?? '';
    const result = execute(repo, `git cherry-pick ${mergeSha.slice(0, 7)}`);
    expect(result.error).toBe(
      `error: commit ${mergeSha} is a merge but no -m option was given.\nfatal: cherry-pick failed`,
    );
  });

  it('충돌이 나면 취소된다 (상태 불변)', () => {
    const repo = run([
      ...BASE,
      'git checkout -b clash',
      'echo A > f.txt', 'git add .', 'git commit -m ca',
      'git checkout main',
      'echo B > f.txt', 'git add .', 'git commit -m cb',
    ]);
    const ca = repo.refs.get('refs/heads/clash') ?? '';
    const result = execute(repo, `git cherry-pick ${ca.slice(0, 7)}`);
    expect(result.error).toContain('CONFLICT (content): Merge conflict in f.txt');
    expect(result.error).toMatch(/error: could not apply [0-9a-f]{7}\.\.\. ca/);
    expect(result.repo).toBe(repo);
  });

  it('이미 적용된 변경이면 empty 거부', () => {
    const before = run(SETUP);
    const fx = fxShaOf(before);
    const once = execute(before, `git cherry-pick ${fx.slice(0, 7)}`).repo;
    const result = execute(once, `git cherry-pick ${fx.slice(0, 7)}`);
    expect(result.error).toBe(
      'The previous cherry-pick is now empty, possibly due to conflict resolution.',
    );
  });

  it('무관한 로컬 변경은 pick을 넘어 살아남는다', () => {
    const before = run([...SETUP, 'echo note > note.txt']); // untracked
    const result = execute(before, `git cherry-pick ${fxShaOf(before).slice(0, 7)}`);
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('note.txt')).toBe('note');
  });

  it('dirty 상태는 거부', () => {
    const dirty = run([...SETUP, 'echo d > f.txt']);
    expect(execute(dirty, `git cherry-pick ${fxShaOf(dirty).slice(0, 7)}`).error).toMatch(
      /^error: cannot cherry-pick: You have unstaged changes\./,
    );
  });

  it('모르는 대상은 bad revision', () => {
    expect(execute(run(BASE), 'git cherry-pick zzz').error).toBe("fatal: bad revision 'zzz'");
  });
});
