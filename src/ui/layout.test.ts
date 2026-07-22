import { describe, expect, it } from 'vitest';
import { run } from '../command/run';
import type { Signature } from '../core/objects';
import type { CommitNode } from './graphData';
import { listCommitsByTime } from './graphData';
import { layoutCommits } from './layout';

const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

function pos(layout: ReturnType<typeof layoutCommits>, sha: string) {
  const p = layout.positions.get(sha);
  if (p === undefined) throw new Error(`no position for ${sha}`);
  return p;
}

/** 합성 커밋 노드 (머지 등 아직 명령으로 못 만드는 모양의 테스트용) */
function fakeNode(sha: string, parents: string[], timestamp: number): CommitNode {
  const sig: Signature = { name: 'x', email: 'x@x', timestamp };
  return {
    sha,
    commit: { type: 'commit', tree: 't', parents, author: sig, committer: sig, message: sha },
  };
}

describe('layoutCommits', () => {
  it('일직선 히스토리는 전부 레인 0, 최신이 row 0', () => {
    const repo = run([...BASE, 'echo 2 > f.txt', 'git add .', 'git commit -m c2',
      'echo 3 > f.txt', 'git add .', 'git commit -m c3']);
    const nodes = listCommitsByTime(repo);
    const layout = layoutCommits(nodes);

    expect(layout.laneCount).toBe(1);
    expect(layout.rowCount).toBe(3);
    nodes.forEach((n, i) => {
      expect(pos(layout, n.sha)).toEqual({ sha: n.sha, row: i, lane: 0 });
    });
  });

  it('갈라진 브랜치는 다른 레인을 받고, 공통 조상에서 합류한다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b feature',
      'echo f > g.txt', 'git add g.txt', 'git commit -m on-feature', // ts=2
      'git checkout main',
      'echo m > h.txt', 'git add h.txt', 'git commit -m on-main', // ts=3
    ]);
    const nodes = listCommitsByTime(repo); // [on-main, on-feature, c1]
    const layout = layoutCommits(nodes);

    const [onMain, onFeature, base] = nodes.map((n) => pos(layout, n.sha));
    expect(onMain).toMatchObject({ row: 0, lane: 0 });
    expect(onFeature).toMatchObject({ row: 1, lane: 1 }); // 옆 레인으로 분리
    expect(base).toMatchObject({ row: 2, lane: 0 }); // 공통 조상은 왼쪽 레인에 합류
    expect(layout.laneCount).toBe(2);
  });

  it('머지 커밋: 두 번째 부모의 체인이 별도 레인을 유지한다', () => {
    // M(A,B) — A(R) — B(R) — R : 다이아몬드
    const nodes = [
      fakeNode('M', ['A', 'B'], 4),
      fakeNode('A', ['R'], 3),
      fakeNode('B', ['R'], 2),
      fakeNode('R', [], 1),
    ];
    const layout = layoutCommits(nodes);
    expect(pos(layout, 'M')).toMatchObject({ row: 0, lane: 0 });
    expect(pos(layout, 'A')).toMatchObject({ row: 1, lane: 0 }); // 첫 부모가 레인 승계
    expect(pos(layout, 'B')).toMatchObject({ row: 2, lane: 1 }); // 두 번째 부모는 새 레인
    expect(pos(layout, 'R')).toMatchObject({ row: 3, lane: 0 }); // 합류
    expect(layout.laneCount).toBe(2);
  });

  it('해제된 레인은 재사용된다', () => {
    // 브랜치 두 개가 base1에서 합류한 뒤, 더 오래된 독립 tip이 등장하는 모양
    const nodes = [
      fakeNode('m2', ['base'], 5),
      fakeNode('f1', ['base'], 4),
      fakeNode('base', ['old'], 3),
      fakeNode('tip2', ['old'], 2), // base 시점에 lane 1이 해제됐으므로 재사용
      fakeNode('old', [], 1),
    ];
    const layout = layoutCommits(nodes);
    expect(pos(layout, 'f1').lane).toBe(1);
    expect(pos(layout, 'tip2').lane).toBe(1); // 재사용
    expect(layout.laneCount).toBe(2);
  });

  it('빈 입력', () => {
    const layout = layoutCommits([]);
    expect(layout.rowCount).toBe(0);
    expect(layout.laneCount).toBe(0);
  });
});
