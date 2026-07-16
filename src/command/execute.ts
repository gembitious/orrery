/**
 * Command Layer 진입점: 입력 문자열 → 토큰화 → 명령별 파서 → 코어 API 호출.
 * UI는 이 함수 하나만 알면 된다.
 */
import { gitAdd } from '../core/commands/add';
import { gitCommit } from '../core/commands/commit';
import { removeFile, writeFile } from '../core/commands/fs';
import { gitInit } from '../core/commands/init';
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
    case 'status': {
      if (rest.length > 0) {
        return failure(
          repo,
          `orrery: 'git status'의 인자 '${rest[0].value}'은(는) 아직 지원하지 않습니다`,
        );
      }
      return gitStatus(repo);
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

/** `git commit -m "메시지"` — -m 필수 (에디터가 없으므로), 그 외 옵션 미지원 */
function parseCommit(repo: Repository, args: Token[]): CommandResult {
  let message: string | undefined;
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
    } else if (token.value.startsWith('-') && !token.quoted) {
      return failure(
        repo,
        `orrery: 'git commit'의 옵션 '${token.value}'은(는) 아직 지원하지 않습니다`,
      );
    } else {
      return failure(repo, `orrery: 'git commit'의 인자 '${token.value}'은(는) 지원하지 않습니다`);
    }
  }
  if (message === undefined) {
    return failure(repo, 'orrery: 에디터가 없으므로 -m "메시지" 형식으로 입력하세요');
  }
  return gitCommit(repo, message);
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
