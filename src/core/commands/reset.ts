/**
 * `git reset --soft/--mixed/--hard [<commit>]` — HEAD를 옮기고,
 * 모드에 따라 index와 working tree를 어디까지 따라가게 할지 정한다.
 *
 *   soft  : HEAD(브랜치 포인터)만 이동. index/WT는 그대로
 *           → 되돌린 커밋의 내용이 "staged된 채로" 남는다
 *   mixed : HEAD + index를 대상 커밋의 tree로. WT는 그대로 (기본값)
 *           → 변경이 "unstaged된 채로" 남는다
 *   hard  : HEAD + index + WT 전부 대상 커밋의 tree로
 *           → 단, untracked 파일은 지우지 않는다 (실제 git과 동일)
 *
 * 세 모드의 차이가 3영역 패널에서 애니메이션으로 보이는 것이
 * 이 프로젝트의 킬러 콘텐츠다.
 */
import { hashObject, shortSha } from '../objects';
import type { IndexEntry, Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { failure, success, workspaceDiff } from '../result';
import { blobContent, commitTreeMap, getCommit, resolveRevision } from '../revision';

export type ResetMode = 'soft' | 'mixed' | 'hard';

function unknownRevision(text: string): string {
  return (
    `fatal: ambiguous argument '${text}': unknown revision or path not in the working tree.\n` +
    "Use '--' to separate paths from revisions, like this:\n" +
    "'git <command> [<revision>...] -- [<file>...]'"
  );
}

export function gitReset(repo: Repository, mode: ResetMode, targetText: string): CommandResult {
  const headSha = resolveHead(repo);
  // unborn 상태에서는 'HEAD'조차 해석되지 않는다 — 실제 git도 같은 문구를 낸다
  if (headSha === undefined) return failure(repo, unknownRevision(targetText));
  const target = resolveRevision(repo, targetText);
  if (target === undefined) return failure(repo, unknownRevision(targetText));

  let index = repo.index;
  let workingTree = repo.workingTree;

  if (mode !== 'soft') {
    const targetTree = commitTreeMap(repo, target);
    index = new Map<string, IndexEntry>(
      [...targetTree].map(([name, sha]) => [name, { name, sha }]),
    );

    if (mode === 'hard') {
      workingTree = new Map<string, string>();
      for (const [name, sha] of targetTree) {
        workingTree.set(name, blobContent(repo, sha));
      }
      // untracked(기존 index에 없던) 파일은 hard reset도 건드리지 않는다
      for (const [name, content] of repo.workingTree) {
        if (!repo.index.has(name) && !targetTree.has(name)) {
          workingTree.set(name, content);
        }
      }
    }
  }

  const diff = workspaceDiff(repo, index, workingTree);
  const next: Repository = { ...repo, index, workingTree };

  if (repo.head.kind === 'symbolic') {
    const refs = new Map(repo.refs);
    refs.set(repo.head.ref, target);
    next.refs = refs;
    if (target !== headSha) {
      diff.movedRefs.push({ ref: repo.head.ref, from: headSha, to: target });
    }
  } else {
    next.head = { kind: 'detached', sha: target };
    if (target !== headSha) {
      diff.headChange = { from: repo.head, to: next.head };
    }
  }

  if (mode === 'hard') {
    const summary = getCommit(repo, target).message.split('\n')[0];
    return success(next, [`HEAD is now at ${shortSha(target)} ${summary}`], diff);
  }

  if (mode === 'mixed') {
    // 새 index와 WT의 차이를 실제 git처럼 'M/D <파일>'로 알린다 (untracked는 제외)
    const lines: string[] = [];
    for (const [name, entry] of [...index].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const content = workingTree.get(name);
      if (content === undefined) {
        lines.push(`D\t${name}`);
      } else if (
        entry.sha !== hashBlob(content)
      ) {
        lines.push(`M\t${name}`);
      }
    }
    return success(next, lines.length > 0 ? ['Unstaged changes after reset:', ...lines] : [], diff);
  }

  return success(next, [], diff); // soft는 침묵
}

function hashBlob(content: string): string {
  return hashObject({ type: 'blob', content });
}
