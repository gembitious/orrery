/**
 * `git restore <file>` / `git restore --staged <file>` — reset의 반대 방향 짝.
 *
 *   restore <file>          : index의 내용으로 working tree를 복원 (WT ← index)
 *   restore --staged <file> : HEAD의 내용으로 index를 복원      (index ← HEAD)
 *
 * 3영역에서 내용이 "왼쪽으로" 흐르는 유일한 명령들이다 — add/commit이
 * 오른쪽으로 밀어 넣은 것을 한 칸씩 되돌린다.
 * SIMPLIFIED: --source, --worktree(--staged와 동시 지정) 옵션은 지원하지 않는다.
 */
import type { IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { failure, success, workspaceDiff } from '../result';
import { blobContent, commitTreeMap } from '../revision';

/** `git restore <file>...` — WT ← index */
export function gitRestoreWorktree(repo: Repository, pathspecs: string[]): CommandResult {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const spec of pathspecs) {
    const expanded = spec === '.' ? [...repo.index.keys()] : [spec];
    for (const name of expanded) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  // 실제 git: worktree restore는 index에 있는 파일만 대상이 된다 (staged 삭제 포함 불가)
  for (const name of names) {
    if (!repo.index.has(name)) {
      return failure(repo, `error: pathspec '${name}' did not match any file(s) known to git`);
    }
  }

  const workingTree = new Map(repo.workingTree);
  for (const name of names) {
    const entry = repo.index.get(name);
    if (entry === undefined) continue;
    const content = blobContent(repo, entry.sha);
    if (repo.workingTree.get(name) !== content) workingTree.set(name, content);
  }

  const diff = workspaceDiff(repo, repo.index, workingTree);
  return success({ ...repo, workingTree }, [], diff); // 성공 시 침묵
}

/** `git restore --staged <file>...` — index ← HEAD */
export function gitRestoreStaged(repo: Repository, pathspecs: string[]): CommandResult {
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    return failure(repo, 'fatal: could not resolve HEAD');
  }
  const headTree = commitTreeMap(repo, headSha);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const spec of pathspecs) {
    const expanded = spec === '.' ? [...new Set([...repo.index.keys(), ...headTree.keys()])] : [spec];
    for (const name of expanded) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  for (const name of names) {
    if (!repo.index.has(name) && !headTree.has(name)) {
      return failure(repo, `error: pathspec '${name}' did not match any file(s) known to git`);
    }
  }

  const index = new Map<string, IndexEntry>(repo.index);
  for (const name of names) {
    const headBlob = headTree.get(name);
    if (headBlob === undefined) {
      index.delete(name); // HEAD에 없던 파일의 staging 취소 → untracked로 돌아간다
    } else {
      index.set(name, { name, sha: headBlob });
    }
  }

  const diff = workspaceDiff(repo, index, repo.workingTree);
  return success({ ...repo, index }, [], diff);
}
