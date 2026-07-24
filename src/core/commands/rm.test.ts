import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('git rm --cached', () => {
  it('index에서만 제거 — 삭제가 staged되고 WT 파일은 untracked가 된다', () => {
    const result = execute(run(BASE), 'git rm --cached f.txt');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(["rm 'f.txt'"]);
    expect(result.repo.index.has('f.txt')).toBe(false);
    expect(result.repo.workingTree.get('f.txt')).toBe('hello'); // WT 유지
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'f.txt', index: 'deleted', worktree: 'untracked' },
    ]);
    expect(result.diff.indexChanges).toEqual([{ file: 'f.txt', kind: 'unstaged' }]);
  });

  it('아직 커밋 안 된 staged 파일도 제거된다 (WT 내용과 같으므로 안전)', () => {
    const repo = run(['git init', 'echo a > a.txt', 'git add a.txt']);
    const result = execute(repo, 'git rm --cached a.txt');
    expect(result.error).toBeUndefined();
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'a.txt', worktree: 'untracked' },
    ]);
  });

  it('여러 파일이면 rm 줄이 파일마다 나온다', () => {
    const repo = run([...BASE, 'echo b > g.txt', 'git add g.txt']);
    const result = execute(repo, 'git rm --cached f.txt g.txt');
    expect(result.output).toEqual(["rm 'f.txt'", "rm 'g.txt'"]);
    expect(result.repo.index.size).toBe(0);
  });

  it('index에 없는 파일(untracked 포함)은 pathspec fatal', () => {
    expect(execute(run(BASE), 'git rm --cached nope.txt').error).toBe(
      "fatal: pathspec 'nope.txt' did not match any files",
    );
    const repo = run([...BASE, 'echo u > u.txt']);
    expect(execute(repo, 'git rm --cached u.txt').error).toMatch(/pathspec 'u.txt'/);
  });

  it('안전장치: staged 내용이 HEAD와도 WT와도 다르면 거부, -f로 강제', () => {
    const repo = run([...BASE, 'echo v2 > f.txt', 'git add f.txt', 'echo v3 > f.txt']);
    const blocked = execute(repo, 'git rm --cached f.txt');
    expect(blocked.error).toBe(
      'error: the following file has staged content different from both the\n' +
        'file and the HEAD:\n    f.txt\n(use -f to force removal)',
    );
    expect(blocked.repo).toBe(repo);

    const forced = execute(repo, 'git rm --cached -f f.txt');
    expect(forced.error).toBeUndefined();
    expect(forced.repo.index.has('f.txt')).toBe(false);
  });

  it('--cached 없는 git rm은 가상 rm을 안내하며 거부', () => {
    expect(execute(run(BASE), 'git rm f.txt').error).toMatch(/--cached만 지원/);
  });
});
