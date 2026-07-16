/**
 * 커밋 참조 해석과 DAG 탐색 유틸리티.
 * branch/checkout(1.6), log(1.7), reset(3.1)이 공유한다.
 */
import type { GitObject, Sha } from './objects';
import type { Repository } from './repository';

export type CommitObject = Extract<GitObject, { type: 'commit' }>;

/** sha가 commit 객체임을 보장하며 가져온다. 위반은 저장소 불변식 깨짐 → throw */
export function getCommit(repo: Repository, sha: Sha): CommitObject {
  const obj = repo.objects.get(sha);
  if (obj === undefined || obj.type !== 'commit') {
    throw new Error(`orrery 내부 오류: ${sha}는 commit 객체가 아닙니다`);
  }
  return obj;
}

/** 커밋의 tree를 filename → blob sha 맵으로 펼친다 */
export function commitTreeMap(repo: Repository, commitSha: Sha): Map<string, Sha> {
  const commit = getCommit(repo, commitSha);
  const tree = repo.objects.get(commit.tree);
  if (tree?.type !== 'tree') {
    throw new Error(`orrery 내부 오류: ${commit.tree}는 tree 객체가 아닙니다`);
  }
  return new Map(tree.entries.map((e) => [e.name, e.sha]));
}

export function blobContent(repo: Repository, sha: Sha): string {
  const obj = repo.objects.get(sha);
  if (obj?.type !== 'blob') {
    throw new Error(`orrery 내부 오류: ${sha}는 blob 객체가 아닙니다`);
  }
  return obj.content;
}

/**
 * 브랜치 이름 또는 커밋 해시(전체/축약 ≥4자)를 커밋 sha로 해석한다.
 * 실제 git처럼 ref가 해시보다 우선한다.
 * SIMPLIFIED: 축약 해시가 모호하면(둘 이상 매칭) 에러 대신 미해석으로 처리.
 */
export function resolveCommitish(repo: Repository, text: string): Sha | undefined {
  const branchSha = repo.refs.get(`refs/heads/${text}`);
  if (branchSha !== undefined) return branchSha;

  if (!/^[0-9a-f]{4,40}$/.test(text)) return undefined;
  if (text.length === 40) {
    return repo.objects.get(text)?.type === 'commit' ? text : undefined;
  }
  const matches: Sha[] = [];
  for (const [sha, obj] of repo.objects) {
    if (obj.type === 'commit' && sha.startsWith(text)) matches.push(sha);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** ancestor가 descendant로부터 부모 체인으로 도달 가능한가 (자기 자신 포함) */
export function isAncestor(repo: Repository, ancestor: Sha, descendant: Sha): boolean {
  const queue: Sha[] = [descendant];
  const seen = new Set<Sha>();
  while (queue.length > 0) {
    const sha = queue.pop();
    if (sha === undefined) break;
    if (sha === ancestor) return true;
    if (seen.has(sha)) continue;
    seen.add(sha);
    queue.push(...getCommit(repo, sha).parents);
  }
  return false;
}
