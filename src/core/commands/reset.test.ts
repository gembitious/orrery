import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { resolveRevision } from '../revision';
import { computeStatus } from '../status';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa'; // {f.txt:'hello'}, 'c1'
const C2 = '87c91b76e9e75bf0619d2e2af2c9eede5603cc8b'; // +{g.txt:'world'}, 'c2'
const TWO = [
  'git init',
  'echo hello > f.txt', 'git add f.txt', 'git commit -m c1',
  'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
];

describe('resolveRevision', () => {
  it('HEAD, HEAD~N, 브랜치~N, 해시~N을 해석한다', () => {
    const repo = run(TWO);
    expect(resolveRevision(repo, 'HEAD')).toBe(C2);
    expect(resolveRevision(repo, 'HEAD~')).toBe(C1);
    expect(resolveRevision(repo, 'HEAD~1')).toBe(C1);
    expect(resolveRevision(repo, 'main~1')).toBe(C1);
    expect(resolveRevision(repo, `${C2.slice(0, 7)}~1`)).toBe(C1);
    expect(resolveRevision(repo, 'HEAD~~')).toBeUndefined(); // 루트 지나침
    expect(resolveRevision(repo, 'HEAD~2')).toBeUndefined();
    expect(resolveRevision(repo, 'HEAD~x')).toBeUndefined();
  });
});

describe('git reset --soft', () => {
  it('브랜치만 이동, index/WT 유지 — 되돌린 변경이 staged로 남는다', () => {
    const before = run(TWO);
    const result = execute(before, 'git reset --soft HEAD~1');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([]); // soft는 침묵
    expect(result.repo.refs.get('refs/heads/main')).toBe(C1);
    expect(result.repo.index).toBe(before.index); // 그대로
    expect(result.repo.workingTree).toBe(before.workingTree);
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'g.txt', index: 'added' }]);
    expect(result.diff.movedRefs).toEqual([{ ref: 'refs/heads/main', from: C2, to: C1 }]);
    expect(result.diff.indexChanges).toEqual([]);
    expect(result.diff.workingTreeChanges).toEqual([]);
  });
});

describe('git reset (--mixed 기본)', () => {
  it('브랜치+index 이동, WT 유지 — 변경이 unstaged로 남는다', () => {
    const result = execute(run(TWO), 'git reset HEAD~1');

    expect(result.error).toBeUndefined();
    expect(result.repo.refs.get('refs/heads/main')).toBe(C1);
    expect(result.repo.index.has('g.txt')).toBe(false); // index는 C1 시점
    expect(result.repo.workingTree.get('g.txt')).toBe('world'); // WT는 그대로
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'g.txt', worktree: 'untracked' }]);
    // g.txt는 새 index에 없으므로(untracked화) Unstaged 목록에 나오지 않는다 — 실제 git과 동일
    expect(result.output).toEqual([]);
    expect(result.diff.indexChanges).toEqual([{ file: 'g.txt', kind: 'unstaged' }]);
  });

  it('수정을 unstage하면 Unstaged changes after reset: M 표기', () => {
    const repo = run([...TWO, 'echo v2 > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git reset');
    expect(result.output).toEqual(['Unstaged changes after reset:', 'M\tf.txt']);
    expect(computeStatus(result.repo).entries).toEqual([{ file: 'f.txt', worktree: 'modified' }]);
    expect(result.repo.refs.get('refs/heads/main')).toBe(C2); // 대상 기본값 HEAD — ref는 제자리
    expect(result.diff.movedRefs).toEqual([]);
  });

  it('WT에서 지운 파일은 D로 표기', () => {
    const repo = run([...TWO, 'rm f.txt', 'git add f.txt']); // 삭제 staged
    const result = execute(repo, 'git reset'); // unstage → index에 f.txt 복원, WT에는 없음
    expect(result.output).toEqual(['Unstaged changes after reset:', 'D\tf.txt']);
  });
});

describe('git reset --hard', () => {
  it('브랜치+index+WT 전부 이동, HEAD is now at 출력', () => {
    const repo = run([...TWO, 'echo dirty > f.txt', 'git add f.txt', 'echo dirtier > f.txt']);
    const result = execute(repo, 'git reset --hard HEAD~1');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(['HEAD is now at 370125d c1']);
    expect(result.repo.refs.get('refs/heads/main')).toBe(C1);
    expect(result.repo.workingTree.get('f.txt')).toBe('hello'); // 더러운 변경이 날아감
    expect(result.repo.workingTree.has('g.txt')).toBe(false);
    expect(computeStatus(result.repo).clean).toBe(true);
  });

  it('untracked 파일은 hard reset도 지우지 않는다 (실제 git과 동일)', () => {
    const repo = run([...TWO, 'echo keep > note.txt']);
    const result = execute(repo, 'git reset --hard HEAD~1');
    expect(result.repo.workingTree.get('note.txt')).toBe('keep');
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'note.txt', worktree: 'untracked' },
    ]);
  });

  it('대상 tree에 있는 이름의 untracked 파일은 덮어써진다', () => {
    const repo = run([
      'git init',
      'echo hello > f.txt', 'git add f.txt', 'git commit -m c1',
      'rm f.txt', 'git add f.txt', 'git commit -m del-f',
      'echo mine > f.txt', // untracked 재생성
    ]);
    const result = execute(repo, 'git reset --hard HEAD~1'); // f.txt가 있는 c1으로
    expect(result.repo.workingTree.get('f.txt')).toBe('hello');
  });

  it('같은 커밋으로의 hard reset도 WT를 되돌리고 HEAD is now at을 출력한다', () => {
    const repo = run([...TWO, 'echo dirty > f.txt']);
    const result = execute(repo, 'git reset --hard');
    expect(result.output).toEqual(['HEAD is now at 87c91b7 c2']);
    expect(result.repo.workingTree.get('f.txt')).toBe('hello');
    expect(result.diff.movedRefs).toEqual([]); // ref는 움직이지 않았다
  });
});

describe('reset 기타 경로', () => {
  it('detached HEAD에서는 HEAD가 직접 이동한다', () => {
    const base = run(TWO);
    const detached = { ...base, head: { kind: 'detached', sha: C2 } as const };
    const result = execute(detached, 'git reset --hard HEAD~1');
    expect(result.repo.head).toEqual({ kind: 'detached', sha: C1 });
    expect(result.repo.refs.get('refs/heads/main')).toBe(C2); // 브랜치는 그대로
    expect(result.diff.headChange).toBeDefined();
  });

  it('unborn 저장소: 실제 git의 ambiguous argument 문구', () => {
    const result = execute(run(['git init']), 'git reset --hard');
    expect(result.error).toMatch(/^fatal: ambiguous argument 'HEAD': unknown revision/);
  });

  it('모르는 리비전', () => {
    expect(execute(run(TWO), 'git reset zzz').error).toMatch(
      /^fatal: ambiguous argument 'zzz': unknown revision/,
    );
    expect(execute(run(TWO), 'git reset HEAD~9').error).toMatch(
      /^fatal: ambiguous argument 'HEAD~9': unknown revision/,
    );
  });

  it('미지원 옵션과 다중 대상', () => {
    expect(execute(run(TWO), 'git reset --keep').error).toMatch(/'--keep'.*지원하지 않습니다/);
    expect(execute(run(TWO), 'git reset --soft --hard').error).toMatch(/하나만/);
    expect(execute(run(TWO), 'git reset HEAD f.txt').error).toMatch(/파일 단위 reset은 미지원/);
  });

  it('실패 시 상태 불변', () => {
    const repo = run(TWO);
    const result = execute(repo, 'git reset zzz');
    expect(result.repo).toBe(repo);
  });
});
