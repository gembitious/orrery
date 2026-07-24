/**
 * `git cherry-pick <commit>` — 한 커밋의 "변경분"(부모와의 차이)을
 * 현재 HEAD 위에 새 커밋으로 재적용한다.
 *
 * rebase와 같은 재적용 기계를 쓴다: base = 그 커밋의 부모 tree,
 * ours = 지금 HEAD tree, theirs = 그 커밋의 tree.
 * author와 메시지는 원본을 유지하고 committer만 새로 — 해시는 당연히 바뀐다.
 *
 * SIMPLIFIED: 충돌 시 CHERRY_PICK_HEAD 상태로 멈추는 대신 취소한다.
 * 머지 커밋은 -m 옵션이 없으므로 실제 git처럼 거부한다.
 */
import type { GitObject, Sha, TreeEntry } from '../objects';
import { hashObject, shortSha } from '../objects';
import type { Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success, workspaceDiff } from '../result';
import { threeWayTrees } from '../merge3';
import { blobContent, commitTreeMap, getCommit, resolveRevision } from '../revision';
import { AUTHOR_EMAIL, AUTHOR_NAME } from './commit';
import { formatDate } from './log';
import { dirtyStateError } from './rebase';

export function gitCherryPick(repo: Repository, targetText: string): CommandResult {
  const headSha = resolveHead(repo);
  const target = headSha === undefined ? undefined : resolveRevision(repo, targetText);
  if (headSha === undefined || target === undefined) {
    return failure(repo, `fatal: bad revision '${targetText}'`);
  }

  const original = getCommit(repo, target);
  if (original.parents.length > 1) {
    return failure(
      repo,
      `error: commit ${target} is a merge but no -m option was given.\nfatal: cherry-pick failed`,
    );
  }

  const dirty = dirtyStateError(repo, 'cherry-pick');
  if (dirty !== undefined) return failure(repo, dirty);

  const parentTree =
    original.parents[0] === undefined
      ? new Map<string, Sha>()
      : commitTreeMap(repo, original.parents[0]);
  const headTree = commitTreeMap(repo, headSha);
  const { merged, conflicts } = threeWayTrees(parentTree, headTree, commitTreeMap(repo, target));

  const subject = original.message.split('\n')[0];
  if (conflicts.length > 0) {
    return failure(
      repo,
      `${conflicts.map((f) => `Auto-merging ${f}\nCONFLICT (content): Merge conflict in ${f}`).join('\n')}\n` +
        `error: could not apply ${shortSha(target)}... ${subject}\n` +
        '(orrery: cherry-pick 충돌 해소는 지원하지 않습니다 — cherry-pick이 취소됩니다)',
    );
  }

  const treeEntries: TreeEntry[] = [...merged].map(([name, sha]) => ({ mode: '100644', name, sha }));
  const tree: GitObject = { type: 'tree', entries: treeEntries };
  const treeSha = hashObject(tree);
  if (treeSha === getCommit(repo, headSha).tree) {
    return failure(repo, 'The previous cherry-pick is now empty, possibly due to conflict resolution.');
  }

  const objects = new Map(repo.objects);
  const diff = emptyDiff();
  if (!objects.has(treeSha)) {
    objects.set(treeSha, tree);
    diff.createdObjects.push(treeSha);
  }
  const timestamp = repo.clock + 1;
  const commit: GitObject = {
    type: 'commit',
    tree: treeSha,
    parents: [headSha],
    author: original.author, // 원본 author 유지
    committer: { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp },
    message: original.message,
  };
  const commitSha = hashObject(commit);
  objects.set(commitSha, commit);
  diff.createdObjects.push(commitSha);

  // index/WT: 바뀌는 파일만 교체 (무관한 로컬 상태 보존)
  const index = new Map(repo.index);
  const workingTree = new Map(repo.workingTree);
  for (const file of new Set([...headTree.keys(), ...merged.keys()])) {
    const before = headTree.get(file);
    const after = merged.get(file);
    if (before === after) continue;
    if (after === undefined) {
      index.delete(file);
      workingTree.delete(file);
    } else {
      index.set(file, { name: file, sha: after });
      workingTree.set(file, blobContent(repo, after));
    }
  }

  const wsDiff = workspaceDiff(repo, index, workingTree);
  diff.indexChanges = wsDiff.indexChanges;
  diff.workingTreeChanges = wsDiff.workingTreeChanges;

  const next: Repository = { ...repo, objects, index, workingTree, clock: timestamp };
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

  return success(
    next,
    [`[${label} ${shortSha(commitSha)}] ${subject}`, ` Date: ${formatDate(original.author.timestamp)}`],
    diff,
  );
}
