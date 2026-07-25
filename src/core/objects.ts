/**
 * git 객체 모델: blob / tree / commit의 타입 정의와
 * 실제 git 포맷 그대로의 직렬화 + SHA-1 해싱.
 *
 * git의 근본 원리: 객체의 이름(SHA)은 그 내용의 해시다.
 * `<type> <size>\0<body>` 형태로 직렬화한 바이트열을 SHA-1 하면
 * 실제 git이 계산하는 것과 동일한 해시가 나온다 (known-answer 테스트로 검증).
 */
import { sha1Hex } from './sha1';

/** 40자 소문자 hex */
export type Sha = string;

export interface Signature {
  name: string;
  email: string;
  /** 시뮬레이션 시계 (단조 증가 카운터). 결정론적 해시를 위해 실제 시각을 쓰지 않는다. */
  timestamp: number;
}

export interface TreeEntry {
  mode: '100644'; // Phase 1: 일반 파일만
  name: string;
  sha: Sha; // blob의 sha
}

export type GitObject =
  | { type: 'blob'; content: string }
  | { type: 'tree'; entries: TreeEntry[] } // 이름순(UTF-8 바이트순) 정렬 불변식
  | {
      type: 'commit';
      tree: Sha;
      parents: Sha[];
      author: Signature;
      committer: Signature;
      message: string;
    };

const encoder = new TextEncoder();

/** UI 표시용 7자 축약 해시 */
export function shortSha(sha: Sha): string {
  return sha.slice(0, 7);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`invalid sha: ${hex}`);
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** UTF-8 바이트열 사전순 비교 (git의 tree 엔트리 정렬 기준) */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * `author Orrery <orrery@example.com> 1 +0000` 형태.
 * SIMPLIFIED: 타임존은 항상 +0000으로 고정한다 (결정론적 해시).
 */
function formatSignature(sig: Signature): string {
  return `${sig.name} <${sig.email}> ${sig.timestamp} +0000`;
}

/** tree 엔트리를 실제 저장 순서(이름의 UTF-8 바이트순)로 정렬해 반환 */
export function sortedTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries
    .map((entry) => ({ entry, nameBytes: encoder.encode(entry.name) }))
    .sort((a, b) => compareBytes(a.nameBytes, b.nameBytes))
    .map(({ entry }) => entry);
}

/** 헤더(`<type> <size>\0`)를 제외한 객체 본문의 바이트열 */
export function serializeBody(obj: GitObject): Uint8Array {
  switch (obj.type) {
    case 'blob':
      return encoder.encode(obj.content);

    case 'tree': {
      // git은 엔트리를 이름의 바이트순으로 정렬해 저장한다.
      // 같은 파일 집합 → 같은 tree 해시가 되는 이유가 바로 이 정렬 규칙.
      const sorted = obj.entries
        .map((entry) => ({ entry, nameBytes: encoder.encode(entry.name) }))
        .sort((a, b) => compareBytes(a.nameBytes, b.nameBytes));
      // 각 엔트리는 `<mode> <name>\0` + 20바이트 raw sha (hex가 아니라 이진!)
      return concatBytes(
        sorted.flatMap(({ entry, nameBytes }) => [
          encoder.encode(`${entry.mode} `),
          nameBytes,
          new Uint8Array([0]),
          hexToBytes(entry.sha),
        ]),
      );
    }

    case 'commit': {
      const lines = [
        `tree ${obj.tree}`,
        ...obj.parents.map((parent) => `parent ${parent}`),
        `author ${formatSignature(obj.author)}`,
        `committer ${formatSignature(obj.committer)}`,
      ];
      return encoder.encode(`${lines.join('\n')}\n\n${obj.message}`);
    }
  }
}

/**
 * 객체 전체의 직렬화: `<type> <size>\0<body>`.
 * size는 문자 수가 아니라 body의 "바이트 수" — UTF-8 멀티바이트 문자에서 차이가 난다.
 * SIMPLIFIED: 실제 git은 이 결과를 zlib으로 압축해 저장하지만 생략한다
 * (해시는 압축 전 바이트열로 계산하므로 해시에는 영향 없음).
 */
export function serializeObject(obj: GitObject): Uint8Array {
  const body = serializeBody(obj);
  const header = encoder.encode(`${obj.type} ${body.length}\0`);
  return concatBytes([header, body]);
}

/** 객체의 SHA-1 해시 — 이 값이 곧 git에서 이 객체의 이름이다. */
export function hashObject(obj: GitObject): Sha {
  return sha1Hex(serializeObject(obj));
}
