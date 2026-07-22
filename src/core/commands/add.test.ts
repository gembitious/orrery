import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';

// 실제 git: printf 'hello' | git hash-object --stdin
const BLOB_HELLO = 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0';

describe('git add <file>', () => {
  it('blob을 만들어 object store에 넣고 index를 갱신한다', () => {
    const repo = run(['git init', 'echo hello > f.txt']);
    const result = execute(repo, 'git add f.txt');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([]); // 실제 git add는 침묵
    expect(result.repo.objects.get(BLOB_HELLO)).toEqual({ type: 'blob', content: 'hello' });
    expect(result.repo.index.get('f.txt')).toEqual({ name: 'f.txt', sha: BLOB_HELLO });
    expect(result.diff.createdObjects).toEqual([BLOB_HELLO]);
    expect(result.diff.indexChanges).toEqual([{ file: 'f.txt', kind: 'staged' }]);
  });

  it('같은 스냅샷을 다시 add하면 no-op (diff 없음)', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git add f.txt');
    expect(result.diff.createdObjects).toEqual([]);
    expect(result.diff.indexChanges).toEqual([]);
  });

  it('add는 그 시점의 스냅샷 — add 후 수정해도 index는 이전 blob을 가리킨다', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt', 'echo v2 > f.txt']);
    expect(repo.index.get('f.txt')?.sha).toBe(BLOB_HELLO);
    expect(repo.workingTree.get('f.txt')).toBe('v2');
  });

  it('수정 후 다시 add하면 index가 새 blob으로 바뀌고 이전 blob도 남는다', () => {
    const before = run(['git init', 'echo hello > f.txt', 'git add f.txt', 'echo v2 > f.txt']);
    const result = execute(before, 'git add f.txt');

    const newSha = result.repo.index.get('f.txt')?.sha;
    expect(newSha).not.toBe(BLOB_HELLO);
    expect(result.diff.indexChanges).toEqual([{ file: 'f.txt', kind: 'modified' }]);
    // git은 대체된 loose object를 지우지 않는다
    expect(result.repo.objects.has(BLOB_HELLO)).toBe(true);
  });

  it('내용이 같은 두 파일은 blob 하나를 공유한다 (content-addressed)', () => {
    const repo = run(['git init', 'echo hello > a.txt', 'echo hello > b.txt', 'git add a.txt b.txt']);
    expect(repo.index.get('a.txt')?.sha).toBe(BLOB_HELLO);
    expect(repo.index.get('b.txt')?.sha).toBe(BLOB_HELLO);
    expect(repo.objects.size).toBe(1);
  });

  it('working tree에서 지워진(index에 있는) 파일을 add하면 삭제가 staged된다', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt', 'rm f.txt']);
    const result = execute(repo, 'git add f.txt');
    expect(result.error).toBeUndefined();
    expect(result.repo.index.has('f.txt')).toBe(false);
    expect(result.diff.indexChanges).toEqual([{ file: 'f.txt', kind: 'unstaged' }]);
  });
});

describe('git add .', () => {
  it('working tree의 모든 파일을 stage한다', () => {
    const repo = run(['git init', 'echo a > a.txt', 'echo b > b.txt', 'git add .']);
    expect(repo.index.size).toBe(2);
    expect(repo.index.has('a.txt')).toBe(true);
    expect(repo.index.has('b.txt')).toBe(true);
  });

  it('삭제도 함께 stage한다', () => {
    const repo = run([
      'git init',
      'echo a > a.txt',
      'echo b > b.txt',
      'git add .',
      'rm a.txt',
    ]);
    const result = execute(repo, 'git add .');
    expect(result.repo.index.has('a.txt')).toBe(false);
    expect(result.repo.index.has('b.txt')).toBe(true);
  });

  it('빈 디렉터리에서는 조용히 성공한다', () => {
    const result = execute(run(['git init']), 'git add .');
    expect(result.error).toBeUndefined();
    expect(result.diff.indexChanges).toEqual([]);
  });
});

describe('git add 에러 경로', () => {
  it('없는 파일이면 실제 git의 pathspec fatal', () => {
    const repo = run(['git init']);
    expect(execute(repo, 'git add ghost.txt').error).toBe(
      "fatal: pathspec 'ghost.txt' did not match any files",
    );
  });

  it('pathspec 실패는 원자적 — 존재하는 파일도 stage되지 않는다', () => {
    const repo = run(['git init', 'echo a > a.txt']);
    const result = execute(repo, 'git add a.txt ghost.txt');
    expect(result.error).toBeDefined();
    expect(result.repo).toBe(repo);
    expect(result.repo.index.size).toBe(0);
  });

  it('인자가 없으면 실제 git 문구', () => {
    expect(execute(run(['git init']), 'git add').error).toBe(
      'Nothing specified, nothing added.',
    );
  });

  it('미지원 옵션은 명시적 에러', () => {
    expect(execute(run(['git init']), 'git add -A').error).toMatch(/'-A'.*지원하지 않습니다/);
  });

  it('init 전에는 not a git repository', () => {
    const repo = run(['echo a > a.txt']);
    expect(execute(repo, 'git add a.txt').error).toMatch(/not a git repository/);
  });
});

describe('불변성', () => {
  it('add는 원본 Repository를 수정하지 않는다', () => {
    const before = run(['git init', 'echo hello > f.txt']);
    execute(before, 'git add f.txt');
    expect(before.index.size).toBe(0);
    expect(before.objects.size).toBe(0);
  });
});
