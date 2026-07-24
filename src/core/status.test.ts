import { describe, expect, it } from 'vitest';
import { execute } from '../command/execute';
import { run } from '../command/run';
import { computeStatus } from './status';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const COMMITTED = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('computeStatus — 3영역 비교', () => {
  it('깨끗한 상태', () => {
    const status = computeStatus(run(COMMITTED));
    expect(status).toEqual({
      branch: 'main',
      initial: false,
      merging: false,
      entries: [],
      clean: true,
    });
  });

  it('untracked: working tree에만 있는 파일', () => {
    const status = computeStatus(run(['git init', 'echo a > new.txt']));
    expect(status.entries).toEqual([{ file: 'new.txt', worktree: 'untracked' }]);
    expect(status.initial).toBe(true);
  });

  it('staged new file: index에는 있고 HEAD에는 없다', () => {
    const status = computeStatus(run(['git init', 'echo a > f.txt', 'git add f.txt']));
    expect(status.entries).toEqual([{ file: 'f.txt', index: 'added' }]);
  });

  it('modified (unstaged): 커밋된 파일을 수정만 한 상태', () => {
    const status = computeStatus(run([...COMMITTED, 'echo v2 > f.txt']));
    expect(status.entries).toEqual([{ file: 'f.txt', worktree: 'modified' }]);
  });

  it('staged modified: 수정하고 add까지 한 상태', () => {
    const status = computeStatus(run([...COMMITTED, 'echo v2 > f.txt', 'git add f.txt']));
    expect(status.entries).toEqual([{ file: 'f.txt', index: 'modified' }]);
  });

  it('staged+modified: add 후 또 수정 — 한 파일이 양쪽에 동시에 나타난다', () => {
    const status = computeStatus(
      run([...COMMITTED, 'echo v2 > f.txt', 'git add f.txt', 'echo v3 > f.txt']),
    );
    expect(status.entries).toEqual([{ file: 'f.txt', index: 'modified', worktree: 'modified' }]);
  });

  it('unstaged 삭제: rm만 한 상태', () => {
    const status = computeStatus(run([...COMMITTED, 'rm f.txt']));
    expect(status.entries).toEqual([{ file: 'f.txt', worktree: 'deleted' }]);
  });

  it('staged 삭제: rm 후 add', () => {
    const status = computeStatus(run([...COMMITTED, 'rm f.txt', 'git add f.txt']));
    expect(status.entries).toEqual([{ file: 'f.txt', index: 'deleted' }]);
  });

  it('staged 삭제 + 재생성: HEAD에 있던 파일도 index에서 빠지면 untracked', () => {
    const status = computeStatus(
      run([...COMMITTED, 'rm f.txt', 'git add f.txt', 'echo back > f.txt']),
    );
    expect(status.entries).toEqual([{ file: 'f.txt', index: 'deleted', worktree: 'untracked' }]);
  });

  it('add 안 하고 원래 내용으로 되돌리면 clean (내용 기반 비교)', () => {
    const status = computeStatus(run([...COMMITTED, 'echo v2 > f.txt', 'echo hello > f.txt']));
    expect(status.clean).toBe(true);
  });

  it('detached HEAD', () => {
    const repo = { ...run(COMMITTED), head: { kind: 'detached', sha: C1 } as const };
    const status = computeStatus(repo);
    expect(status.branch).toBeUndefined();
    expect(status.detachedAt).toBe(C1);
  });

  it('엔트리는 파일명순으로 정렬된다', () => {
    const status = computeStatus(run(['git init', 'echo 1 > z.txt', 'echo 2 > a.txt']));
    expect(status.entries.map((e) => e.file)).toEqual(['a.txt', 'z.txt']);
  });
});

describe('git status 출력', () => {
  it('init 직후: No commits yet', () => {
    expect(execute(run(['git init']), 'git status').output).toEqual([
      'On branch main',
      '',
      'No commits yet',
      '',
      'nothing to commit (create/copy files and use "git add" to track)',
    ]);
  });

  it('첫 커밋 전 staged: rm --cached 힌트와 new file 라벨', () => {
    const repo = run(['git init', 'echo a > f.txt', 'git add f.txt']);
    expect(execute(repo, 'git status').output).toEqual([
      'On branch main',
      '',
      'No commits yet',
      '',
      'Changes to be committed:',
      '  (use "git rm --cached <file>..." to unstage)',
      '\tnew file:   f.txt',
    ]);
  });

  it('세 섹션이 모두 나오는 경우', () => {
    const repo = run([
      ...COMMITTED,
      'echo v2 > f.txt',
      'git add f.txt', // staged: modified
      'echo v3 > f.txt', // unstaged: modified
      'echo new > untracked.txt',
    ]);
    expect(execute(repo, 'git status').output).toEqual([
      'On branch main',
      'Changes to be committed:',
      '  (use "git restore --staged <file>..." to unstage)',
      '\tmodified:   f.txt',
      '',
      'Changes not staged for commit:',
      '  (use "git add <file>..." to update what will be committed)',
      '  (use "git restore <file>..." to discard changes in working directory)',
      '\tmodified:   f.txt',
      '',
      'Untracked files:',
      '  (use "git add <file>..." to include in what will be committed)',
      '\tuntracked.txt',
    ]);
  });

  it('unstaged 삭제와 요약 줄', () => {
    const repo = run([...COMMITTED, 'rm f.txt']);
    expect(execute(repo, 'git status').output).toEqual([
      'On branch main',
      'Changes not staged for commit:',
      '  (use "git add <file>..." to update what will be committed)',
      '  (use "git restore <file>..." to discard changes in working directory)',
      '\tdeleted:    f.txt',
      '',
      'no changes added to commit (use "git add" and/or "git commit -a")',
    ]);
  });

  it('untracked만 있으면 untracked 요약 줄', () => {
    const repo = run([...COMMITTED, 'echo x > new.txt']);
    const output = execute(repo, 'git status').output;
    expect(output[output.length - 1]).toBe(
      'nothing added to commit but untracked files present (use "git add" to track)',
    );
  });

  it('깨끗하면 working tree clean', () => {
    expect(execute(run(COMMITTED), 'git status').output).toEqual([
      'On branch main',
      'nothing to commit, working tree clean',
    ]);
  });

  it('detached HEAD 헤더', () => {
    const repo = { ...run(COMMITTED), head: { kind: 'detached', sha: C1 } as const };
    expect(execute(repo, 'git status').output[0]).toBe('HEAD detached at 370125d');
  });

  it('status는 상태를 바꾸지 않는다', () => {
    const repo = run([...COMMITTED, 'echo v2 > f.txt']);
    const result = execute(repo, 'git status');
    expect(result.repo).toBe(repo);
    expect(result.diff.indexChanges).toEqual([]);
  });

  it('미지원 인자는 명시적 에러', () => {
    expect(execute(run(COMMITTED), 'git status -s').error).toMatch(/'-s'.*지원하지 않습니다/);
  });
});
