/**
 * StateDiff → "무엇이 날아가는가" 결정 (순수 함수 — DOM 무관).
 *
 * 3영역 슬라이드의 의미론:
 *   add    → working tree의 내용(blob)이 index로 들어간다: wt 셀 → idx 셀
 *   commit → index의 스냅샷이 HEAD가 된다: idx 셀 → head 셀
 * checkout은 셀들이 통째로 바뀌므로 슬라이드 없이 FLIP/펄스에 맡긴다
 * (headChange가 있으면 add 슬라이드를 만들지 않는 이유).
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import type { StateDiff } from '../core/result';

export interface Slide {
  fromKey: string;
  toKey: string;
  /** 고스트 칩에 표시할 텍스트 (blob 짧은 해시) */
  label: string;
}

export function deriveSlides(diff: StateDiff, after: Repository): Slide[] {
  const slides: Slide[] = [];

  // git add: WT → index (HEAD가 움직인 전이는 checkout 계열이므로 제외)
  if (diff.headChange === undefined) {
    for (const change of diff.indexChanges) {
      if (change.kind !== 'staged' && change.kind !== 'modified') continue;
      const entry = after.index.get(change.file);
      if (entry === undefined) continue;
      slides.push({
        fromKey: `cell:wt:${change.file}`,
        toKey: `cell:idx:${change.file}`,
        label: shortSha(entry.sha),
      });
    }
  }

  // git commit: 새로 만들어진 커밋으로 ref(또는 detached HEAD)가 이동했는가
  const newCommit =
    diff.movedRefs.find((m) => diff.createdObjects.includes(m.to))?.to ??
    (diff.headChange?.to.kind === 'detached' && diff.createdObjects.includes(diff.headChange.to.sha)
      ? diff.headChange.to.sha
      : undefined);
  if (newCommit !== undefined) {
    for (const [file, entry] of after.index) {
      slides.push({
        fromKey: `cell:idx:${file}`,
        toKey: `cell:head:${file}`,
        label: shortSha(entry.sha),
      });
    }
  }

  return slides;
}
