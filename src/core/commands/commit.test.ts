import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { resolveHead } from '../repository';

/**
 * known-answer: 아래 값들은 실제 git 2.43으로 동일한 identity(Orrery
 * <orrery@example.com>), 동일한 타임스탬프(@1, @2 +0000), 동일한 내용으로
 * 만든 커밋의 해시다. 명령 시퀀스가 이 해시를 그대로 재현해야 한다 —
 * 결정론적 시뮬레이션 시계의 존재 이유.
 */
const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa'; // tree {f.txt:'hello'}, ts=1, 'c1\n'
const C2 = '87c91b76e9e75bf0619d2e2af2c9eede5603cc8b'; // tree {f.txt,g.txt}, parent C1, ts=2, 'c2\n'
const TREE_C1 = '6d7572818a587501467139ad1ef01aebe98eeb6d';

const FIRST_COMMIT = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('git commit -m', () => {
  it('명령 시퀀스가 실제 git과 동일한 커밋 해시를 만든다 (end-to-end known-answer)', () => {
    const repo = run(FIRST_COMMIT);
    expect(repo.refs.get('refs/heads/main')).toBe(C1);
    expect(resolveHead(repo)).toBe(C1);
  });

  it('두 번째 커밋: 부모 연결과 해시가 실제 git과 일치한다', () => {
    const repo = run([...FIRST_COMMIT, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2']);
    expect(repo.refs.get('refs/heads/main')).toBe(C2);

    const commit = repo.objects.get(C2);
    expect(commit?.type).toBe('commit');
    if (commit?.type === 'commit') {
      expect(commit.parents).toEqual([C1]);
      expect(commit.message).toBe('c2\n');
    }
  });

  it('같은 시퀀스는 언제나 같은 해시 (결정론)', () => {
    expect(resolveHead(run(FIRST_COMMIT))).toBe(resolveHead(run(FIRST_COMMIT)));
  });

  it('unborn branch가 첫 커밋으로 태어난다', () => {
    const before = run(['git init', 'echo hello > f.txt', 'git add f.txt']);
    expect(before.refs.size).toBe(0);
    const result = execute(before, 'git commit -m c1');
    expect(result.repo.refs.get('refs/heads/main')).toBe(C1);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/main' }); // HEAD 자체는 그대로
  });

  it('출력: root-commit 표시와 짧은 해시', () => {
    const first = execute(run(FIRST_COMMIT.slice(0, 3)), 'git commit -m c1');
    expect(first.output).toEqual(['[main (root-commit) 370125d] c1']);

    const second = execute(
      run([...FIRST_COMMIT, 'echo world > g.txt', 'git add g.txt']),
      'git commit -m c2',
    );
    expect(second.output).toEqual(['[main 87c91b7] c2']);
  });

  it('tree와 commit 객체가 생성되고 diff에 기록된다', () => {
    const result = execute(run(FIRST_COMMIT.slice(0, 3)), 'git commit -m c1');
    expect(result.diff.createdObjects).toEqual([TREE_C1, C1]);
    expect(result.diff.movedRefs).toEqual([
      { ref: 'refs/heads/main', from: undefined, to: C1 },
    ]);
    // blob + tree + commit
    expect(result.repo.objects.size).toBe(3);
  });

  it('시뮬레이션 시계가 커밋마다 증가한다', () => {
    const repo = run([...FIRST_COMMIT, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2']);
    expect(repo.clock).toBe(2);
    const commit = repo.objects.get(C2);
    if (commit?.type === 'commit') {
      expect(commit.author.timestamp).toBe(2);
    }
  });

  it('detached HEAD에서 커밋하면 HEAD가 새 커밋으로 직접 이동한다', () => {
    const base = run(FIRST_COMMIT);
    // SIMPLIFIED(테스트): checkout은 1.6에서 — detached 상태를 직접 구성한다
    const detached = { ...base, head: { kind: 'detached', sha: C1 } as const };
    const result = execute(detached, 'echo world > g.txt');
    const result2 = execute(result.repo, 'git add g.txt');
    const result3 = execute(result2.repo, 'git commit -m c2');

    expect(result3.error).toBeUndefined();
    expect(result3.repo.head.kind).toBe('detached');
    if (result3.repo.head.kind === 'detached') {
      expect(result3.repo.head.sha).toBe(C2);
    }
    expect(result3.repo.refs.get('refs/heads/main')).toBe(C1); // 브랜치는 안 움직인다
    expect(result3.output[0]).toMatch(/^\[detached HEAD 87c91b7\]/);
    expect(result3.diff.headChange).toBeDefined();
    expect(result3.diff.movedRefs).toEqual([]);
  });

  it('멀티라인 메시지는 첫 줄만 요약으로 출력된다', () => {
    const result = execute(run(FIRST_COMMIT.slice(0, 3)), 'git commit -m "first line\nsecond"');
    expect(result.error).toBeUndefined();
    expect(result.output[0]).toMatch(/\] first line$/);
  });
});

describe('git commit 에러 경로', () => {
  it('빈 저장소: nothing to commit (create/copy...)', () => {
    expect(execute(run(['git init']), 'git commit -m x').error).toBe(
      'nothing to commit (create/copy files and use "git add" to track)',
    );
  });

  it('untracked 파일만 있으면 untracked 안내', () => {
    expect(execute(run(['git init', 'echo a > f.txt']), 'git commit -m x').error).toBe(
      'nothing added to commit but untracked files present (use "git add" to track)',
    );
  });

  it('수정했지만 add하지 않았으면 no changes added', () => {
    const repo = run([...FIRST_COMMIT, 'echo v2 > f.txt']);
    expect(execute(repo, 'git commit -m x').error).toBe(
      'no changes added to commit (use "git add" and/or "git commit -a")',
    );
  });

  it('커밋 직후 다시 커밋하면 working tree clean', () => {
    expect(execute(run(FIRST_COMMIT), 'git commit -m x').error).toBe(
      'nothing to commit, working tree clean',
    );
  });

  it('빈 메시지는 abort', () => {
    const repo = run(FIRST_COMMIT.slice(0, 3));
    expect(execute(repo, 'git commit -m ""').error).toBe(
      'Aborting commit due to empty commit message.',
    );
  });

  it('-m 없이는 에디터 안내 에러', () => {
    const repo = run(FIRST_COMMIT.slice(0, 3));
    expect(execute(repo, 'git commit').error).toMatch(/-m/);
  });

  it('-m 뒤에 값이 없으면 실제 git 문구', () => {
    const repo = run(FIRST_COMMIT.slice(0, 3));
    expect(execute(repo, 'git commit -m').error).toBe("error: switch 'm' requires a value");
  });

  it('미지원 옵션은 명시적 에러', () => {
    const repo = run(FIRST_COMMIT.slice(0, 3));
    expect(execute(repo, 'git commit -a -m x').error).toMatch(/'-a'.*지원하지 않습니다/);
  });

  it('실패 시 상태가 변하지 않는다 (clock 포함)', () => {
    const repo = run(FIRST_COMMIT);
    const result = execute(repo, 'git commit -m x');
    expect(result.repo).toBe(repo);
    expect(result.repo.clock).toBe(1);
  });
});
