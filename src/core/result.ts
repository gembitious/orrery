/**
 * 모든 명령(코어 순수 함수)의 반환 타입.
 * StateDiff는 UI가 "무엇이 변했는가"를 애니메이션으로 옮기기 위한 데이터다.
 */
import type { Sha } from './objects';
import type { Head, Repository } from './repository';

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
