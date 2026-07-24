/**
 * StateDiff → "무엇이 날아가는가" 결정 (순수 함수 — DOM 무관).
 *
 * 3영역에서 내용(blob)이 흐르는 방향을 고스트 칩으로 보여준다:
 *   add              → wt → idx
 *   commit           → idx → head
 *   restore --staged → head → idx   (git reset의 제자리 unstage도 동일)
 *   restore          → idx → wt     (reset --hard의 제자리 복원도 동일)
 * checkout이나 브랜치를 옮기는 reset은 셀들이 통째로 바뀌므로 슬라이드 없이
 * FLIP/펄스에 맡긴다 (headChange 또는 movedRefs가 있으면 이동 슬라이드 제외).
 *
 * 방향 판정의 근거는 전부 "내용의 해시": staged된 sha가 WT 내용의 해시와 같으면
 * WT에서 온 것이고, HEAD tree의 sha와 같으면 HEAD에서 온 것이다.
 */
import { hashObject, shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import { resolveHead, stagedSha } from '../core/repository';
import type { StateDiff } from '../core/result';
import { commitTreeMap } from '../core/revision';

export interface Slide {
  fromKey: string;
  toKey: string;
  /** 고스트 칩에 표시할 텍스트 (blob 짧은 해시) */
  label: string;
}

export function deriveSlides(diff: StateDiff, before: Repository, after: Repository): Slide[] {
  const slides: Slide[] = [];
  const slid = new Set<string>();

  if (diff.headChange === undefined && diff.movedRefs.length === 0) {
    const headSha = resolveHead(after);
    const headTree = headSha === undefined ? new Map<string, string>() : commitTreeMap(after, headSha);

    // ① add: 새 index 내용이 WT 내용과 같다 → wt → idx
    for (const change of diff.indexChanges) {
      if (change.kind !== 'staged' && change.kind !== 'modified') continue;
      const sha = stagedSha(after.index.get(change.file));
      if (sha === undefined) continue;
      const wtContent = after.workingTree.get(change.file);
      if (wtContent === undefined) continue;
      if (hashObject({ type: 'blob', content: wtContent }) !== sha) continue;
      slides.push({
        fromKey: `cell:wt:${change.file}`,
        toKey: `cell:idx:${change.file}`,
        label: shortSha(sha),
      });
      slid.add(change.file);
    }

    // ② restore --staged / 제자리 unstage: 새 index 내용이 HEAD와 같다 → head → idx
    for (const change of diff.indexChanges) {
      if (slid.has(change.file)) continue; // ①이 이미 설명한 파일 (WT에서 온 것이 우선)
      if (change.kind !== 'staged' && change.kind !== 'modified') continue;
      const sha = stagedSha(after.index.get(change.file));
      if (sha === undefined) continue;
      if (headTree.get(change.file) !== sha) continue;
      slides.push({
        fromKey: `cell:head:${change.file}`,
        toKey: `cell:idx:${change.file}`,
        label: shortSha(sha),
      });
      slid.add(change.file);
    }

    // ③ restore: 새 WT 내용이 index와 같다 → idx → wt
    for (const change of diff.workingTreeChanges) {
      if (change.kind !== 'modified' && change.kind !== 'created') continue;
      const content = after.workingTree.get(change.file);
      if (content === undefined) continue;
      if (before.workingTree.get(change.file) === content) continue; // 실제로 바뀐 것만
      const sha = stagedSha(after.index.get(change.file));
      if (sha === undefined) continue;
      if (hashObject({ type: 'blob', content }) !== sha) continue;
      slides.push({
        fromKey: `cell:idx:${change.file}`,
        toKey: `cell:wt:${change.file}`,
        label: shortSha(sha),
      });
    }
  }

  // ④ commit: 새로 만들어진 커밋으로 ref(또는 detached HEAD)가 이동 → idx → head
  const newCommit =
    diff.movedRefs.find((m) => diff.createdObjects.includes(m.to))?.to ??
    (diff.headChange?.to.kind === 'detached' && diff.createdObjects.includes(diff.headChange.to.sha)
      ? diff.headChange.to.sha
      : undefined);
  if (newCommit !== undefined) {
    for (const [file, entry] of after.index) {
      const sha = stagedSha(entry);
      if (sha === undefined) continue;
      slides.push({
        fromKey: `cell:idx:${file}`,
        toKey: `cell:head:${file}`,
        label: shortSha(sha),
      });
    }
  }

  return slides;
}
