/**
 * 커밋 DAG 레이아웃: 레인(lane) 배정 — 순수 함수, React/SVG 무관.
 *
 * 탐욕 알고리즘: 커밋을 최신순(위→아래)으로 훑으며,
 *   1) 나를 기다리는 레인(내 자식이 지나간 레인)이 있으면 그중 가장 왼쪽을 차지하고,
 *      나머지 기다리던 레인은 해제한다 — 여러 브랜치가 한 조상으로 모이는 지점.
 *   2) 기다리는 레인이 없으면(브랜치 끝, tip) 가장 왼쪽 빈 레인을 새로 잡는다.
 *   3) 첫 부모는 내 레인을 이어받고, 나머지 부모(머지)는 각자 새 레인을 예약한다.
 *
 * 시뮬레이션 시계가 단조 증가라 "최신순"이 항상 위상 정렬을 만족한다
 * (부모는 자식보다 반드시 오래됐다). 브랜치 십수 개 규모에는 이것으로 충분하다.
 */
import type { Sha } from '../core/objects';
import type { CommitNode } from './graphData';

export interface CommitPosition {
  sha: Sha;
  /** 세로 위치: 0이 최신 커밋 */
  row: number;
  /** 가로 위치: 0이 가장 왼쪽 레인 */
  lane: number;
}

export interface GraphLayout {
  positions: Map<Sha, CommitPosition>;
  rowCount: number;
  laneCount: number;
}

/** nodes는 최신순 정렬 전제 (listCommitsByTime의 결과) */
export function layoutCommits(nodes: CommitNode[]): GraphLayout {
  // lanes[i] = 그 레인이 다음에 만나기를 기다리는 커밋 sha (null = 빈 레인)
  const lanes: (Sha | null)[] = [];
  const positions = new Map<Sha, CommitPosition>();
  let laneCount = 0;

  const firstFree = (): number => {
    const idx = lanes.indexOf(null);
    if (idx !== -1) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  nodes.forEach((node, row) => {
    const waiting: number[] = [];
    lanes.forEach((sha, idx) => {
      if (sha === node.sha) waiting.push(idx);
    });

    let lane: number;
    if (waiting.length === 0) {
      lane = firstFree(); // tip: 아직 자식이 그려지지 않은 브랜치 끝
    } else {
      lane = waiting[0];
      for (const idx of waiting.slice(1)) lanes[idx] = null; // 합류한 레인 해제
    }

    positions.set(node.sha, { sha: node.sha, row, lane });
    laneCount = Math.max(laneCount, lane + 1);

    const [firstParent, ...otherParents] = node.commit.parents;
    lanes[lane] = firstParent ?? null; // root 커밋이면 레인 종료
    for (const parent of otherParents) {
      // 머지의 두 번째+ 부모: 이미 그 부모를 기다리는 레인이 있으면 재사용
      if (!lanes.includes(parent)) {
        const idx = firstFree();
        lanes[idx] = parent;
        laneCount = Math.max(laneCount, idx + 1);
      }
    }
  });

  return { positions, rowCount: nodes.length, laneCount };
}
