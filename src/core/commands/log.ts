/**
 * `git log` — HEAD에서 first-parent 체인을 따라 내려가며 출력한다.
 *
 * first-parent 순회: 머지 커밋(부모 2개+)에서도 항상 parents[0]만 따라간다.
 * "이 브랜치의 주 흐름"만 일직선으로 보여주는 셈이다. (전체 DAG 탐색은
 * 그래프 UI가 담당하고, log는 실제 git의 기본 동작대로 단순 체인을 보여준다.)
 *
 * 데코레이션((HEAD -> main, feature))은 실제 git에서 tty일 때의 기본 동작을
 * 따른다 — orrery의 명령창은 터미널 역할이므로 항상 켠다.
 */
import type { Sha } from '../objects';
import { shortSha } from '../objects';
import type { Repository } from '../repository';
import { resolveHead } from '../repository';
import type { CommandResult } from '../result';
import { failure, success } from '../result';
import { getCommit } from '../revision';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 시뮬레이션 시계(epoch 초)를 git 기본 날짜 포맷으로: 'Thu Jan 1 00:00:01 1970 +0000' */
export function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `${d.getUTCFullYear()} +0000`
  );
}

/** 커밋 sha → 데코레이션 라벨 목록 (HEAD 라벨이 항상 앞) */
function decorations(repo: Repository): Map<Sha, string[]> {
  const map = new Map<Sha, string[]>();
  const push = (sha: Sha, label: string): void => {
    const labels = map.get(sha) ?? [];
    labels.push(label);
    map.set(sha, labels);
  };

  if (repo.head.kind === 'detached') {
    push(repo.head.sha, 'HEAD');
  } else {
    const sha = repo.refs.get(repo.head.ref);
    if (sha !== undefined) {
      push(sha, `HEAD -> ${repo.head.ref.replace(/^refs\/heads\//, '')}`);
    }
  }
  const branches = [...repo.refs.entries()]
    .filter(([ref]) => ref.startsWith('refs/heads/'))
    .filter(([ref]) => !(repo.head.kind === 'symbolic' && repo.head.ref === ref))
    .map(([ref, sha]) => [ref.slice('refs/heads/'.length), sha] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [name, sha] of branches) push(sha, name);
  return map;
}

export function gitLog(repo: Repository): CommandResult {
  const headSha = resolveHead(repo);
  if (headSha === undefined) {
    const branch =
      repo.head.kind === 'symbolic' ? repo.head.ref.replace(/^refs\/heads\//, '') : 'HEAD';
    return failure(repo, `fatal: your current branch '${branch}' does not have any commits yet`);
  }

  const deco = decorations(repo);
  const lines: string[] = [];

  let cursor: Sha | undefined = headSha;
  while (cursor !== undefined) {
    const commit = getCommit(repo, cursor);
    if (lines.length > 0) lines.push('');

    const labels = deco.get(cursor);
    lines.push(`commit ${cursor}${labels === undefined ? '' : ` (${labels.join(', ')})`}`);
    if (commit.parents.length > 1) {
      lines.push(`Merge: ${commit.parents.map(shortSha).join(' ')}`);
    }
    lines.push(`Author: ${commit.author.name} <${commit.author.email}>`);
    lines.push(`Date:   ${formatDate(commit.author.timestamp)}`);
    lines.push('');
    // 메시지는 4칸 들여쓰기, 끝 개행은 표시하지 않는다
    for (const msgLine of commit.message.replace(/\n$/, '').split('\n')) {
      lines.push(`    ${msgLine}`);
    }

    cursor = commit.parents[0]; // first-parent만 따라간다
  }

  return success(repo, lines);
}
