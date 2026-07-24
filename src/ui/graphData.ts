/**
 * 그래프 렌더링용 데이터 준비 (순수 함수 — React 무관).
 * SIMPLIFIED: 2.1에서는 단일 레인에 시간순 나열만 한다.
 * 레인(lane) 배정 레이아웃 알고리즘은 2.2에서 이 모듈을 대체/확장한다.
 */
import type { Sha } from '../core/objects';
import type { Repository } from '../core/repository';
import type { CommitObject } from '../core/revision';

export interface CommitNode {
  sha: Sha;
  commit: CommitObject;
}

/** 모든 커밋을 최신순으로 나열한다. 시뮬레이션 시계가 단조 증가라 정렬 기준으로 안전하다 */
export function listCommitsByTime(repo: Repository): CommitNode[] {
  const nodes: CommitNode[] = [];
  for (const [sha, obj] of repo.objects) {
    if (obj.type === 'commit') nodes.push({ sha, commit: obj });
  }
  return nodes.sort((a, b) => b.commit.committer.timestamp - a.commit.committer.timestamp);
}

export interface CommitLabels {
  /** HEAD가 symbolic으로 붙어 있는 브랜치 (이 커밋에서 HEAD → 브랜치로 그린다) */
  headBranch?: string;
  /** HEAD가 이 커밋을 직접 가리킴 (detached) */
  detachedHead: boolean;
  /** 이 커밋을 가리키는 나머지 브랜치들 (이름순) */
  branches: string[];
  /** 이 커밋을 가리키는 stash 라벨 ('stash@{0}' 등 — WIP 커밋에 붙는다) */
  stashes: string[];
}

/** 커밋 sha → 그 커밋에 그릴 ref 라벨들. HEAD의 두 형태가 구분되는 것이 핵심 */
export function collectLabels(repo: Repository): Map<Sha, CommitLabels> {
  const map = new Map<Sha, CommitLabels>();
  const get = (sha: Sha): CommitLabels => {
    let labels = map.get(sha);
    if (labels === undefined) {
      labels = { detachedHead: false, branches: [], stashes: [] };
      map.set(sha, labels);
    }
    return labels;
  };

  const headBranchRef = repo.head.kind === 'symbolic' ? repo.head.ref : undefined;
  for (const [ref, sha] of repo.refs) {
    if (!ref.startsWith('refs/heads/')) continue;
    const name = ref.slice('refs/heads/'.length);
    if (ref === headBranchRef) {
      get(sha).headBranch = name;
    } else {
      get(sha).branches.push(name);
    }
  }
  for (const labels of map.values()) labels.branches.sort();

  if (repo.head.kind === 'detached') {
    get(repo.head.sha).detachedHead = true;
  }
  repo.stashes.forEach((sha, i) => {
    get(sha).stashes.push(`stash@{${i}}`);
  });
  return map;
}

/**
 * 토글 OFF일 때 그래프에서 숨길 stash 내부 커밋들:
 * 각 WIP 커밋과 그 두 번째 부모(index 커밋).
 */
export function stashInternalCommits(repo: Repository): Set<Sha> {
  const hidden = new Set<Sha>();
  for (const wipSha of repo.stashes) {
    hidden.add(wipSha);
    const wip = repo.objects.get(wipSha);
    if (wip?.type === 'commit' && wip.parents[1] !== undefined) {
      hidden.add(wip.parents[1]);
    }
  }
  return hidden;
}
