/**
 * 3영역 패널의 뷰 모델 (순수 함수 — React 무관).
 *
 * 한 파일을 한 행으로 정렬하고, 세 영역 각각에서의 "내용의 정체(blob sha)"를
 * 노출한다. 셀의 sha가 같으면 내용이 같다 — add/commit이 무엇을 스냅샷했는지,
 * 어느 영역이 어긋나 있는지가 해시만 봐도 드러난다.
 * 배지는 전부 computeStatus(git status와 동일 로직)에서 온다.
 */
import type { Sha } from '../core/objects';
import { hashObject } from '../core/objects';
import type { Repository } from '../core/repository';
import { resolveHead } from '../core/repository';
import { commitTreeMap } from '../core/revision';
import { computeStatus } from '../core/status';

export interface AreaRow {
  file: string;
  /** working tree 셀: 없으면 파일이 WT에 없음 */
  worktree?: { sha: Sha; badge?: 'untracked' | 'modified' | 'conflicted' };
  /** WT에 없는 것이 "변경"인 경우 (index에는 있음) — 유령 셀로 표시 */
  worktreeDeleted: boolean;
  index?: { sha: Sha; badge?: 'added' | 'modified' };
  /** staged 삭제 (HEAD에는 있고 index에서 빠짐) */
  indexDeleted: boolean;
  /** 충돌(unmerged): index 셀이 stage 1/2/3 세 버전을 품는다 */
  conflict?: { 1?: Sha; 2?: Sha; 3?: Sha };
  head?: { sha: Sha };
}

export interface AreasView {
  rows: AreaRow[];
  /** HEAD 컬럼 헤더에 붙일 컨텍스트: 브랜치명 / detached 표시 / unborn */
  headLabel: string;
}

export function buildAreasView(repo: Repository): AreasView {
  const headSha = resolveHead(repo);
  const headTree = headSha === undefined ? new Map<string, Sha>() : commitTreeMap(repo, headSha);
  const statusByFile = new Map(computeStatus(repo).entries.map((e) => [e.file, e]));

  const files = [
    ...new Set([...repo.workingTree.keys(), ...repo.index.keys(), ...headTree.keys()]),
  ].sort();

  const rows: AreaRow[] = files.map((file) => {
    const st = statusByFile.get(file);
    const row: AreaRow = { file, worktreeDeleted: false, indexDeleted: false };
    const indexEntry = repo.index.get(file);

    const wtContent = repo.workingTree.get(file);
    if (wtContent !== undefined) {
      row.worktree = { sha: hashObject({ type: 'blob', content: wtContent }) };
      if (st?.unmerged !== undefined) {
        row.worktree.badge = 'conflicted'; // 충돌 마커가 든 파일
      } else if (st?.worktree === 'untracked' || st?.worktree === 'modified') {
        row.worktree.badge = st.worktree;
      }
    } else if (st?.worktree === 'deleted') {
      row.worktreeDeleted = true;
    }

    if (indexEntry?.conflicted === true) {
      row.conflict = indexEntry.stages;
    } else if (indexEntry !== undefined) {
      row.index = { sha: indexEntry.sha };
      if (st?.index === 'added' || st?.index === 'modified') {
        row.index.badge = st.index;
      }
    } else if (st?.index === 'deleted') {
      row.indexDeleted = true;
    }

    const headBlob = headTree.get(file);
    if (headBlob !== undefined) row.head = { sha: headBlob };

    return row;
  });

  let headLabel: string;
  if (repo.head.kind === 'detached') {
    headLabel = 'detached';
  } else if (headSha === undefined) {
    headLabel = 'unborn';
  } else {
    headLabel = repo.head.ref.replace(/^refs\/heads\//, '');
  }

  return { rows, headLabel };
}
