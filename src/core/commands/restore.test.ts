import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('git restore <file> — WT ← index', () => {
  it('수정된 파일을 index의 내용으로 되돌린다', () => {
    const repo = run([...BASE, 'echo v2 > f.txt']);
    const result = execute(repo, 'git restore f.txt');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([]); // 성공 시 침묵
    expect(result.repo.workingTree.get('f.txt')).toBe('hello');
    expect(computeStatus(result.repo).clean).toBe(true);
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'modified' }]);
    expect(result.diff.indexChanges).toEqual([]);
  });

  it('WT에서 지운 파일을 재생성한다', () => {
    const repo = run([...BASE, 'rm f.txt']);
    const result = execute(repo, 'git restore f.txt');
    expect(result.repo.workingTree.get('f.txt')).toBe('hello');
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'created' }]);
  });

  it('복원 기준은 HEAD가 아니라 index다 (staged 스냅샷으로 돌아간다)', () => {
    const repo = run([...BASE, 'echo v2 > f.txt', 'git add f.txt', 'echo v3 > f.txt']);
    const result = execute(repo, 'git restore f.txt');
    expect(result.repo.workingTree.get('f.txt')).toBe('v2'); // HEAD의 hello가 아니다
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'f.txt', index: 'modified' }]);
  });

  it("'.'은 index의 모든 파일을 복원한다", () => {
    const repo = run([
      ...BASE,
      'echo world > g.txt', 'git add g.txt',
      'echo x > f.txt', 'echo y > g.txt',
    ]);
    const result = execute(repo, 'git restore .');
    expect(result.repo.workingTree.get('f.txt')).toBe('hello');
    expect(result.repo.workingTree.get('g.txt')).toBe('world');
  });

  it('index에 없는 파일은 pathspec 에러 (untracked, staged 삭제 포함)', () => {
    expect(execute(run(BASE), 'git restore nope.txt').error).toBe(
      "error: pathspec 'nope.txt' did not match any file(s) known to git",
    );
    const untracked = run([...BASE, 'echo x > un.txt']);
    expect(execute(untracked, 'git restore un.txt').error).toMatch(/pathspec 'un.txt'/);
    const stagedDel = run([...BASE, 'rm f.txt', 'git add f.txt']);
    expect(execute(stagedDel, 'git restore f.txt').error).toMatch(/pathspec 'f.txt'/);
  });

  it('unborn 저장소에서도 index만 있으면 동작한다', () => {
    const repo = run(['git init', 'echo a > a.txt', 'git add a.txt', 'echo b > a.txt']);
    const result = execute(repo, 'git restore a.txt');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('a.txt')).toBe('a');
  });
});

describe('git restore --staged <file> — index ← HEAD', () => {
  it('staged 수정을 HEAD의 내용으로 되돌린다 (WT는 그대로)', () => {
    const repo = run([...BASE, 'echo v2 > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git restore --staged f.txt');

    expect(result.error).toBeUndefined();
    expect(result.repo.index.get('f.txt')?.sha).toBe(
      run(BASE).index.get('f.txt')?.sha, // HEAD 시점의 blob
    );
    expect(result.repo.workingTree.get('f.txt')).toBe('v2'); // WT는 안 건드린다
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'f.txt', worktree: 'modified' }]);
    expect(result.diff.indexChanges).toEqual([{ file: 'f.txt', kind: 'modified' }]);
    expect(result.diff.workingTreeChanges).toEqual([]);
  });

  it('HEAD에 없는 새 파일의 staging을 취소하면 untracked로 돌아간다', () => {
    const repo = run([...BASE, 'echo y > new.txt', 'git add new.txt']);
    const result = execute(repo, 'git restore --staged new.txt');
    expect(result.repo.index.has('new.txt')).toBe(false);
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'new.txt', worktree: 'untracked' },
    ]);
    expect(result.diff.indexChanges).toEqual([{ file: 'new.txt', kind: 'unstaged' }]);
  });

  it('staged 삭제를 되돌리면 index에 파일이 복원된다', () => {
    const repo = run([...BASE, 'rm f.txt', 'git add f.txt']);
    const result = execute(repo, 'git restore --staged f.txt');
    expect(result.repo.index.has('f.txt')).toBe(true);
    // WT에는 여전히 없다 → unstaged 삭제 상태가 된다
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'f.txt', worktree: 'deleted' }]);
  });

  it('restore --staged 후 restore로 파일을 완전히 되살리는 2단계 흐름', () => {
    const repo = run([...BASE, 'rm f.txt', 'git add f.txt',
      'git restore --staged f.txt', 'git restore f.txt']);
    expect(repo.workingTree.get('f.txt')).toBe('hello');
    expect(computeStatus(repo).clean).toBe(true);
  });

  it('unborn HEAD에서는 실제 git 문구로 실패', () => {
    const repo = run(['git init', 'echo a > a.txt', 'git add a.txt']);
    expect(execute(repo, 'git restore --staged a.txt').error).toBe(
      'fatal: could not resolve HEAD',
    );
  });
});

describe('restore 파싱', () => {
  it('경로가 없으면 실제 git 문구', () => {
    expect(execute(run(BASE), 'git restore').error).toBe(
      'fatal: you must specify path(s) to restore',
    );
    expect(execute(run(BASE), 'git restore --staged').error).toBe(
      'fatal: you must specify path(s) to restore',
    );
  });

  it('미지원 옵션', () => {
    expect(execute(run(BASE), 'git restore --source=HEAD~1 f.txt').error).toMatch(
      /'--source=HEAD~1'.*지원하지 않습니다/,
    );
  });

  it('실패 시 상태 불변', () => {
    const repo = run(BASE);
    expect(execute(repo, 'git restore nope.txt').repo).toBe(repo);
  });
});
