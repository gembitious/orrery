/**
 * `git stash` / `git stash pop` / `git stash list`
 *
 * stash의 실체는 커밋 2개다 — 이것을 그래프에 노출하는 것이 orrery의 존재 이유:
 *   index 커밋: tree = 현재 index,        parent  = HEAD
 *   WIP 커밋:   tree = working tree 상태, parents = [HEAD, index 커밋]  ← 머지 모양!
 * refs/stash가 WIP 커밋을 가리킨다 (orrery는 reflog 대신 stashes 배열).
 *
 * pop의 복원 규칙 (실제 git 2.43 관찰과 일치):
 *   - 수정은 unstaged로 평탄화된다 (--index를 줘야 staged가 복원되지만 미지원)
 *   - 단, base에 없던 새 파일(staged였던)은 다시 staged로 돌아온다
 *   - 적용 대상 파일에 로컬 변경이 있으면 거부하고 stash를 유지한다
 * SIMPLIFIED: 실제 git의 pop은 3-way 머지지만, 여기서는 WIP 내용을 그대로
 * 적용하고 충돌 나는 파일이 있으면 통째로 거부한다 (충돌 모델은 4.2에서).
 */
import type { GitObject, Sha, TreeEntry } from '../objects';
import { hashObject, shortSha } from '../objects';
import type { IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult, StateDiff } from '../result';
import { emptyDiff, failure, success, workspaceDiff } from '../result';
import { blobContent, commitTreeMap, getCommit } from '../revision';
import { computeStatus } from '../status';
import { AUTHOR_EMAIL, AUTHOR_NAME } from './commit';
import { gitStatus } from './status';

function branchLabel(repo: Repository): string {
  return repo.head.kind === 'symbolic'
    ? repo.head.ref.replace(/^refs\/heads\//, '')
    : '(no branch)';
}

function treeFromMap(entries: Map<string, Sha>): GitObject {
  const list: TreeEntry[] = [...entries].map(([name, sha]) => ({ mode: '100644', name, sha }));
  return { type: 'tree', entries: list };
}

/** objects에 없으면 넣고 createdObjects에 기록한다 */
function store(objects: Map<Sha, GitObject>, diff: StateDiff, obj: GitObject): Sha {
  const sha = hashObject(obj);
  if (!objects.has(sha)) {
    objects.set(sha, obj);
    diff.createdObjects.push(sha);
  }
  return sha;
}

export function gitStash(repo: Repository): CommandResult {
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    return failure(repo, 'You do not have the initial commit yet');
  }

  const entries = computeStatus(repo).entries;
  const hasChanges = entries.some(
    (e) => e.index !== undefined || (e.worktree !== undefined && e.worktree !== 'untracked'),
  );
  if (!hasChanges) {
    // 실제 git도 에러가 아니라 안내만 하고 끝난다 (untracked는 stash 대상이 아니므로 무시)
    return success(repo, ['No local changes to save']);
  }

  const head = getCommit(repo, headSha);
  const subject = `${shortSha(headSha)} ${head.message.split('\n')[0]}`;
  const label = branchLabel(repo);

  const objects = new Map(repo.objects);
  const diff = emptyDiff();

  // ① index 커밋: 지금 staged된 스냅샷
  const indexTreeSha = store(
    objects,
    diff,
    treeFromMap(new Map([...repo.index].map(([name, e]) => [name, e.sha]))),
  );
  const indexSig = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp: repo.clock + 1 };
  const indexCommitSha = store(objects, diff, {
    type: 'commit',
    tree: indexTreeSha,
    parents: [headSha],
    author: indexSig,
    committer: indexSig,
    message: `index on ${label}: ${subject}\n`,
  });

  // ② WIP 커밋: tracked 파일들의 working tree 상태 (untracked 제외)
  const wipEntries = new Map<string, Sha>();
  for (const name of repo.index.keys()) {
    const content = repo.workingTree.get(name);
    if (content === undefined) continue; // WT에서 지운 파일은 WIP tree에도 없다
    wipEntries.set(name, store(objects, diff, { type: 'blob', content }));
  }
  const wipTreeSha = store(objects, diff, treeFromMap(wipEntries));
  const wipSig = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp: repo.clock + 2 };
  const wipCommitSha = store(objects, diff, {
    type: 'commit',
    tree: wipTreeSha,
    parents: [headSha, indexCommitSha], // 머지 모양 — 그래프에서 두 갈래가 보인다
    author: wipSig,
    committer: wipSig,
    message: `WIP on ${label}: ${subject}\n`,
  });

  // ③ working tree와 index를 HEAD로 되돌린다 (untracked는 보존)
  const headTree = commitTreeMap(repo, headSha);
  const index = new Map<string, IndexEntry>(
    [...headTree].map(([name, sha]) => [name, { name, sha }]),
  );
  const workingTree = new Map<string, string>();
  for (const [name, sha] of headTree) workingTree.set(name, blobContent(repo, sha));
  for (const [name, content] of repo.workingTree) {
    if (!repo.index.has(name) && !headTree.has(name)) workingTree.set(name, content);
  }

  const wsDiff = workspaceDiff(repo, index, workingTree);
  diff.indexChanges = wsDiff.indexChanges;
  diff.workingTreeChanges = wsDiff.workingTreeChanges;

  const next: Repository = {
    ...repo,
    objects,
    index,
    workingTree,
    stashes: [wipCommitSha, ...repo.stashes],
    clock: repo.clock + 2,
  };
  return success(next, [`Saved working directory and index state WIP on ${label}: ${subject}`], diff);
}

export function gitStashPop(repo: Repository): CommandResult {
  const wipSha = repo.stashes[0];
  if (wipSha === undefined) {
    return failure(repo, 'No stash entries found.');
  }

  const wip = getCommit(repo, wipSha);
  const baseSha = wip.parents[0];
  const indexCommitSha = wip.parents[1];
  if (baseSha === undefined || indexCommitSha === undefined) {
    throw new Error('orrery 내부 오류: stash 커밋의 부모가 2개가 아닙니다');
  }
  const baseTree = commitTreeMap(repo, baseSha);
  const wipTree = commitTreeMap(repo, wipSha);
  const indexTree = commitTreeMap(repo, indexCommitSha);
  const statusByFile = new Map(computeStatus(repo).entries.map((e) => [e.file, e]));

  const files = [...new Set([...baseTree.keys(), ...wipTree.keys(), ...indexTree.keys()])].sort();

  // 충돌 검사: WT를 건드릴 파일에 로컬 변경(untracked 포함)이 있으면 거부
  const blocked = files.filter(
    (file) => wipTree.get(file) !== baseTree.get(file) && statusByFile.has(file),
  );
  if (blocked.length > 0) {
    return failure(
      repo,
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        `${blocked.map((f) => `\t${f}`).join('\n')}\n` +
        'Please commit your changes or stash them before you merge.\nAborting\n' +
        'The stash entry is kept in case you need it again.',
    );
  }

  const workingTree = new Map(repo.workingTree);
  const index = new Map(repo.index);
  for (const file of files) {
    const inWip = wipTree.get(file);
    if (inWip !== baseTree.get(file)) {
      if (inWip === undefined) workingTree.delete(file);
      else workingTree.set(file, blobContent(repo, inWip));
    }
    // base에 없던 새 파일(staged였던)만 index에 복원된다 — 수정은 unstaged로 평탄화
    const inIndex = indexTree.get(file);
    if (inIndex !== undefined && !baseTree.has(file)) {
      index.set(file, { name: file, sha: inIndex });
    }
  }

  const diff = workspaceDiff(repo, index, workingTree);
  const next: Repository = { ...repo, index, workingTree, stashes: repo.stashes.slice(1) };
  // 실제 git처럼 적용 후의 status 전체를 출력하고 Dropped 줄로 마감한다
  const statusLines = gitStatus(next).output;
  return success(next, [...statusLines, `Dropped refs/stash@{0} (${wipSha})`], diff);
}

export function gitStashList(repo: Repository): CommandResult {
  const lines = repo.stashes.map((sha, i) => {
    const message = getCommit(repo, sha).message.split('\n')[0];
    return `stash@{${i}}: ${message}`;
  });
  return success(repo, lines);
}
