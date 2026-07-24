/**
 * `git commit -m` — index의 스냅샷으로 tree 객체를 만들고,
 * 그 tree를 가리키는 commit 객체를 만들어 HEAD의 브랜치를 전진시킨다.
 *
 * "커밋할 게 있는가"의 판정이 우아한 지점: index로 tree를 만들어 해싱했을 때
 * HEAD 커밋의 tree와 sha가 같으면 내용이 정확히 같다는 뜻이다 — 비교가 해시
 * 한 번으로 끝난다. content-addressed 저장의 힘.
 */
import type { GitObject, TreeEntry } from '../objects';
import { hashObject, shortSha } from '../objects';
import type { Repository } from '../repository';
import { resolveHead } from '../repository';
import { getCommit } from '../revision';
import { formatDate } from './log';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success } from '../result';
import { computeStatus } from '../status';

// SIMPLIFIED: config(user.name/user.email)가 없으므로 고정 identity를 쓴다
export const AUTHOR_NAME = 'Orrery';
export const AUTHOR_EMAIL = 'orrery@example.com';

/** index == HEAD tree일 때, 실제 git이 내는 세 갈래의 "커밋할 것 없음" 문구 */
function nothingToCommitError(repo: Repository, isInitial: boolean): string {
  const { entries } = computeStatus(repo);
  const modified = entries.some((e) => e.worktree === 'modified' || e.worktree === 'deleted');
  const untracked = entries.some((e) => e.worktree === 'untracked');

  if (modified) return 'no changes added to commit (use "git add" and/or "git commit -a")';
  if (untracked) return 'nothing added to commit but untracked files present (use "git add" to track)';
  return isInitial
    ? 'nothing to commit (create/copy files and use "git add" to track)'
    : 'nothing to commit, working tree clean';
}

export function gitCommit(repo: Repository, rawMessage: string): CommandResult {
  if (rawMessage.trim() === '') {
    return failure(repo, 'Aborting commit due to empty commit message.');
  }
  // git의 기본 cleanup처럼 끝 개행을 정리하고 정확히 하나만 남긴다
  const message = `${rawMessage.replace(/\n+$/, '')}\n`;

  const headSha = resolveHead(repo);

  // index → tree 객체
  const entries: TreeEntry[] = [...repo.index.values()].map((e) => ({
    mode: '100644',
    name: e.name,
    sha: e.sha,
  }));
  const tree: GitObject = { type: 'tree', entries };
  const treeSha = hashObject(tree);

  // 커밋할 것 없음 판정
  if (headSha === undefined) {
    if (repo.index.size === 0) return failure(repo, nothingToCommitError(repo, true));
  } else if (getCommit(repo, headSha).tree === treeSha) {
    return failure(repo, nothingToCommitError(repo, false));
  }

  const timestamp = repo.clock + 1;
  const signature = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp };
  const commit: GitObject = {
    type: 'commit',
    tree: treeSha,
    parents: headSha === undefined ? [] : [headSha],
    author: signature,
    committer: signature,
    message,
  };
  const commitSha = hashObject(commit);

  const objects = new Map(repo.objects);
  const diff = emptyDiff();
  if (!objects.has(treeSha)) {
    objects.set(treeSha, tree);
    diff.createdObjects.push(treeSha);
  }
  objects.set(commitSha, commit);
  diff.createdObjects.push(commitSha);

  const next: Repository = { ...repo, objects, clock: timestamp };

  let label: string;
  if (repo.head.kind === 'symbolic') {
    const refs = new Map(repo.refs);
    refs.set(repo.head.ref, commitSha);
    next.refs = refs;
    diff.movedRefs.push({ ref: repo.head.ref, from: headSha, to: commitSha });
    label = repo.head.ref.replace(/^refs\/heads\//, '');
  } else {
    next.head = { kind: 'detached', sha: commitSha };
    diff.headChange = { from: repo.head, to: next.head };
    label = 'detached HEAD';
  }

  const rootMarker = headSha === undefined ? ' (root-commit)' : '';
  const summary = message.split('\n')[0];
  // SIMPLIFIED: 실제 git이 뒤에 붙이는 "N files changed, ..." 통계 줄은 생략
  return success(next, [`[${label}${rootMarker} ${shortSha(commitSha)}] ${summary}`], diff);
}

/**
 * `git commit --amend [-m <msg>]` — tip 커밋의 "수정"이 아니라 "교체"다.
 * 같은 부모를 가리키는 새 커밋을 만들고 브랜치를 옮긴다. 원래 커밋은
 * unreachable로 남는다 (그래프에서 그대로 보인다 — 해시가 왜 바뀌는지도).
 *
 * author는 원본 것을 유지하고 committer만 새로 찍는다 (실제 git 동작).
 * SIMPLIFIED: -m이 없으면 에디터 대신 --no-edit처럼 기존 메시지를 유지한다.
 */
export function gitCommitAmend(repo: Repository, rawMessage?: string): CommandResult {
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    return failure(repo, 'fatal: You have nothing to amend.');
  }
  const old = getCommit(repo, headSha);

  if (rawMessage !== undefined && rawMessage.trim() === '') {
    return failure(repo, 'Aborting commit due to empty commit message.');
  }
  const message =
    rawMessage === undefined ? old.message : `${rawMessage.replace(/\n+$/, '')}\n`;

  const entries: TreeEntry[] = [...repo.index.values()].map((e) => ({
    mode: '100644',
    name: e.name,
    sha: e.sha,
  }));
  const tree: GitObject = { type: 'tree', entries };
  const treeSha = hashObject(tree);

  const timestamp = repo.clock + 1;
  const commit: GitObject = {
    type: 'commit',
    tree: treeSha,
    parents: old.parents, // 부모는 그대로 — 히스토리에서 old를 밀어내고 그 자리에 선다
    author: old.author,
    committer: { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp },
    message,
  };
  const commitSha = hashObject(commit);

  const objects = new Map(repo.objects);
  const diff = emptyDiff();
  if (!objects.has(treeSha)) {
    objects.set(treeSha, tree);
    diff.createdObjects.push(treeSha);
  }
  objects.set(commitSha, commit);
  diff.createdObjects.push(commitSha);

  const next: Repository = { ...repo, objects, clock: timestamp };

  let label: string;
  if (repo.head.kind === 'symbolic') {
    const refs = new Map(repo.refs);
    refs.set(repo.head.ref, commitSha);
    next.refs = refs;
    diff.movedRefs.push({ ref: repo.head.ref, from: headSha, to: commitSha });
    label = repo.head.ref.replace(/^refs\/heads\//, '');
  } else {
    next.head = { kind: 'detached', sha: commitSha };
    diff.headChange = { from: repo.head, to: next.head };
    label = 'detached HEAD';
  }

  // 실제 git처럼 원본 author 날짜를 Date: 줄로 보여준다 (amend는 root 마커를 붙이지 않는다)
  return success(
    next,
    [
      `[${label} ${shortSha(commitSha)}] ${message.split('\n')[0]}`,
      ` Date: ${formatDate(old.author.timestamp)}`,
    ],
    diff,
  );
}
