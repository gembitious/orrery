/**
 * 인스펙터 데이터 준비 (순수 함수 — React 무관).
 *
 * 객체의 "실제 직렬화 포맷"을 토큰 열로 편다: `<type> <size>\0<body>`.
 * 이 바이트열이 곧 SHA-1의 입력이다 — 화면에 보이는 것이 해시의 근거 그 자체.
 * sha가 나오는 자리는 클릭 가능한 토큰으로 표시해 commit → tree → blob
 * 체인을 걸어다닐 수 있게 한다.
 */
import type { Sha } from '../core/objects';
import { serializeBody, sortedTreeEntries } from '../core/objects';
import type { Repository } from '../core/repository';

export type InspectToken =
  | { kind: 'text'; text: string }
  | { kind: 'nul' } // \0 — 헤더/엔트리 구분자
  | { kind: 'sha'; sha: Sha; raw: boolean }; // 클릭 가능. raw=true면 실제로는 20바이트 이진

export interface Inspection {
  sha: Sha;
  type: 'blob' | 'tree' | 'commit';
  /** body의 바이트 수 — 헤더의 <size>와 같아야 한다 */
  size: number;
  tokens: InspectToken[];
}

export function inspectObject(repo: Repository, sha: Sha): Inspection | undefined {
  const obj = repo.objects.get(sha);
  if (obj === undefined) return undefined;

  const size = serializeBody(obj).length;
  const tokens: InspectToken[] = [{ kind: 'text', text: `${obj.type} ${size}` }, { kind: 'nul' }];

  switch (obj.type) {
    case 'blob':
      tokens.push({ kind: 'text', text: obj.content });
      break;

    case 'tree':
      for (const entry of sortedTreeEntries(obj.entries)) {
        tokens.push({ kind: 'text', text: `\n${entry.mode} ${entry.name}` });
        tokens.push({ kind: 'nul' });
        tokens.push({ kind: 'sha', sha: entry.sha, raw: true });
      }
      break;

    case 'commit': {
      tokens.push({ kind: 'text', text: '\ntree ' });
      tokens.push({ kind: 'sha', sha: obj.tree, raw: false });
      for (const parent of obj.parents) {
        tokens.push({ kind: 'text', text: '\nparent ' });
        tokens.push({ kind: 'sha', sha: parent, raw: false });
      }
      tokens.push({
        kind: 'text',
        text:
          `\nauthor ${obj.author.name} <${obj.author.email}> ${obj.author.timestamp} +0000` +
          `\ncommitter ${obj.committer.name} <${obj.committer.email}> ${obj.committer.timestamp} +0000` +
          `\n\n${obj.message}`,
      });
      break;
    }
  }

  return { sha, type: obj.type, size, tokens };
}
