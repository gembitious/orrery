/**
 * `git branch` — 브랜치는 커밋을 가리키는 40바이트 포인터 하나가 전부다.
 * 생성은 refs 맵에 엔트리 추가, 삭제는 제거. 커밋 객체는 건드리지 않는다.
 *
 * -d의 "미머지 판정": 지우려는 브랜치의 커밋이 HEAD에서 부모 체인으로 도달
 * 가능하면(= ancestor) 그 작업은 이미 현재 히스토리에 포함된 것이므로 안전하다.
 * 도달 불가능하면 그 브랜치만 가리키던 커밋들이 미아가 되므로 -D를 요구한다.
 */
import { shortSha } from '../objects';
import type { Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success } from '../result';
import { isAncestor } from '../revision';

// SIMPLIFIED: 실제 git의 ref 이름 규칙(git-check-ref-format)의 부분집합
export function isValidBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('.') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    name !== 'HEAD'
  );
}

export function gitBranchList(repo: Repository): CommandResult {
  const lines: string[] = [];
  // SIMPLIFIED: 실제 git은 detached 후 HEAD가 움직였으면 "detached from"으로 바꾸지만
  // reflog가 없으므로 항상 "detached at"으로 표시한다
  if (repo.head.kind === 'detached') {
    lines.push(`* (HEAD detached at ${shortSha(repo.head.sha)})`);
  }
  const names = [...repo.refs.keys()]
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
    .sort();
  const currentRef = repo.head.kind === 'symbolic' ? repo.head.ref : undefined;
  for (const name of names) {
    lines.push(`refs/heads/${name}` === currentRef ? `* ${name}` : `  ${name}`);
  }
  return success(repo, lines);
}

export function gitBranchCreate(repo: Repository, name: string): CommandResult {
  if (!isValidBranchName(name)) {
    return failure(repo, `fatal: '${name}' is not a valid branch name`);
  }
  if (repo.refs.has(`refs/heads/${name}`)) {
    return failure(repo, `fatal: a branch named '${name}' already exists`);
  }
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    // unborn: 가리킬 커밋이 없다. 실제 git은 현재 브랜치 이름을 object name으로 찾다 실패한다
    const current =
      repo.head.kind === 'symbolic' ? repo.head.ref.replace(/^refs\/heads\//, '') : 'HEAD';
    return failure(repo, `fatal: not a valid object name: '${current}'`);
  }

  const ref = `refs/heads/${name}`;
  const refs = new Map(repo.refs);
  refs.set(ref, headSha);
  const diff = emptyDiff();
  diff.movedRefs.push({ ref, to: headSha });
  // 실제 git branch는 성공 시 침묵
  return success({ ...repo, refs }, [], diff);
}

export function gitBranchDelete(repo: Repository, name: string, force: boolean): CommandResult {
  const ref = `refs/heads/${name}`;
  if (repo.head.kind === 'symbolic' && repo.head.ref === ref) {
    return failure(repo, `error: cannot delete branch '${name}' used by worktree at '/repo'`);
  }
  const sha = repo.refs.get(ref);
  if (sha === undefined) {
    return failure(repo, `error: branch '${name}' not found`);
  }
  if (!force) {
    const headSha = resolveHead(repo);
    const merged = headSha !== undefined && isAncestor(repo, sha, headSha);
    if (!merged) {
      return failure(
        repo,
        `error: the branch '${name}' is not fully merged.\n` +
          `If you are sure you want to delete it, run 'git branch -D ${name}'`,
      );
    }
  }

  const refs = new Map(repo.refs);
  refs.delete(ref);
  const diff = emptyDiff();
  diff.deletedRefs = [ref];
  return success({ ...repo, refs }, [`Deleted branch ${name} (was ${shortSha(sha)}).`], diff);
}
