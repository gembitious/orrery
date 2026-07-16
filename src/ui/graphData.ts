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
