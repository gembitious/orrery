/**
 * Command Layer 진입점: 입력 문자열 → 토큰화 → 명령별 파서 → 코어 API 호출.
 * UI는 이 함수 하나만 알면 된다.
 */
import { gitAdd } from '../core/commands/add';
import { gitBranchCreate, gitBranchDelete, gitBranchList } from '../core/commands/branch';
import { gitCheckout, gitCheckoutNewBranch } from '../core/commands/checkout';
import { gitCommit, gitCommitAmend } from '../core/commands/commit';
import { removeFile, writeFile } from '../core/commands/fs';
import { gitInit } from '../core/commands/init';
import { gitLog } from '../core/commands/log';
import { gitMerge, gitMergeAbort } from '../core/commands/merge';
import type { ResetMode } from '../core/commands/reset';
import { gitReset } from '../core/commands/reset';
import { gitRestoreStaged, gitRestoreWorktree } from '../core/commands/restore';
import { gitRmCached } from '../core/commands/rm';
import { gitStash, gitStashList, gitStashPop } from '../core/commands/stash';
import { gitStatus } from '../core/commands/status';
import type { Repository } from '../core/repository';
import type { CommandResult } from '../core/result';
import { failure, success } from '../core/result';
import type { Token } from './tokenize';
import { TokenizeError, tokenize } from './tokenize';

/**
 * 실제 git에 존재하는 하위 명령들. 아직 미구현이어도 이 목록에 있으면
 * init 전에는 실제 git처럼 "not a git repository"를 낸다.
 */
const KNOWN_GIT_COMMANDS = new Set([
  'add', 'branch', 'checkout', 'cherry-pick', 'commit', 'diff', 'log',
  'merge', 'rebase', 'reset', 'restore', 'rm', 'stash', 'status', 'switch',
]);

export function execute(repo: Repository, input: string): CommandResult {
  let tokens: Token[];
  try {
    tokens = tokenize(input);
  } catch (e) {
    if (e instanceof TokenizeError) return failure(repo, e.message);
    throw e;
  }
  if (tokens.length === 0) return success(repo); // 빈 입력은 no-op

  const [cmd, ...args] = tokens;
  switch (cmd.value) {
    case 'git':
      return executeGit(repo, args);
    case 'echo':
      return executeEcho(repo, args);
    case 'rm':
      return executeRm(repo, args);
    default:
      return failure(repo, `orrery: '${cmd.value}'은(는) 지원하지 않는 명령입니다`);
  }
}

function executeGit(repo: Repository, args: Token[]): CommandResult {
  if (args.length === 0) {
    return failure(repo, 'orrery: git 하위 명령을 입력하세요 (예: git init)');
  }
  const sub = args[0].value;
  const rest = args.slice(1);

  if (sub === 'init') {
    if (rest.length > 0) {
      return failure(repo, `orrery: 'git init'은 인자 없이만 지원합니다`);
    }
    return gitInit(repo);
  }

  // 실제 git과 동일한 순서: 존재하는 명령이라도 저장소 밖이면 먼저 이 에러가 난다
  if (!repo.initialized && KNOWN_GIT_COMMANDS.has(sub)) {
    return failure(repo, 'fatal: not a git repository (or any of the parent directories): .git');
  }

  switch (sub) {
    case 'add':
      return parseAdd(repo, rest);
    case 'commit':
      return parseCommit(repo, rest);
    case 'branch':
      return parseBranch(repo, rest);
    case 'checkout':
      return parseCheckout(repo, rest);
    case 'reset':
      return parseReset(repo, rest);
    case 'restore':
      return parseRestore(repo, rest);
    case 'merge': {
      if (rest.length === 1 && !rest[0].quoted && rest[0].value === '--abort') {
        return gitMergeAbort(repo);
      }
      const option = rest.find((t) => !t.quoted && t.value.startsWith('-'));
      if (option !== undefined) {
        return failure(
          repo,
          `orrery: 'git merge'의 옵션 '${option.value}'은(는) 아직 지원하지 않습니다`,
        );
      }
      if (rest.length !== 1) {
        return failure(repo, "orrery: 'git merge <브랜치|커밋>' 형식으로 입력하세요");
      }
      return gitMerge(repo, rest[0].value);
    }
    case 'rm': {
      const force = rest.some((t) => !t.quoted && t.value === '-f');
      const cached = rest.some((t) => !t.quoted && t.value === '--cached');
      const files = rest.filter((t) => t.quoted || !t.value.startsWith('-')).map((t) => t.value);
      const unknown = rest.find(
        (t) => !t.quoted && t.value.startsWith('-') && t.value !== '-f' && t.value !== '--cached',
      );
      if (unknown !== undefined) {
        return failure(
          repo,
          `orrery: 'git rm'의 옵션 '${unknown.value}'은(는) 아직 지원하지 않습니다`,
        );
      }
      if (!cached) {
        return failure(
          repo,
          "orrery: 'git rm'은 --cached만 지원합니다 (working tree 삭제는 가상 명령 rm)",
        );
      }
      if (files.length === 0) {
        return failure(repo, "orrery: 'git rm --cached <파일>...' 형식으로 입력하세요");
      }
      return gitRmCached(repo, files, force);
    }
    case 'stash': {
      if (rest.length === 0) return gitStash(repo);
      const sub2 = rest[0].value;
      if (rest.length === 1 && sub2 === 'pop') return gitStashPop(repo);
      if (rest.length === 1 && sub2 === 'list') return gitStashList(repo);
      return failure(
        repo,
        `orrery: 'git stash ${sub2}'은(는) 아직 지원하지 않습니다 (지원: stash / pop / list)`,
      );
    }
    case 'status': {
      if (rest.length > 0) {
        return failure(
          repo,
          `orrery: 'git status'의 인자 '${rest[0].value}'은(는) 아직 지원하지 않습니다`,
        );
      }
      return gitStatus(repo);
    }
    case 'log': {
      if (rest.length > 0) {
        return failure(
          repo,
          `orrery: 'git log'의 인자 '${rest[0].value}'은(는) 아직 지원하지 않습니다`,
        );
      }
      return gitLog(repo);
    }
    default:
      break;
  }

  if (KNOWN_GIT_COMMANDS.has(sub)) {
    return failure(repo, `orrery: '${sub}'은(는) 아직 지원하지 않습니다`);
  }
  return failure(repo, `git: '${sub}' is not a git command. See 'git --help'.`);
}

/** `git add <pathspec>...` / `git add .` — 옵션(-A, -p, -u 등)은 미지원 */
function parseAdd(repo: Repository, args: Token[]): CommandResult {
  const option = args.find((t) => !t.quoted && t.value.startsWith('-'));
  if (option !== undefined) {
    return failure(repo, `orrery: 'git add'의 옵션 '${option.value}'은(는) 아직 지원하지 않습니다`);
  }
  if (args.length === 0) {
    // 실제 git 문구
    return failure(repo, 'Nothing specified, nothing added.');
  }
  return gitAdd(repo, args.map((t) => t.value));
}

/** `git commit -m "메시지"` / `git commit --amend [--no-edit] [-m "메시지"]` */
function parseCommit(repo: Repository, args: Token[]): CommandResult {
  let message: string | undefined;
  let amend = false;
  let noEdit = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token.value === '-m' && !token.quoted) {
      if (message !== undefined) {
        return failure(repo, "orrery: '-m' 여러 개는 아직 지원하지 않습니다");
      }
      const next = args[i + 1];
      if (next === undefined) {
        return failure(repo, "error: switch 'm' requires a value");
      }
      message = next.value;
      i++;
    } else if (token.value === '--amend' && !token.quoted) {
      amend = true;
    } else if (token.value === '--no-edit' && !token.quoted) {
      noEdit = true;
    } else if (token.value.startsWith('-') && !token.quoted) {
      return failure(
        repo,
        `orrery: 'git commit'의 옵션 '${token.value}'은(는) 아직 지원하지 않습니다`,
      );
    } else {
      return failure(repo, `orrery: 'git commit'의 인자 '${token.value}'은(는) 지원하지 않습니다`);
    }
  }

  if (amend) {
    // -m이 없으면 --no-edit처럼 기존 메시지 유지 (에디터가 없으므로)
    return gitCommitAmend(repo, message);
  }
  if (noEdit) {
    return failure(repo, "orrery: '--no-edit'은 --amend와 함께만 지원합니다");
  }
  // 머지 완결 커밋은 -m 없이도 저장된 MERGE_MSG를 쓴다 (에디터 대체)
  if (message === undefined && repo.merging === undefined) {
    return failure(repo, 'orrery: 에디터가 없으므로 -m "메시지" 형식으로 입력하세요');
  }
  return gitCommit(repo, message);
}

/** `git branch` (목록) / `git branch <이름>` / `git branch -d|-D <이름>` */
function parseBranch(repo: Repository, args: Token[]): CommandResult {
  if (args.length === 0) return gitBranchList(repo);

  const first = args[0];
  if (!first.quoted && (first.value === '-d' || first.value === '-D')) {
    if (args.length !== 2) {
      return failure(repo, `orrery: 'git branch ${first.value} <이름>' 형식으로 입력하세요`);
    }
    return gitBranchDelete(repo, args[1].value, first.value === '-D');
  }
  const option = args.find((t) => !t.quoted && t.value.startsWith('-'));
  if (option !== undefined) {
    return failure(
      repo,
      `orrery: 'git branch'의 옵션 '${option.value}'은(는) 아직 지원하지 않습니다`,
    );
  }
  if (args.length === 1) return gitBranchCreate(repo, args[0].value);
  return failure(repo, "orrery: 'git branch'는 '<이름>' 또는 '-d/-D <이름>'만 지원합니다");
}

/** `git checkout <브랜치|커밋>` / `git checkout -b <이름> [<시작점>]` */
function parseCheckout(repo: Repository, args: Token[]): CommandResult {
  if (args.length === 0) {
    return failure(repo, "orrery: 'git checkout <브랜치|커밋>' 또는 '-b <이름>'이 필요합니다");
  }
  const first = args[0];
  if (!first.quoted && first.value === '-b') {
    if (args.length < 2) return failure(repo, "error: switch 'b' requires a value");
    if (args.length > 3) {
      return failure(repo, "orrery: 'git checkout -b <이름> [<시작점>]' 형식으로 입력하세요");
    }
    return gitCheckoutNewBranch(repo, args[1].value, args[2]?.value);
  }
  const option = args.find((t) => !t.quoted && t.value.startsWith('-'));
  if (option !== undefined) {
    return failure(
      repo,
      `orrery: 'git checkout'의 옵션 '${option.value}'은(는) 아직 지원하지 않습니다`,
    );
  }
  if (args.length !== 1) {
    return failure(repo, "orrery: 'git checkout'은 대상 하나만 지원합니다");
  }
  return gitCheckout(repo, args[0].value);
}

/** `git reset [--soft|--mixed|--hard] [<commit>]` — 기본은 --mixed, 대상 기본은 HEAD */
function parseReset(repo: Repository, args: Token[]): CommandResult {
  let mode: ResetMode = 'mixed';
  let modeSeen = false;
  let target: string | undefined;

  for (const token of args) {
    if (!token.quoted && (token.value === '--soft' || token.value === '--mixed' || token.value === '--hard')) {
      if (modeSeen) {
        return failure(repo, "orrery: reset 모드 옵션은 하나만 지정하세요");
      }
      modeSeen = true;
      mode = token.value === '--soft' ? 'soft' : token.value === '--mixed' ? 'mixed' : 'hard';
      continue;
    }
    if (!token.quoted && token.value.startsWith('-')) {
      return failure(
        repo,
        `orrery: 'git reset'의 옵션 '${token.value}'은(는) 아직 지원하지 않습니다`,
      );
    }
    if (target !== undefined) {
      return failure(repo, "orrery: 'git reset'은 대상 커밋 하나만 지원합니다 (파일 단위 reset은 미지원)");
    }
    target = token.value;
  }

  return gitReset(repo, mode, target ?? 'HEAD');
}

/** `git restore [--staged] <file>...` */
function parseRestore(repo: Repository, args: Token[]): CommandResult {
  let staged = false;
  const paths: string[] = [];

  for (const token of args) {
    if (!token.quoted && token.value === '--staged') {
      staged = true;
      continue;
    }
    if (!token.quoted && token.value.startsWith('-')) {
      return failure(
        repo,
        `orrery: 'git restore'의 옵션 '${token.value}'은(는) 아직 지원하지 않습니다`,
      );
    }
    paths.push(token.value);
  }

  if (paths.length === 0) {
    return failure(repo, 'fatal: you must specify path(s) to restore');
  }
  return staged ? gitRestoreStaged(repo, paths) : gitRestoreWorktree(repo, paths);
}

/**
 * `echo content` → 출력만.
 * `echo content > file.txt` → 파일 생성/덮어쓰기.
 * SIMPLIFIED: 리다이렉션 `>`는 앞뒤 공백이 있는 독립 토큰이어야 한다 (`>f.txt` 미지원).
 */
function executeEcho(repo: Repository, args: Token[]): CommandResult {
  const redirectAt = args.findIndex((t) => t.value === '>' && !t.quoted);

  if (redirectAt === -1) {
    return success(repo, [args.map((t) => t.value).join(' ')]);
  }

  const contentTokens = args.slice(0, redirectAt);
  const targetTokens = args.slice(redirectAt + 1);
  if (targetTokens.length !== 1) {
    return failure(repo, "orrery: 'echo ... > <파일>' 형식으로 파일 하나를 지정하세요");
  }
  const content = contentTokens.map((t) => t.value).join(' ');
  return writeFile(repo, targetTokens[0].value, content);
}

/** `rm file.txt` — 파일 하나만. 옵션(-r, -f 등)은 지원하지 않는다. */
function executeRm(repo: Repository, args: Token[]): CommandResult {
  if (args.length !== 1 || args[0].value.startsWith('-')) {
    return failure(repo, "orrery: 'rm <파일>' 형식만 지원합니다");
  }
  return removeFile(repo, args[0].value);
}
