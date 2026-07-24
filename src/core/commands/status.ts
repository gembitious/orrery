/**
 * `git status` — computeStatus의 결과를 실제 git의 출력 포맷으로 렌더링한다.
 * 상태 계산은 전부 core/status.ts에 있고 여기는 문자열 조립뿐이다.
 */
import { shortSha } from '../objects';
import type { Repository } from '../repository';
import type { CommandResult } from '../result';
import { success } from '../result';
import type { RepoStatus, StatusEntry } from '../status';
import { computeStatus } from '../status';

// 실제 git처럼 파일명이 정렬되도록 라벨 뒤 공백을 맞춘다
const INDEX_LABEL = { added: 'new file:   ', modified: 'modified:   ', deleted: 'deleted:    ' };
const WORKTREE_LABEL = { modified: 'modified:   ', deleted: 'deleted:    ' };
const UNMERGED_LABEL = {
  'both modified': 'both modified:   ',
  'both added': 'both added:      ',
  'deleted by us': 'deleted by us:   ',
  'deleted by them': 'deleted by them: ',
};

function renderSections(status: RepoStatus): string[] {
  const staged = status.entries.filter((e): e is StatusEntry & { index: string } =>
    e.index !== undefined,
  );
  const unmerged = status.entries.filter((e) => e.unmerged !== undefined);
  const unstaged = status.entries.filter(
    (e) => e.worktree === 'modified' || e.worktree === 'deleted',
  );
  const untracked = status.entries.filter((e) => e.worktree === 'untracked');

  const lines: string[] = [];

  if (staged.length > 0) {
    lines.push('Changes to be committed:');
    // 머지 중에는 실제 git도 unstage 힌트를 생략한다
    if (!status.merging) {
      lines.push(
        status.initial
          ? '  (use "git rm --cached <file>..." to unstage)'
          : '  (use "git restore --staged <file>..." to unstage)',
      );
    }
    for (const e of staged) {
      if (e.index !== undefined) lines.push(`\t${INDEX_LABEL[e.index]}${e.file}`);
    }
    lines.push('');
  }

  if (unmerged.length > 0) {
    lines.push('Unmerged paths:');
    const hasDeleteConflict = unmerged.some(
      (e) => e.unmerged === 'deleted by us' || e.unmerged === 'deleted by them',
    );
    lines.push(
      hasDeleteConflict
        ? '  (use "git add/rm <file>..." as appropriate to mark resolution)'
        : '  (use "git add <file>..." to mark resolution)',
    );
    for (const e of unmerged) {
      if (e.unmerged !== undefined) lines.push(`\t${UNMERGED_LABEL[e.unmerged]}${e.file}`);
    }
    lines.push('');
  }

  if (unstaged.length > 0) {
    lines.push('Changes not staged for commit:');
    lines.push('  (use "git add <file>..." to update what will be committed)');
    lines.push('  (use "git restore <file>..." to discard changes in working directory)');
    for (const e of unstaged) {
      if (e.worktree === 'modified' || e.worktree === 'deleted') {
        lines.push(`\t${WORKTREE_LABEL[e.worktree]}${e.file}`);
      }
    }
    lines.push('');
  }

  if (untracked.length > 0) {
    lines.push('Untracked files:');
    lines.push('  (use "git add <file>..." to include in what will be committed)');
    for (const e of untracked) lines.push(`\t${e.file}`);
    lines.push('');
  }

  // 마지막 요약 줄 — staged가 있으면 요약 없이 끝난다 (실제 git과 동일)
  if (staged.length === 0) {
    if (unmerged.length > 0) {
      lines.push('no changes added to commit (use "git add" and/or "git commit -a")');
    } else if (unstaged.length > 0) {
      lines.push('no changes added to commit (use "git add" and/or "git commit -a")');
    } else if (untracked.length > 0) {
      lines.push('nothing added to commit but untracked files present (use "git add" to track)');
    } else if (status.initial) {
      lines.push('nothing to commit (create/copy files and use "git add" to track)');
    } else {
      lines.push('nothing to commit, working tree clean');
    }
  } else if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

export function gitStatus(repo: Repository): CommandResult {
  const status = computeStatus(repo);
  const lines: string[] = [];

  if (status.branch !== undefined) {
    lines.push(`On branch ${status.branch}`);
  } else if (status.detachedAt !== undefined) {
    lines.push(`HEAD detached at ${shortSha(status.detachedAt)}`);
  }
  if (status.initial) {
    lines.push('', 'No commits yet', '');
  }
  if (status.merging) {
    const unresolved = status.entries.some((e) => e.unmerged !== undefined);
    if (unresolved) {
      lines.push('You have unmerged paths.');
      lines.push('  (fix conflicts and run "git commit")');
      lines.push('  (use "git merge --abort" to abort the merge)');
    } else {
      lines.push('All conflicts fixed but you are still merging.');
      lines.push('  (use "git commit" to conclude merge)');
    }
    lines.push('');
  }
  lines.push(...renderSections(status));

  return success(repo, lines);
}
