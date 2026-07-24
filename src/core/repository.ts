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

/**
 * index 엔트리 — 평시에는 staged blob 하나(stage 0에 해당),
 * 머지 충돌 중에는 세 버전이 stage 번호로 공존한다 (실제 git과 동일):
 *   stage 1 = 공통 조상(base), stage 2 = 우리 쪽(ours), stage 3 = 그쪽(theirs)
 * add/add 충돌이면 1이 없고, 한쪽 삭제 충돌이면 2 또는 3이 없다.
 */
export type IndexEntry =
  | { name: string; conflicted?: false; sha: Sha }
  | { name: string; conflicted: true; stages: { 1?: Sha; 2?: Sha; 3?: Sha } };

/** 평시(stage 0) 엔트리의 sha. 충돌 엔트리면 undefined */
export function stagedSha(entry: IndexEntry | undefined): Sha | undefined {
  return entry !== undefined && entry.conflicted !== true ? entry.sha : undefined;
}

/** 충돌(unmerged) 상태인 파일 이름들 (이름순) */
export function conflictedFiles(repo: Repository): string[] {
  return [...repo.index.values()]
    .filter((e) => e.conflicted === true)
    .map((e) => e.name)
    .sort();
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
  /**
   * 진행 중인 머지 — 실제 git의 MERGE_HEAD + MERGE_MSG에 해당.
   * 충돌 해소 후 git commit이 이것을 소비해 부모 2개 커밋을 만든다.
   */
  merging?: { theirs: Sha; message: string };
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
