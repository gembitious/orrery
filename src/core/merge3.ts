/**
 * 트리 수준 3-way 병합 — merge / rebase / cherry-pick이 공유하는 심장부.
 * 파일별 규칙: 양쪽이 같으면 그것, 한쪽만 바꿨으면 바꾼 쪽,
 * 양쪽이 서로 다르게 바꿨으면 충돌.
 */
import type { Sha } from './objects';

export interface ThreeWayResult {
  /** 병합된 tree (filename → blob sha). 충돌 파일은 빠져 있다 */
  merged: Map<string, Sha>;
  /** 양쪽이 서로 다르게 바꾼 파일들 (이름순) */
  conflicts: string[];
}

export function threeWayTrees(
  base: Map<string, Sha>,
  ours: Map<string, Sha>,
  theirs: Map<string, Sha>,
): ThreeWayResult {
  const files = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].sort();
  const merged = new Map<string, Sha>();
  const conflicts: string[] = [];

  for (const file of files) {
    const b = base.get(file);
    const o = ours.get(file);
    const t = theirs.get(file);
    const winner =
      o === t ? o // 양쪽이 같다 (둘 다 삭제 포함)
      : b === o ? t // 우리는 안 바꿨다 → 그쪽 변경 채택
      : b === t ? o // 그쪽은 안 바꿨다 → 우리 것 유지
      : null; // 양쪽이 서로 다르게 바꿨다
    if (winner === null) {
      conflicts.push(file);
    } else if (winner !== undefined) {
      merged.set(file, winner);
    }
  }
  return { merged, conflicts };
}
