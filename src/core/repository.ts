/**
 * Repository: orrery의 최상위 상태.
 *
 * 불변 갱신 원칙 — 명령 실행은 기존 Repository를 절대 수정하지 않고
 * 새 객체를 반환한다. undo/redo와 predict 모드(Phase 5)가 여기서 공짜로 나온다.
 * Map 복사 비용이 문제될 규모가 아니므로 structural sharing 없이 단순 복사한다.
 */
import type { GitObject, Sha } from './objects';

export type Head =
  | { kind: 'symbolic'; ref: string } // 'refs/heads/main' — 브랜치를 가리킴
  | { kind: 'detached'; sha: Sha }; // 커밋을 직접 가리킴

export interface IndexEntry {
  name: string;
  sha: Sha; // staged blob
}

export interface Repository {
  /** `git init` 전에는 false — git 명령은 실패하고 가상 FS 명령만 동작한다 */
  initialized: boolean;
  objects: Map<Sha, GitObject>;
  refs: Map<string, Sha>; // 'refs/heads/main' → sha
  head: Head;
  index: Map<string, IndexEntry>; // filename → entry
  workingTree: Map<string, string>; // filename → content (flat FS, '/' 금지)
  /**
   * stash 스택 — 각 원소는 WIP 커밋의 sha, [0]이 최신(stash@{0}).
   * SIMPLIFIED: 실제 git은 refs/stash + reflog로 스택을 만들지만
   * reflog가 스코프 아웃이므로 배열로 직접 모델링한다.
   */
  stashes: Sha[];
  clock: number; // 시뮬레이션 시계 (커밋 타임스탬프용 단조 증가 카운터)
}

/** HEAD가 최종적으로 가리키는 커밋. unborn branch(첫 커밋 전)면 undefined. */
export function resolveHead(repo: Repository): Sha | undefined {
  return repo.head.kind === 'detached' ? repo.head.sha : repo.refs.get(repo.head.ref);
}

/** git init 전의 빈 작업 디렉터리. 파일을 만들고 나서 init하는 것도 실제 git처럼 가능하다. */
export function createRepository(): Repository {
  return {
    initialized: false,
    objects: new Map(),
    refs: new Map(),
    head: { kind: 'symbolic', ref: 'refs/heads/main' },
    index: new Map(),
    workingTree: new Map(),
    stashes: [],
    clock: 0,
  };
}
