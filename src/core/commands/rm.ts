/**
 * `git rm --cached <file>...` — index에서만 제거한다 (working tree는 유지).
 * HEAD에 있던 파일이면 "삭제가 staged"되고, WT의 파일은 untracked가 된다.
 *
 * 안전장치(실제 git 2.43): staged된 내용이 HEAD와도 WT와도 다르면
 * 그 스냅샷은 index에만 존재하므로, 지우면 유일한 사본이 사라진다 — -f를 요구한다.
 */
import { hashObject } from '../objects';
import type { Repository } from '../repository';
import { resolveHead, stagedSha } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success } from '../result';
import { commitTreeMap } from '../revision';

export function gitRmCached(repo: Repository, files: string[], force: boolean): CommandResult {
  for (const file of files) {
    if (!repo.index.has(file)) {
      return failure(repo, `fatal: pathspec '${file}' did not match any files`);
    }
  }

  for (const file of files) {
    if (repo.index.get(file)?.conflicted === true) {
      return failure(repo, `error: path '${file}' is unmerged`);
    }
  }

  if (!force) {
    const headSha = resolveHead(repo);
    const headTree = headSha === undefined ? new Map<string, string>() : commitTreeMap(repo, headSha);
    const blocked = files.filter((file) => {
      const staged = stagedSha(repo.index.get(file));
      if (staged === undefined) return false;
      if (headTree.get(file) === staged) return false;
      const content = repo.workingTree.get(file);
      if (content !== undefined && hashObject({ type: 'blob', content }) === staged) return false;
      return true; // 이 스냅샷은 index에만 있다
    });
    if (blocked.length > 0) {
      const noun = blocked.length > 1 ? 'files have' : 'file has';
      return failure(
        repo,
        `error: the following ${noun} staged content different from both the\nfile and the HEAD:\n` +
          `${blocked.map((f) => `    ${f}`).join('\n')}\n(use -f to force removal)`,
      );
    }
  }

  const index = new Map(repo.index);
  const diff = emptyDiff();
  for (const file of files) {
    index.delete(file);
    diff.indexChanges.push({ file, kind: 'unstaged' });
  }
  return success({ ...repo, index }, files.map((file) => `rm '${file}'`), diff);
}
