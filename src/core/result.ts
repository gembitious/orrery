/**
 * 모든 명령(코어 순수 함수)의 반환 타입.
 * StateDiff는 UI가 "무엇이 변했는가"를 애니메이션으로 옮기기 위한 데이터다.
 */
import type { Sha } from './objects';
import type { Head, IndexEntry, Repository } from './repository';

export interface StateDiff {
  createdObjects: Sha[];
  movedRefs: { ref: string; from?: Sha; to: Sha }[];
  /** 삭제된 ref (git branch -d). movedRefs는 to가 필수라 삭제를 표현할 수 없다 */
  deletedRefs?: string[];
  headChange?: { from: Head; to: Head };
  indexChanges: { file: string; kind: 'staged' | 'unstaged' | 'modified' }[];
  workingTreeChanges: { file: string; kind: 'created' | 'modified' | 'deleted' }[];
}

export interface CommandResult {
  repo: Repository; // 새 상태 (실패 시 원본 그대로)
  output: string[]; // git이 stdout/stderr에 냈을 법한 메시지
  error?: string; // 실패 시
  diff: StateDiff;
}

export function emptyDiff(): StateDiff {
  return {
    createdObjects: [],
    movedRefs: [],
    indexChanges: [],
    workingTreeChanges: [],
  };
}

export function success(
  repo: Repository,
  output: string[] = [],
  diff: StateDiff = emptyDiff(),
): CommandResult {
  return { repo, output, diff };
}

/** 실패: repo는 손대지 않고 원본을 그대로 돌려준다 */
export function failure(repo: Repository, error: string): CommandResult {
  return { repo, output: [], error, diff: emptyDiff() };
}

/** 엔트리의 내용 식별자 — 충돌 엔트리는 stage 조합으로 구분한다 */
function indexSignature(entry: IndexEntry | undefined): string | undefined {
  if (entry === undefined) return undefined;
  if (entry.conflicted === true) {
    return `conflict:${entry.stages[1] ?? ''}:${entry.stages[2] ?? ''}:${entry.stages[3] ?? ''}`;
  }
  return entry.sha;
}

/**
 * index/working tree를 통째로 교체하는 명령(checkout, reset)의 전후 차이를
 * StateDiff의 indexChanges/workingTreeChanges로 기록한다.
 * ref/HEAD 이동은 호출부가 채운다.
 */
export function workspaceDiff(
  before: Repository,
  index: Map<string, IndexEntry>,
  workingTree: Map<string, string>,
): StateDiff {
  const diff = emptyDiff();
  const files = [
    ...new Set([
      ...before.workingTree.keys(),
      ...workingTree.keys(),
      ...before.index.keys(),
      ...index.keys(),
    ]),
  ].sort();

  for (const file of files) {
    const wtBefore = before.workingTree.get(file);
    const wtAfter = workingTree.get(file);
    if (wtBefore === undefined && wtAfter !== undefined) {
      diff.workingTreeChanges.push({ file, kind: 'created' });
    } else if (wtBefore !== undefined && wtAfter === undefined) {
      diff.workingTreeChanges.push({ file, kind: 'deleted' });
    } else if (wtBefore !== wtAfter) {
      diff.workingTreeChanges.push({ file, kind: 'modified' });
    }

    const idxBefore = indexSignature(before.index.get(file));
    const idxAfter = indexSignature(index.get(file));
    if (idxBefore === undefined && idxAfter !== undefined) {
      diff.indexChanges.push({ file, kind: 'staged' });
    } else if (idxBefore !== undefined && idxAfter === undefined) {
      diff.indexChanges.push({ file, kind: 'unstaged' });
    } else if (idxBefore !== idxAfter) {
      diff.indexChanges.push({ file, kind: 'modified' });
    }
  }
  return diff;
}
