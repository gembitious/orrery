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
import { conflictedFiles, resolveHead } from '../repository';
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

/**
 * `git merge --abort` — 머지 이전 상태로 복귀.
 * SIMPLIFIED: index/WT를 HEAD로 되돌린다 (untracked는 보존). 머지 전에 있던
 * 무관한 unstaged 변경까지는 복원하지 못한다 (orrery는 머지 전 스냅샷을 안 남긴다).
 */
export function gitMergeAbort(repo: Repository): CommandResult {
  if (repo.merging === undefined) {
    return failure(repo, 'fatal: There is no merge to abort (MERGE_HEAD missing).');
  }
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    throw new Error('orrery 내부 오류: 머지 중인데 HEAD가 unborn입니다');
  }
  const headTree = commitTreeMap(repo, headSha);
  const index = new Map<string, IndexEntry>(
    [...headTree].map(([name, sha]) => [name, { name, sha }]),
  );
  const workingTree = new Map<string, string>();
  for (const [name, sha] of headTree) workingTree.set(name, blobContent(repo, sha));
  for (const [name, content] of repo.workingTree) {
    if (!repo.index.has(name) && !headTree.has(name)) workingTree.set(name, content);
  }

  const diff = workspaceDiff(repo, index, workingTree);
  return success({ ...repo, index, workingTree, merging: undefined }, [], diff);
}

export function gitMerge(repo: Repository, targetText: string): CommandResult {
  if (conflictedFiles(repo).length > 0) {
    return failure(
      repo,
      'error: Merging is not possible because you have unmerged files.\n' +
        "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
        'hint: as appropriate to mark resolution and make a commit.\n' +
        'fatal: Exiting because of an unresolved conflict.',
    );
  }
  if (repo.merging !== undefined) {
    return failure(
      repo,
      'fatal: You have not concluded your merge (MERGE_HEAD exists).\n' +
        'Please, commit your changes before you merge.',
    );
  }
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

  // 머지가 실제로 바꿀 파일(충돌 파일 포함)에 로컬 변경이 있으면 거부
  const statusByFile = new Map(status.entries.map((e) => [e.file, e]));
  const changedFiles = files.filter((f) => merged.get(f) !== oursTree.get(f));
  const blocked = [...new Set([...changedFiles, ...conflicts])].filter((f) => statusByFile.has(f));
  if (blocked.length > 0) {
    return failure(
      repo,
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        `${blocked.sort().map((f) => `\t${f}`).join('\n')}\n` +
        'Please commit your changes or stash them before you merge.\nAborting',
    );
  }

  const subjectText = repo.refs.has(`refs/heads/${targetText}`)
    ? `Merge branch '${targetText}'`
    : `Merge commit '${targetText}'`;
  const intoBranch =
    repo.head.kind === 'symbolic' ? repo.head.ref.replace(/^refs\/heads\//, '') : undefined;
  const mergeMessage =
    intoBranch !== undefined && intoBranch !== 'main'
      ? `${subjectText} into ${intoBranch}`
      : subjectText;

  // ── 충돌: 저장소가 "머지 중" 상태가 된다 ─────────
  if (conflicts.length > 0) {
    const index = new Map(repo.index);
    const workingTree = new Map(repo.workingTree);

    // 깨끗하게 합쳐진 파일들은 평시대로 index+WT에 반영된다
    for (const file of changedFiles) {
      if (conflicts.includes(file)) continue;
      const sha = merged.get(file);
      if (sha === undefined) {
        index.delete(file);
        workingTree.delete(file);
      } else {
        index.set(file, { name: file, sha });
        workingTree.set(file, blobContent(repo, sha));
      }
    }

    const output: string[] = [];
    for (const file of conflicts) {
      const base = baseTree.get(file);
      const ours = oursTree.get(file);
      const theirs = theirsTree.get(file);
      // index: stage 1/2/3 — 비어 있는 stage가 곧 충돌의 종류를 말한다
      const stages: { 1?: Sha; 2?: Sha; 3?: Sha } = {};
      if (base !== undefined) stages[1] = base;
      if (ours !== undefined) stages[2] = ours;
      if (theirs !== undefined) stages[3] = theirs;
      index.set(file, { name: file, conflicted: true, stages });

      if (ours !== undefined && theirs !== undefined) {
        // 내용 충돌: working tree에 실제 충돌 마커를 쓴다
        workingTree.set(
          file,
          `<<<<<<< HEAD\n${blobContent(repo, ours)}\n=======\n${blobContent(repo, theirs)}\n>>>>>>> ${targetText}`,
        );
        output.push(`Auto-merging ${file}`, `CONFLICT (content): Merge conflict in ${file}`);
      } else {
        // modify/delete: 남아 있는 쪽의 버전이 working tree에 남는다
        const deletedIn = ours === undefined ? 'HEAD' : targetText;
        const modifiedIn = ours === undefined ? targetText : 'HEAD';
        const kept = ours ?? theirs;
        if (kept !== undefined) workingTree.set(file, blobContent(repo, kept));
        output.push(
          `CONFLICT (modify/delete): ${file} deleted in ${deletedIn} and modified in ${modifiedIn}.  ` +
            `Version ${modifiedIn} of ${file} left in tree.`,
        );
      }
    }
    output.push('Automatic merge failed; fix conflicts and then commit the result.');

    const diff = workspaceDiff(repo, index, workingTree);
    const next: Repository = {
      ...repo,
      index,
      workingTree,
      merging: { theirs: target, message: mergeMessage },
    };
    // 상태가 실제로 변했으므로 실패가 아니라 성공이다 (실제 git도 exit 1일 뿐 상태는 남는다)
    return success(next, output, diff);
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

  const timestamp = repo.clock + 1;
  const signature = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp };
  const commit: GitObject = {
    type: 'commit',
    tree: treeSha,
    parents: [headSha, target], // 부모 2개 — 이것이 머지 커밋의 정의다
    author: signature,
    committer: signature,
    message: `${mergeMessage}\n`,
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
