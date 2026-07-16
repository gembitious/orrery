/**
 * 3영역 비교 로직 — 이 프로젝트 정체성의 코어.
 *
 * git status는 두 개의 독립적인 비교를 합친 것이다:
 *   ① index vs HEAD tree   → "Changes to be committed" (staged)
 *   ② working tree vs index → "Changes not staged" + "Untracked"
 * 한 파일이 양쪽에 동시에 나타날 수 있다(add 후 또 수정 = staged+modified).
 *
 * 이 함수는 UI 3영역 패널이 그대로 재사용한다 — 여기서 계산한 상태가
 * 곧 화면의 파일 배지다. 출력 포맷팅은 commands/status.ts에 있다.
 */
import type { Sha } from './objects';
import { hashObject } from './objects';
import type { Repository } from './repository';
import { resolveHead } from './repository';

export type IndexState = 'added' | 'modified' | 'deleted';
export type WorktreeState = 'modified' | 'deleted' | 'untracked';

export interface StatusEntry {
  file: string;
  /** index vs HEAD (staged 변경). 없으면 undefined */
  index?: IndexState;
  /** working tree vs index. 없으면 undefined */
  worktree?: WorktreeState;
}

export interface RepoStatus {
  /** symbolic HEAD의 브랜치 이름 ('main'). detached면 undefined */
  branch?: string;
  /** detached HEAD가 가리키는 커밋 */
  detachedAt?: Sha;
  /** 커밋이 하나도 없는 상태 (unborn branch) */
  initial: boolean;
  /** 변경이 있는 파일만, 이름순 정렬 */
  entries: StatusEntry[];
  clean: boolean;
}

/** HEAD 커밋의 tree를 filename → blob sha 맵으로 펼친다 */
function headTreeMap(repo: Repository): Map<string, Sha> {
  const map = new Map<string, Sha>();
  const headSha = resolveHead(repo);
  if (headSha === undefined) return map;

  const commit = repo.objects.get(headSha);
  if (commit?.type !== 'commit') return map;
  const tree = repo.objects.get(commit.tree);
  if (tree?.type !== 'tree') return map;

  for (const entry of tree.entries) map.set(entry.name, entry.sha);
  return map;
}

export function computeStatus(repo: Repository): RepoStatus {
  const headTree = headTreeMap(repo);
  const files = [
    ...new Set([...headTree.keys(), ...repo.index.keys(), ...repo.workingTree.keys()]),
  ].sort();

  const entries: StatusEntry[] = [];
  for (const file of files) {
    const inHead = headTree.get(file);
    const inIndex = repo.index.get(file)?.sha;
    const wtContent = repo.workingTree.get(file);
    // working tree 내용을 blob으로 해싱해 index와 비교 — add를 실제로 하지 않고도
    // "add하면 이 sha가 될 것"을 아는 것. SIMPLIFIED: 실제 git은 stat 캐시로
    // 매번 해싱하는 것을 피하지만, 이 규모에서는 매번 해싱해도 충분하다.
    const inWorktree =
      wtContent === undefined ? undefined : hashObject({ type: 'blob', content: wtContent });

    let index: IndexState | undefined;
    if (inIndex !== undefined && inHead === undefined) index = 'added';
    else if (inIndex !== undefined && inHead !== undefined && inIndex !== inHead)
      index = 'modified';
    else if (inIndex === undefined && inHead !== undefined) index = 'deleted';

    let worktree: WorktreeState | undefined;
    if (inIndex !== undefined) {
      if (inWorktree === undefined) worktree = 'deleted';
      else if (inWorktree !== inIndex) worktree = 'modified';
    } else if (inWorktree !== undefined) {
      // index에 없는 working tree 파일은 HEAD에 있었더라도 untracked다
      worktree = 'untracked';
    }

    if (index !== undefined || worktree !== undefined) {
      const entry: StatusEntry = { file };
      if (index !== undefined) entry.index = index;
      if (worktree !== undefined) entry.worktree = worktree;
      entries.push(entry);
    }
  }

  const status: RepoStatus = {
    initial: resolveHead(repo) === undefined,
    entries,
    clean: entries.length === 0,
  };
  if (repo.head.kind === 'symbolic') {
    status.branch = repo.head.ref.replace(/^refs\/heads\//, '');
  } else {
    status.detachedAt = repo.head.sha;
  }
  return status;
}
