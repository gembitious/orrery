import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { getCommit } from '../revision';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];
const TWO = [...BASE, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2'];

describe('git commit --amend', () => {
  it('tip을 교체한다 — 새 커밋, 같은 부모, 원본은 unreachable로 남는다', () => {
    const before = run([...TWO, 'echo v2 > g.txt', 'git add g.txt']);
    const oldTip = before.refs.get('refs/heads/main') ?? '';
    const result = execute(before, 'git commit --amend -m c2-fixed');

    expect(result.error).toBeUndefined();
    const newTip = result.repo.refs.get('refs/heads/main') ?? '';
    expect(newTip).not.toBe(oldTip);

    const amended = getCommit(result.repo, newTip);
    expect(amended.parents).toEqual([C1]); // 부모는 원본과 동일
    expect(amended.message).toBe('c2-fixed\n');
    // staged 변경이 교체된 커밋에 들어간다
    expect(result.repo.objects.get(amended.tree)?.type).toBe('tree');
    // 원본 커밋은 지워지지 않는다
    expect(result.repo.objects.has(oldTip)).toBe(true);
    expect(result.diff.movedRefs).toEqual([
      { ref: 'refs/heads/main', from: oldTip, to: newTip },
    ]);
  });

  it('author(원본 날짜)는 유지되고 committer만 새로 찍힌다', () => {
    const result = execute(run(TWO), 'git commit --amend -m c2-fixed');
    const amended = getCommit(result.repo, result.repo.refs.get('refs/heads/main') ?? '');
    expect(amended.author.timestamp).toBe(2); // 원본 c2의 시각
    expect(amended.committer.timestamp).toBe(3); // 새 시각
  });

  it('출력: [main <short>] + Date: 줄 (root여도 root-commit 마커 없음)', () => {
    const result = execute(run(BASE), 'git commit --amend -m c1-fixed');
    expect(result.output.length).toBe(2);
    expect(result.output[0]).toMatch(/^\[main [0-9a-f]{7}\] c1-fixed$/);
    expect(result.output[1]).toBe(' Date: Thu Jan 1 00:00:01 1970 +0000');
    // root 커밋의 amend는 여전히 부모가 없다
    const amended = getCommit(result.repo, result.repo.refs.get('refs/heads/main') ?? '');
    expect(amended.parents).toEqual([]);
  });

  it('-m 없으면 기존 메시지를 유지한다 (--no-edit 동작)', () => {
    const withChange = run([...TWO, 'echo v2 > g.txt', 'git add g.txt']);
    for (const cmd of ['git commit --amend', 'git commit --amend --no-edit']) {
      const result = execute(withChange, cmd);
      expect(result.error).toBeUndefined();
      const amended = getCommit(result.repo, result.repo.refs.get('refs/heads/main') ?? '');
      expect(amended.message).toBe('c2\n');
    }
  });

  it('detached HEAD에서는 HEAD가 새 커밋으로 이동한다', () => {
    const base = run(TWO);
    const tip = base.refs.get('refs/heads/main') ?? '';
    const detached = { ...base, head: { kind: 'detached', sha: tip } as const };
    const result = execute(detached, 'git commit --amend -m redo');
    expect(result.repo.head.kind).toBe('detached');
    if (result.repo.head.kind === 'detached') {
      expect(result.repo.head.sha).not.toBe(tip);
    }
    expect(result.repo.refs.get('refs/heads/main')).toBe(tip); // 브랜치는 그대로
    expect(result.output[0]).toMatch(/^\[detached HEAD [0-9a-f]{7}\] redo$/);
  });

  it('unborn: fatal You have nothing to amend.', () => {
    expect(execute(run(['git init']), 'git commit --amend -m x').error).toBe(
      'fatal: You have nothing to amend.',
    );
  });

  it('빈 메시지는 abort', () => {
    expect(execute(run(BASE), 'git commit --amend -m ""').error).toBe(
      'Aborting commit due to empty commit message.',
    );
  });

  it('--no-edit 단독은 미지원 안내', () => {
    expect(execute(run(BASE), 'git commit --no-edit').error).toMatch(/--amend와 함께만/);
  });

  it('같은 시퀀스는 같은 amend 해시 (결정론)', () => {
    const a = execute(run(TWO), 'git commit --amend -m fix').repo.refs.get('refs/heads/main');
    const b = execute(run(TWO), 'git commit --amend -m fix').repo.refs.get('refs/heads/main');
    expect(a).toBe(b);
  });
});
