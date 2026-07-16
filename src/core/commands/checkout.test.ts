import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { computeStatus } from '../status';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];
// feature: f.txt의 내용이 다르다 (같은 파일이 트리 간에 충돌 가능)
const DIVERGED_F = [
  ...BASE,
  'git checkout -b feature',
  'echo feat > f.txt',
  'git add f.txt',
  'git commit -m c2',
  'git checkout main',
];
// feature: g.txt가 추가로 있다 (f.txt는 두 트리에서 동일)
const DIVERGED_G = [
  ...BASE,
  'git checkout -b feature',
  'echo world > g.txt',
  'git add g.txt',
  'git commit -m addg',
  'git checkout main',
];

describe('git checkout <branch>', () => {
  it('HEAD/index/working tree가 대상 브랜치의 트리로 전환된다', () => {
    const repo = run(DIVERGED_F);
    expect(repo.workingTree.get('f.txt')).toBe('hello'); // main으로 돌아온 상태

    const result = execute(repo, 'git checkout feature');
    expect(result.output).toEqual(["Switched to branch 'feature'"]);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/feature' });
    expect(result.repo.workingTree.get('f.txt')).toBe('feat');
    expect(computeStatus(result.repo).clean).toBe(true);
    expect(result.diff.headChange).toBeDefined();
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'modified' }]);
  });

  it('현재 브랜치로 checkout하면 Already on', () => {
    const result = execute(run(BASE), 'git checkout main');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(["Already on 'main'"]);
  });

  it('없는 대상은 pathspec 에러', () => {
    expect(execute(run(BASE), 'git checkout ghost').error).toBe(
      "error: pathspec 'ghost' did not match any file(s) known to git",
    );
  });

  it('트리 간에 같은 파일의 로컬 변경은 checkout을 넘어 살아남는다', () => {
    // DIVERGED_G에서 f.txt는 양쪽 트리에서 동일 — 수정해도 전환 가능해야 한다
    const repo = run([...DIVERGED_G, 'echo local > f.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('f.txt')).toBe('local'); // 수정이 유지된다
    expect(result.repo.workingTree.get('g.txt')).toBe('world'); // 트리 차이는 반영된다
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'f.txt', worktree: 'modified' },
    ]);
  });

  it('staged 변경도 트리 간 같은 파일이면 살아남는다', () => {
    const repo = run([...DIVERGED_G, 'echo local > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.error).toBeUndefined();
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'f.txt', index: 'modified' }]);
  });

  it('untracked 파일은 checkout을 넘어 그대로 남는다', () => {
    const repo = run([...DIVERGED_G, 'echo mine > note.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.repo.workingTree.get('note.txt')).toBe('mine');
    expect(result.repo.index.has('note.txt')).toBe(false);
  });

  it('트리 간에 다른 파일에 로컬 변경이 있으면 거부한다', () => {
    const repo = run([...DIVERGED_F, 'echo local > f.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.error).toBe(
      'error: Your local changes to the following files would be overwritten by checkout:\n' +
        '\tf.txt\n' +
        'Please commit your changes or stash them before you switch branches.\nAborting',
    );
    expect(result.repo).toBe(repo); // 아무것도 변하지 않는다
  });

  it('untracked 파일을 대상 트리가 덮어쓰려 하면 거부한다', () => {
    const repo = run([...DIVERGED_G, 'echo different > g.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.error).toBe(
      'error: The following untracked working tree files would be overwritten by checkout:\n' +
        '\tg.txt\n' +
        'Please move or remove them before you switch branches.\nAborting',
    );
  });

  it('untracked 파일이 대상과 내용까지 같으면 조용히 채택되어 tracked가 된다', () => {
    const repo = run([...DIVERGED_G, 'echo world > g.txt']);
    const result = execute(repo, 'git checkout feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.index.has('g.txt')).toBe(true);
    expect(computeStatus(result.repo).clean).toBe(true);
  });
});

describe('git checkout <sha> — detached HEAD', () => {
  it('축약 해시로 checkout하면 HEAD가 커밋을 직접 가리킨다', () => {
    const repo = run(DIVERGED_G);
    const result = execute(repo, `git checkout ${C1.slice(0, 7)}`);
    expect(result.error).toBeUndefined();
    expect(result.repo.head).toEqual({ kind: 'detached', sha: C1 });
    expect(result.repo.workingTree.has('g.txt')).toBe(false); // C1 시점의 트리
    expect(result.output[0]).toBe(`Note: switching to '${C1.slice(0, 7)}'.`);
    expect(result.output[result.output.length - 1]).toBe('HEAD is now at 370125d c1');
  });

  it('전체 해시도 동작한다', () => {
    const result = execute(run(DIVERGED_G), `git checkout ${C1}`);
    expect(result.repo.head).toEqual({ kind: 'detached', sha: C1 });
  });

  it('브랜치 이름이 해시보다 우선한다', () => {
    const repo = run(DIVERGED_G);
    const result = execute(repo, 'git checkout feature');
    expect(result.repo.head.kind).toBe('symbolic');
  });

  it('detached에서 브랜치로 복귀', () => {
    const repo = run([...DIVERGED_G, `git checkout ${C1.slice(0, 7)}`]);
    const result = execute(repo, 'git checkout main');
    expect(result.output).toEqual(["Switched to branch 'main'"]);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/main' });
  });

  it('detached에서 커밋하고 브랜치로 떠나면 그 커밋은 unreachable로 남는다', () => {
    const repo = run([
      ...BASE,
      `git checkout ${C1.slice(0, 7)}`,
      'echo x > x.txt',
      'git add x.txt',
      'git commit -m orphan',
      'git checkout main',
    ]);
    expect(repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/main' });
    expect(repo.refs.size).toBe(1);
    // orphan 커밋 객체는 store에 남아 있다 (어떤 ref도 가리키지 않을 뿐)
    const commits = [...repo.objects.values()].filter((o) => o.type === 'commit');
    expect(commits.length).toBe(2);
  });
});

describe('git checkout -b', () => {
  it('브랜치를 만들고 즉시 전환한다', () => {
    const result = execute(run(BASE), 'git checkout -b feature');
    expect(result.output).toEqual(["Switched to a new branch 'feature'"]);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/feature' });
    expect(result.repo.refs.get('refs/heads/feature')).toBe(C1);
    expect(result.diff.movedRefs).toEqual([{ ref: 'refs/heads/feature', to: C1 }]);
  });

  it('unborn 상태에서는 브랜치 이름만 바뀐다 (실제 git과 동일)', () => {
    const result = execute(run(['git init']), 'git checkout -b dev');
    expect(result.error).toBeUndefined();
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/dev' });
    expect(result.repo.refs.size).toBe(0); // 여전히 unborn
  });

  it('시작점을 지정하면 그 커밋에서 분기하고 트리도 전환된다', () => {
    const repo = run(DIVERGED_G); // main에 있고, feature에 g.txt
    const result = execute(repo, 'git checkout -b hotfix feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.refs.get('refs/heads/hotfix')).toBe(repo.refs.get('refs/heads/feature'));
    expect(result.repo.workingTree.get('g.txt')).toBe('world');
  });

  it('중복 이름과 잘못된 시작점', () => {
    const repo = run(DIVERGED_G);
    expect(execute(repo, 'git checkout -b feature').error).toBe(
      "fatal: a branch named 'feature' already exists",
    );
    expect(execute(repo, 'git checkout -b x badref').error).toBe(
      "fatal: 'badref' is not a commit and a branch 'x' cannot be created from it",
    );
  });
});
