import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { getCommit } from '../revision';
import { computeStatus } from '../status';

const BASE = [
  'git init',
  'echo hello > f.txt', 'echo keep > s.txt', 'git add .', 'git commit -m c1',
];
// 혼합 상태: staged 수정(f), unstaged 수정(s), 새 staged(n), untracked(u)
const MIXED = [
  ...BASE,
  'echo f2 > f.txt', 'git add f.txt',
  'echo s2 > s.txt',
  'echo n1 > n.txt', 'git add n.txt',
  'echo u1 > u.txt',
];

describe('git stash', () => {
  it('stash의 실체: index 커밋 + WIP 커밋(부모 2개, 머지 모양)', () => {
    const result = execute(run(MIXED), 'git stash');
    expect(result.error).toBeUndefined();

    const repo = result.repo;
    expect(repo.stashes.length).toBe(1);
    const wip = getCommit(repo, repo.stashes[0]);
    expect(wip.parents.length).toBe(2);
    expect(wip.parents[0]).toBe(repo.refs.get('refs/heads/main')); // base = HEAD
    expect(wip.message).toMatch(/^WIP on main: [0-9a-f]{7} c1\n$/);

    const indexCommit = getCommit(repo, wip.parents[1]);
    expect(indexCommit.parents).toEqual([wip.parents[0]]);
    expect(indexCommit.message).toMatch(/^index on main: [0-9a-f]{7} c1\n$/);
  });

  it('stash 후 WT/index는 HEAD로 돌아가고 untracked만 남는다', () => {
    const result = execute(run(MIXED), 'git stash');
    const repo = result.repo;
    expect(repo.workingTree.get('f.txt')).toBe('hello');
    expect(repo.workingTree.get('s.txt')).toBe('keep');
    expect(repo.workingTree.has('n.txt')).toBe(false);
    expect(repo.workingTree.get('u.txt')).toBe('u1'); // untracked 보존
    expect(computeStatus(repo).entries).toEqual([{ file: 'u.txt', worktree: 'untracked' }]);
    expect(result.output).toEqual([
      `Saved working directory and index state ${getCommit(repo, repo.stashes[0]).message.split('\n')[0].replace('WIP', 'WIP')}`,
    ]);
  });

  it('변경이 없으면(untracked만 있어도) No local changes to save', () => {
    expect(execute(run(BASE), 'git stash').output).toEqual(['No local changes to save']);
    const untrackedOnly = run([...BASE, 'echo u > u.txt']);
    const result = execute(untrackedOnly, 'git stash');
    expect(result.output).toEqual(['No local changes to save']);
    expect(result.repo).toBe(untrackedOnly);
  });

  it('unborn 저장소에서는 실패', () => {
    expect(execute(run(['git init', 'echo a > a.txt', 'git add a.txt']), 'git stash').error).toBe(
      'You do not have the initial commit yet',
    );
  });

  it('같은 시퀀스는 같은 stash 해시 (결정론)', () => {
    const a = execute(run(MIXED), 'git stash').repo.stashes[0];
    const b = execute(run(MIXED), 'git stash').repo.stashes[0];
    expect(a).toBe(b);
  });
});

describe('git stash list', () => {
  it('최신이 stash@{0}', () => {
    const repo = run([
      ...BASE,
      'echo v2 > f.txt', 'git stash',
      'echo v3 > f.txt', 'git stash',
    ]);
    const output = execute(repo, 'git stash list').output;
    expect(output.length).toBe(2);
    expect(output[0]).toMatch(/^stash@\{0\}: WIP on main: [0-9a-f]{7} c1$/);
    expect(output[1]).toMatch(/^stash@\{1\}: WIP on main: [0-9a-f]{7} c1$/);
  });

  it('비어 있으면 출력 없음', () => {
    expect(execute(run(BASE), 'git stash list').output).toEqual([]);
  });
});

describe('git stash pop', () => {
  it('수정은 unstaged로, 새 파일은 staged로 복원된다 (실제 git 동작)', () => {
    const stashed = execute(run(MIXED), 'git stash').repo;
    const result = execute(stashed, 'git stash pop');

    expect(result.error).toBeUndefined();
    const status = computeStatus(result.repo);
    expect(status.entries).toEqual([
      { file: 'f.txt', worktree: 'modified' }, // staged였지만 평탄화
      { file: 'n.txt', index: 'added' }, // 새 파일은 다시 staged
      { file: 's.txt', worktree: 'modified' },
      { file: 'u.txt', worktree: 'untracked' },
    ]);
    expect(result.repo.workingTree.get('f.txt')).toBe('f2');
    expect(result.repo.workingTree.get('n.txt')).toBe('n1');
    expect(result.repo.stashes).toEqual([]);
    // 출력 = 적용 후 status 전체 + Dropped 줄
    expect(result.output[0]).toBe('On branch main');
    expect(result.output[result.output.length - 1]).toBe(
      `Dropped refs/stash@{0} (${stashed.stashes[0]})`,
    );
  });

  it('WT 삭제도 stash/pop을 왕복한다', () => {
    const stashed = execute(run([...BASE, 'rm s.txt']), 'git stash').repo;
    expect(stashed.workingTree.get('s.txt')).toBe('keep'); // stash가 복원
    const result = execute(stashed, 'git stash pop');
    expect(result.repo.workingTree.has('s.txt')).toBe(false); // pop이 삭제를 재적용
    expect(computeStatus(result.repo).entries).toEqual([{ file: 's.txt', worktree: 'deleted' }]);
  });

  it('빈 stash pop', () => {
    expect(execute(run(BASE), 'git stash pop').error).toBe('No stash entries found.');
  });

  it('적용 대상 파일에 로컬 변경이 있으면 거부하고 stash를 유지한다', () => {
    const stashed = execute(run([...BASE, 'echo v2 > f.txt']), 'git stash').repo;
    const dirty = execute(stashed, 'echo local > f.txt').repo;
    const result = execute(dirty, 'git stash pop');
    expect(result.error).toBe(
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        '\tf.txt\n' +
        'Please commit your changes or stash them before you merge.\nAborting\n' +
        'The stash entry is kept in case you need it again.',
    );
    expect(result.repo).toBe(dirty);
    expect(result.repo.stashes.length).toBe(1);
  });

  it('다른 커밋 위에서도 충돌이 없으면 pop된다', () => {
    const repo = run([
      ...BASE,
      'echo v2 > f.txt', 'git stash',
      'echo w > w.txt', 'git add w.txt', 'git commit -m c2',
      'git stash pop',
    ]);
    expect(repo.workingTree.get('f.txt')).toBe('v2');
    expect(repo.stashes).toEqual([]);
  });
});

describe('detached HEAD에서의 stash', () => {
  it('메시지가 (no branch)로 나온다', () => {
    const base = run(BASE);
    const c1 = base.refs.get('refs/heads/main') ?? '';
    const detached = run(['echo v2 > f.txt'], { ...base, head: { kind: 'detached', sha: c1 } });
    const result = execute(detached, 'git stash');
    expect(result.output[0]).toMatch(/^Saved working directory and index state WIP on \(no branch\):/);
  });
});
