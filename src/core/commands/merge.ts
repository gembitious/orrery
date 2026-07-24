/**
 * `git merge <브랜치|커밋>` — 두 가지 전혀 다른 동작이 한 이름을 쓴다:
 *
 *   fast-forward : 내 커밋이 대상의 조상이면, 커밋을 만들지 않고
 *                  브랜치 포인터만 앞으로 밀고 트리를 전환한다 (checkout과 같은 규칙)
 *   3-way        : 히스토리가 갈라졌으면 공통 조상(merge base)을 기준으로
 *                  양쪽 변경을 합쳐 부모 2개짜리 머지 커밋을 만든다
 *
 * 3-way의 파일별 규칙: 양쪽이 같으면 그것, 한쪽만 바꿨으면 바꾼 쪽.
 * 양쪽이 서로 다르게 바꿨으면 충돌 — SIMPLIFIED: 4.1에서는 실제 git의
 * CONFLICT 문구와 함께 거부만 한다 (충돌 상태 모델링은 4.2에서).
 */
import type { GitObject, Sha, TreeEntry } from '../objects';
import { hashObject, shortSha } from '../objects';
import type { Head, IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success, workspaceDiff } from '../result';
import { blobContent, commitTreeMap, getCommit, isAncestor, resolveRevision } from '../revision';
import { computeStatus } from '../status';
import { AUTHOR_EMAIL, AUTHOR_NAME } from './commit';
import { planSwitch } from './checkout';

/** 공통 조상 탐색 — a의 조상 집합을 만들고 b에서 BFS로 처음 만나는 것 */
function mergeBase(repo: Repository, a: Sha, b: Sha): Sha | undefined {
  const ancestorsOfA = new Set<Sha>();
  const queue: Sha[] = [a];
  while (queue.length > 0) {
    const sha = queue.pop();
    if (sha === undefined || ancestorsOfA.has(sha)) continue;
    ancestorsOfA.add(sha);
    queue.push(...getCommit(repo, sha).parents);
  }
  // SIMPLIFIED: criss-cross(공통 조상 여러 개)면 처음 만나는 것 하나만 쓴다
  const bfs: Sha[] = [b];
  const seen = new Set<Sha>();
  while (bfs.length > 0) {
    const sha = bfs.shift();
    if (sha === undefined || seen.has(sha)) continue;
    seen.add(sha);
    if (ancestorsOfA.has(sha)) return sha;
    bfs.push(...getCommit(repo, sha).parents);
  }
  return undefined;
}

export function gitMerge(repo: Repository, targetText: string): CommandResult {
  const headSha = resolveHead(repo);
  const target = headSha === undefined ? undefined : resolveRevision(repo, targetText);
  if (headSha === undefined || target === undefined) {
    return failure(repo, `merge: ${targetText} - not something we can merge`);
  }

  if (isAncestor(repo, target, headSha)) {
    return success(repo, ['Already up to date.']);
  }

  // ── fast-forward ────────────────────────────────
  if (isAncestor(repo, headSha, target)) {
    const plan = planSwitch(repo, target);
    if (plan.error !== undefined) return failure(repo, plan.error);

    const diff = workspaceDiff(repo, plan.index, plan.workingTree);
    const next: Repository = { ...repo, index: plan.index, workingTree: plan.workingTree };
    if (repo.head.kind === 'symbolic') {
      const refs = new Map(repo.refs);
      refs.set(repo.head.ref, target);
      next.refs = refs;
      diff.movedRefs.push({ ref: repo.head.ref, from: headSha, to: target });
    } else {
      const head: Head = { kind: 'detached', sha: target };
      next.head = head;
      diff.headChange = { from: repo.head, to: head };
    }
    // SIMPLIFIED: 뒤따르는 diffstat(파일별 변경 통계) 줄은 생략
    return success(next, [`Updating ${shortSha(headSha)}..${shortSha(target)}`, 'Fast-forward'], diff);
  }

  // ── 3-way ───────────────────────────────────────
  // 실제 git(ort): staged 변경이 있으면 merge 자체를 거부한다
  const status = computeStatus(repo);
  const stagedFiles = status.entries.filter((e) => e.index !== undefined).map((e) => e.file);
  if (stagedFiles.length > 0) {
    return failure(
      repo,
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        `${stagedFiles.map((f) => `  ${f}`).join('\n')}\n` +
        'Merge with strategy ort failed.',
    );
  }

  const baseSha = mergeBase(repo, headSha, target);
  if (baseSha === undefined) {
    return failure(repo, 'fatal: refusing to merge unrelated histories');
  }
  const baseTree = commitTreeMap(repo, baseSha);
  const oursTree = commitTreeMap(repo, headSha);
  const theirsTree = commitTreeMap(repo, target);

  const files = [
    ...new Set([...baseTree.keys(), ...oursTree.keys(), ...theirsTree.keys()]),
  ].sort();

  const merged = new Map<string, Sha>();
  const conflicts: string[] = [];
  for (const file of files) {
    const base = baseTree.get(file);
    const ours = oursTree.get(file);
    const theirs = theirsTree.get(file);
    const winner =
      ours === theirs ? ours // 양쪽이 같다 (둘 다 삭제 포함)
      : base === ours ? theirs // 우리는 안 바꿨다 → 그쪽 변경 채택
      : base === theirs ? ours // 그쪽은 안 바꿨다 → 우리 것 유지
      : null; // 양쪽이 서로 다르게 바꿨다
    if (winner === null) {
      conflicts.push(file);
    } else if (winner !== undefined) {
      merged.set(file, winner);
    }
  }

  if (conflicts.length > 0) {
    return failure(
      repo,
      `${conflicts.map((f) => `Auto-merging ${f}\nCONFLICT (content): Merge conflict in ${f}`).join('\n')}\n` +
        'Automatic merge failed; fix conflicts and then commit the result.\n' +
        '(orrery: 충돌 상태 모델링은 4.2에서 지원 예정 — 지금은 merge가 중단됩니다)',
    );
  }

  // 머지가 실제로 바꿀 파일에 로컬(unstaged/untracked) 변경이 있으면 거부
  const statusByFile = new Map(status.entries.map((e) => [e.file, e]));
  const changedFiles = files.filter((f) => merged.get(f) !== oursTree.get(f));
  const blocked = changedFiles.filter((f) => statusByFile.has(f));
  if (blocked.length > 0) {
    return failure(
      repo,
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        `${blocked.map((f) => `\t${f}`).join('\n')}\n` +
        'Please commit your changes or stash them before you merge.\nAborting',
    );
  }

  // 머지 커밋 생성
  const objects = new Map(repo.objects);
  const diff = emptyDiff();
  const treeEntries: TreeEntry[] = [...merged].map(([name, sha]) => ({ mode: '100644', name, sha }));
  const tree: GitObject = { type: 'tree', entries: treeEntries };
  const treeSha = hashObject(tree);
  if (!objects.has(treeSha)) {
    objects.set(treeSha, tree);
    diff.createdObjects.push(treeSha);
  }

  const currentBranch =
    repo.head.kind === 'symbolic' ? repo.head.ref.replace(/^refs\/heads\//, '') : undefined;
  const isBranch = repo.refs.has(`refs/heads/${targetText}`);
  const subject = isBranch ? `Merge branch '${targetText}'` : `Merge commit '${targetText}'`;
  const into = currentBranch !== undefined && currentBranch !== 'main' ? ` into ${currentBranch}` : '';
  const timestamp = repo.clock + 1;
  const signature = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp };
  const commit: GitObject = {
    type: 'commit',
    tree: treeSha,
    parents: [headSha, target], // 부모 2개 — 이것이 머지 커밋의 정의다
    author: signature,
    committer: signature,
    message: `${subject}${into}\n`,
  };
  const commitSha = hashObject(commit);
  objects.set(commitSha, commit);
  diff.createdObjects.push(commitSha);

  // index/WT를 머지 결과로: 바뀌는 파일만 교체, 무관한 로컬 변경은 유지
  const index = new Map<string, IndexEntry>([...merged].map(([name, sha]) => [name, { name, sha }]));
  const workingTree = new Map(repo.workingTree);
  for (const file of changedFiles) {
    const sha = merged.get(file);
    if (sha === undefined) workingTree.delete(file);
    else workingTree.set(file, blobContent(repo, sha));
  }

  const wsDiff = workspaceDiff(repo, index, workingTree);
  diff.indexChanges = wsDiff.indexChanges;
  diff.workingTreeChanges = wsDiff.workingTreeChanges;

  const next: Repository = { ...repo, objects, index, workingTree, clock: timestamp };
  if (repo.head.kind === 'symbolic') {
    const refs = new Map(repo.refs);
    refs.set(repo.head.ref, commitSha);
    next.refs = refs;
    diff.movedRefs.push({ ref: repo.head.ref, from: headSha, to: commitSha });
  } else {
    const head: Head = { kind: 'detached', sha: commitSha };
    next.head = head;
    diff.headChange = { from: repo.head, to: head };
  }

  return success(next, ["Merge made by the 'ort' strategy."], diff);
}
