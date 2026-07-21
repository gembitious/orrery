/**
 * `git checkout` — HEAD 전이 + index/working tree 교체.
 *
 * 핵심 규칙: checkout은 커밋되지 않은 작업을 지우지 않는다.
 * - 현재 트리와 대상 트리에서 "같은" 파일의 로컬 변경은 그대로 들고 간다.
 * - 트리 간에 "다른" 파일에 로컬 변경이 있으면 덮어쓰지 않고 거부한다.
 * 이 구분이 3영역 시각화에서 checkout을 흥미롭게 만드는 지점이다.
 */
import { hashObject, shortSha } from '../objects';
import type { Head, IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult, StateDiff } from '../result';
import { emptyDiff, failure, success } from '../result';
import { blobContent, commitTreeMap, getCommit, resolveCommitish } from '../revision';
import { computeStatus } from '../status';
import { isValidBranchName } from './branch';

interface SwitchPlan {
  index: Map<string, IndexEntry>;
  workingTree: Map<string, string>;
  error?: string;
}

/** 대상 커밋으로 전환했을 때의 index/working tree를 계산한다 (충돌이면 error) */
function planSwitch(repo: Repository, targetSha: string): SwitchPlan {
  const headSha = resolveHead(repo);
  const currentTree = headSha === undefined ? new Map() : commitTreeMap(repo, headSha);
  const targetTree = commitTreeMap(repo, targetSha);
  const statusByFile = new Map(computeStatus(repo).entries.map((e) => [e.file, e]));

  const files = [
    ...new Set([
      ...currentTree.keys(),
      ...targetTree.keys(),
      ...repo.index.keys(),
      ...repo.workingTree.keys(),
    ]),
  ].sort();

  const index = new Map<string, IndexEntry>();
  const workingTree = new Map<string, string>();
  const blockedLocal: string[] = [];
  const blockedUntracked: string[] = [];
  const blockedRemoved: string[] = [];

  for (const file of files) {
    const cur = currentTree.get(file);
    const tgt = targetTree.get(file);

    if (cur === tgt) {
      // 두 트리에서 같은 파일 — 로컬 상태(수정/스테이징/untracked)를 그대로 유지
      const entry = repo.index.get(file);
      if (entry !== undefined) index.set(file, entry);
      const content = repo.workingTree.get(file);
      if (content !== undefined) workingTree.set(file, content);
      continue;
    }

    const st = statusByFile.get(file);
    if (st === undefined) {
      // 로컬 변경 없음 — 대상 트리의 내용으로 교체 (대상에 없으면 제거)
      if (tgt !== undefined) {
        index.set(file, { name: file, sha: tgt });
        workingTree.set(file, blobContent(repo, tgt));
      }
      continue;
    }

    if (tgt === undefined && (st.index === 'deleted' || st.worktree === 'deleted')) {
      // 로컬에서 지운 파일을 대상 브랜치도 갖고 있지 않다 — 충돌이 아니라 삭제 확정
      // (실제 git 2.43으로 검증: 두 경우 모두 전환 허용, 결과는 clean)
      const content = repo.workingTree.get(file);
      if (content === undefined) continue;
      // 단, 삭제를 stage한 뒤 같은 이름으로 다시 만든 untracked 파일이 있으면
      // 대상 전환이 그 파일을 지워야 하므로 거부한다 (git의 "removed" 문구)
      blockedRemoved.push(file);
      continue;
    }

    if (st.index === undefined && st.worktree === 'untracked') {
      // untracked 파일 자리에 대상 트리가 파일을 놓으려 한다 (cur는 이 경우 항상 undefined)
      const content = repo.workingTree.get(file) ?? '';
      if (tgt !== undefined && tgt === hashObject({ type: 'blob', content })) {
        // 내용이 동일하면 실제 git처럼 조용히 채택 — 그 파일은 tracked가 된다
        index.set(file, { name: file, sha: tgt });
        workingTree.set(file, content);
      } else {
        blockedUntracked.push(file);
      }
      continue;
    }

    blockedLocal.push(file);
  }

  if (blockedLocal.length > 0) {
    return {
      index,
      workingTree,
      error:
        'error: Your local changes to the following files would be overwritten by checkout:\n' +
        `${blockedLocal.map((f) => `\t${f}`).join('\n')}\n` +
        'Please commit your changes or stash them before you switch branches.\nAborting',
    };
  }
  if (blockedUntracked.length > 0) {
    return {
      index,
      workingTree,
      error:
        'error: The following untracked working tree files would be overwritten by checkout:\n' +
        `${blockedUntracked.map((f) => `\t${f}`).join('\n')}\n` +
        'Please move or remove them before you switch branches.\nAborting',
    };
  }
  if (blockedRemoved.length > 0) {
    return {
      index,
      workingTree,
      error:
        'error: The following untracked working tree files would be removed by checkout:\n' +
        `${blockedRemoved.map((f) => `\t${f}`).join('\n')}\n` +
        'Please move or remove them before you switch branches.\nAborting',
    };
  }
  return { index, workingTree };
}

/** plan 적용 전후의 index/working tree 차이를 StateDiff로 기록한다 */
function diffFromPlan(repo: Repository, plan: SwitchPlan): StateDiff {
  const diff = emptyDiff();
  const files = [
    ...new Set([
      ...repo.workingTree.keys(),
      ...plan.workingTree.keys(),
      ...repo.index.keys(),
      ...plan.index.keys(),
    ]),
  ].sort();

  for (const file of files) {
    const wtBefore = repo.workingTree.get(file);
    const wtAfter = plan.workingTree.get(file);
    if (wtBefore === undefined && wtAfter !== undefined) {
      diff.workingTreeChanges.push({ file, kind: 'created' });
    } else if (wtBefore !== undefined && wtAfter === undefined) {
      diff.workingTreeChanges.push({ file, kind: 'deleted' });
    } else if (wtBefore !== wtAfter) {
      diff.workingTreeChanges.push({ file, kind: 'modified' });
    }

    const idxBefore = repo.index.get(file)?.sha;
    const idxAfter = plan.index.get(file)?.sha;
    if (idxBefore === undefined && idxAfter !== undefined) {
      diff.indexChanges.push({ file, kind: 'staged' });
    } else if (idxBefore !== undefined && idxAfter === undefined) {
      diff.indexChanges.push({ file, kind: 'unstaged' });
    } else if (idxBefore !== idxAfter) {
      diff.indexChanges.push({ file, kind: 'modified' });
    }
  }
  return diff;
}

export function gitCheckout(repo: Repository, target: string): CommandResult {
  const ref = `refs/heads/${target}`;
  const branchSha = repo.refs.get(ref);

  if (branchSha !== undefined) {
    if (repo.head.kind === 'symbolic' && repo.head.ref === ref) {
      return success(repo, [`Already on '${target}'`]);
    }
    const plan = planSwitch(repo, branchSha);
    if (plan.error !== undefined) return failure(repo, plan.error);

    const head: Head = { kind: 'symbolic', ref };
    const diff = diffFromPlan(repo, plan);
    diff.headChange = { from: repo.head, to: head };
    return success(
      { ...repo, head, index: plan.index, workingTree: plan.workingTree },
      [`Switched to branch '${target}'`],
      diff,
    );
  }

  const sha = resolveCommitish(repo, target);
  if (sha === undefined) {
    return failure(repo, `error: pathspec '${target}' did not match any file(s) known to git`);
  }

  const plan = planSwitch(repo, sha);
  if (plan.error !== undefined) return failure(repo, plan.error);

  const head: Head = { kind: 'detached', sha };
  const diff = diffFromPlan(repo, plan);
  diff.headChange = { from: repo.head, to: head };
  const summary = getCommit(repo, sha).message.split('\n')[0];
  // SIMPLIFIED: 실제 git이 덧붙이는 'git switch -c' 안내 단락은 생략
  return success(
    { ...repo, head, index: plan.index, workingTree: plan.workingTree },
    [
      `Note: switching to '${target}'.`,
      '',
      "You are in 'detached HEAD' state. You can look around, make experimental",
      'changes and commit them, and you can discard any commits you make in this',
      'state without impacting any branches by switching back to a branch.',
      '',
      `HEAD is now at ${shortSha(sha)} ${summary}`,
    ],
    diff,
  );
}

export function gitCheckoutNewBranch(
  repo: Repository,
  name: string,
  start?: string,
): CommandResult {
  if (!isValidBranchName(name)) {
    return failure(repo, `fatal: '${name}' is not a valid branch name`);
  }
  const ref = `refs/heads/${name}`;
  if (repo.refs.has(ref)) {
    return failure(repo, `fatal: a branch named '${name}' already exists`);
  }

  const headSha = resolveHead(repo);

  // unborn 상태에서의 -b: 아직 커밋이 없으므로 HEAD가 가리킬 브랜치 이름만 바꾼다
  if (start === undefined && headSha === undefined) {
    if (repo.head.kind !== 'symbolic') {
      throw new Error('orrery 내부 오류: detached HEAD는 커밋 없이 존재할 수 없습니다');
    }
    const head: Head = { kind: 'symbolic', ref };
    const diff = emptyDiff();
    diff.headChange = { from: repo.head, to: head };
    return success({ ...repo, head }, [`Switched to a new branch '${name}'`], diff);
  }

  const startSha = start === undefined ? headSha : resolveCommitish(repo, start);
  if (startSha === undefined) {
    return failure(
      repo,
      `fatal: '${start}' is not a commit and a branch '${name}' cannot be created from it`,
    );
  }

  const plan = planSwitch(repo, startSha);
  if (plan.error !== undefined) return failure(repo, plan.error);

  const refs = new Map(repo.refs);
  refs.set(ref, startSha);
  const head: Head = { kind: 'symbolic', ref };
  const diff = diffFromPlan(repo, plan);
  diff.movedRefs.push({ ref, to: startSha });
  diff.headChange = { from: repo.head, to: head };
  return success(
    { ...repo, refs, head, index: plan.index, workingTree: plan.workingTree },
    [`Switched to a new branch '${name}'`],
    diff,
  );
}
