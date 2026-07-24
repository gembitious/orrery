/**
 * `git rebase <branch|commit>` — 내 커밋들을 대상 위에 "재적용"한다.
 *
 * 핵심 학습 포인트: 커밋은 이동하지 않는다. 같은 변경 내용으로 새 커밋이
 * 만들어질 뿐이고(부모가 다르므로 해시가 반드시 바뀐다), 원본 커밋들은
 * unreachable로 그래프에 남는다 — 재적용의 실체가 눈에 보인다.
 *
 * SIMPLIFIED:
 * - 머지 커밋이 포함된 구간의 rebase는 지원하지 않는다 (실제 git은 기본적으로
 *   머지 커밋을 버리고 평탄화한다)
 * - 재적용 중 충돌이 나면 --continue 상태로 멈추는 대신 rebase 전체를 취소한다
 */
import type { GitObject, Sha, TreeEntry } from '../objects';
import { hashObject, shortSha } from '../objects';
import type { Head, IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success, workspaceDiff } from '../result';
import { threeWayTrees } from '../merge3';
import { blobContent, commitTreeMap, getCommit, isAncestor, resolveRevision } from '../revision';
import { computeStatus } from '../status';
import { AUTHOR_EMAIL, AUTHOR_NAME } from './commit';

/** rebase/cherry-pick 공통: 깨끗한 상태 요구 (실제 git 문구) */
export function dirtyStateError(repo: Repository, verb: string): string | undefined {
  const entries = computeStatus(repo).entries;
  if (entries.some((e) => e.worktree === 'modified' || e.worktree === 'deleted' || e.unmerged !== undefined)) {
    return `error: cannot ${verb}: You have unstaged changes.\nerror: Please commit or stash them.`;
  }
  if (entries.some((e) => e.index !== undefined)) {
    return `error: cannot ${verb}: Your index contains uncommitted changes.\nerror: Please commit or stash them.`;
  }
  return undefined;
}

export function gitRebase(repo: Repository, targetText: string): CommandResult {
  const headSha = resolveHead(repo);
  const target = headSha === undefined ? undefined : resolveRevision(repo, targetText);
  if (headSha === undefined || target === undefined) {
    return failure(repo, `fatal: invalid upstream '${targetText}'`);
  }

  const dirty = dirtyStateError(repo, 'rebase');
  if (dirty !== undefined) return failure(repo, dirty);

  const branchLabel =
    repo.head.kind === 'symbolic' ? repo.head.ref.replace(/^refs\/heads\//, '') : undefined;

  // 대상이 이미 내 조상이면 할 일이 없다
  if (isAncestor(repo, target, headSha)) {
    return success(repo, [`Current branch ${branchLabel ?? 'HEAD'} is up to date.`]);
  }

  const doneMessage = `Successfully rebased and updated ${
    repo.head.kind === 'symbolic' ? repo.head.ref : 'detached HEAD'
  }.`;

  // 내가 대상의 조상이면 fast-forward로 끝난다
  if (isAncestor(repo, headSha, target)) {
    return finishRebase(repo, headSha, target, emptyDiff(), doneMessage);
  }

  // 재적용할 커밋들: HEAD에서 first-parent로 대상과의 공통 조상까지
  const chain: Sha[] = [];
  let cursor: Sha | undefined = headSha;
  while (cursor !== undefined && !isAncestor(repo, cursor, target)) {
    const commit = getCommit(repo, cursor);
    if (commit.parents.length > 1) {
      return failure(repo, 'orrery: 머지 커밋이 포함된 구간의 rebase는 아직 지원하지 않습니다');
    }
    chain.push(cursor);
    cursor = commit.parents[0];
  }
  chain.reverse(); // 오래된 것부터 재적용

  const objects = new Map(repo.objects);
  const diff = emptyDiff();
  let newBase = target;
  let newBaseTree = commitTreeMap(repo, target);
  let clock = repo.clock;

  for (const originalSha of chain) {
    const original = getCommit(repo, originalSha);
    const parentTree =
      original.parents[0] === undefined
        ? new Map<string, Sha>()
        : commitTreeMap(repo, original.parents[0]);
    const { merged, conflicts } = threeWayTrees(parentTree, newBaseTree, commitTreeMap(repo, originalSha));

    if (conflicts.length > 0) {
      const subject = original.message.split('\n')[0];
      return failure(
        repo,
        `${conflicts.map((f) => `Auto-merging ${f}\nCONFLICT (content): Merge conflict in ${f}`).join('\n')}\n` +
          `error: could not apply ${shortSha(originalSha)}... ${subject}\n` +
          '(orrery: rebase 충돌 해소(--continue)는 지원하지 않습니다 — rebase가 취소됩니다)',
      );
    }

    const treeEntries: TreeEntry[] = [...merged].map(([name, sha]) => ({ mode: '100644', name, sha }));
    const tree: GitObject = { type: 'tree', entries: treeEntries };
    const treeSha = hashObject(tree);
    if (!objects.has(treeSha)) {
      objects.set(treeSha, tree);
      diff.createdObjects.push(treeSha);
    }

    clock += 1;
    const commit: GitObject = {
      type: 'commit',
      tree: treeSha,
      parents: [newBase],
      author: original.author, // author는 유지, committer만 새로 — 그래도 해시는 바뀐다
      committer: { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp: clock },
      message: original.message,
    };
    const commitSha = hashObject(commit);
    objects.set(commitSha, commit);
    diff.createdObjects.push(commitSha);

    newBase = commitSha;
    newBaseTree = merged;
  }

  const withObjects: Repository = { ...repo, objects, clock };
  return finishRebase(withObjects, headSha, newBase, diff, doneMessage);
}

/** 브랜치/HEAD를 newTip으로 옮기고 index/WT를 그 tree로 교체한다 (untracked 보존) */
function finishRebase(
  repo: Repository,
  oldHead: Sha,
  newTip: Sha,
  diff: ReturnType<typeof emptyDiff>,
  message: string,
): CommandResult {
  const tipTree = commitTreeMap(repo, newTip);
  const index = new Map<string, IndexEntry>(
    [...tipTree].map(([name, sha]) => [name, { name, sha }]),
  );
  const workingTree = new Map<string, string>();
  for (const [name, sha] of tipTree) workingTree.set(name, blobContent(repo, sha));
  for (const [name, content] of repo.workingTree) {
    if (!repo.index.has(name) && !tipTree.has(name)) workingTree.set(name, content);
  }

  const wsDiff = workspaceDiff(repo, index, workingTree);
  diff.indexChanges = wsDiff.indexChanges;
  diff.workingTreeChanges = wsDiff.workingTreeChanges;

  const next: Repository = { ...repo, index, workingTree };
  if (repo.head.kind === 'symbolic') {
    const refs = new Map(repo.refs);
    refs.set(repo.head.ref, newTip);
    next.refs = refs;
    diff.movedRefs.push({ ref: repo.head.ref, from: oldHead, to: newTip });
  } else {
    const head: Head = { kind: 'detached', sha: newTip };
    next.head = head;
    diff.headChange = { from: repo.head, to: head };
  }
  return success(next, [message], diff);
}
