/**
 * known-answer 테스트: 모든 기대값은 실제 git(2.43)으로 생성했다.
 *
 * blob:   printf '<content>' | git hash-object [-w] --stdin
 * tree:   git update-index --add --cacheinfo 100644,<sha>,<name> && git write-tree
 * commit: GIT_AUTHOR_NAME=Orrery GIT_AUTHOR_EMAIL=orrery@example.com \
 *         GIT_AUTHOR_DATE='@<ts> +0000' (committer 동일) \
 *         git commit-tree <tree> [-p <parent>] -m '<msg>'
 */
import { describe, expect, it } from 'vitest';
import type { GitObject, Signature } from './objects';
import { hashObject, serializeObject, shortSha } from './objects';

const decoder = new TextDecoder();

function sig(timestamp: number): Signature {
  return { name: 'Orrery', email: 'orrery@example.com', timestamp };
}

// 아래 해시들은 위 방법으로 실제 git이 계산한 값
const BLOB_HELLO = 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'; // 'hello'
const BLOB_EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'; // ''
const BLOB_HELLO_WORLD = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad'; // 'hello world\n'
const TREE_SINGLE = '6d7572818a587501467139ad1ef01aebe98eeb6d'; // f.txt → blob('hello')
const TREE_MULTI = 'bb5e3967b168e74b79ef16e62ccfd132c1a0b515'; // README, a.txt, b.txt
const TREE_EMPTY = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git의 유명한 empty tree
const COMMIT_ROOT = '370125d0f9a1dc2e537695a7a63d06d82802a7fa'; // tree TREE_SINGLE, 부모 없음, ts=1
const COMMIT_CHILD = '8c4de36dac27eb1a73c549eb7c5529221f90b6ef'; // tree TREE_MULTI, 부모 1개, ts=2
const COMMIT_MERGE = '345e599eed3d43cf4a4f3b9000a06d80bf5ae510'; // tree TREE_MULTI, 부모 2개, ts=3

describe('blob', () => {
  it("직렬화: 'blob <size>\\0<content>'", () => {
    const obj: GitObject = { type: 'blob', content: 'hello' };
    expect(decoder.decode(serializeObject(obj))).toBe('blob 5\0hello');
  });

  it('해시가 실제 git과 일치한다', () => {
    expect(hashObject({ type: 'blob', content: 'hello' })).toBe(BLOB_HELLO);
    expect(hashObject({ type: 'blob', content: '' })).toBe(BLOB_EMPTY);
    expect(hashObject({ type: 'blob', content: 'hello world\n' })).toBe(BLOB_HELLO_WORLD);
  });

  it('size는 문자 수가 아니라 UTF-8 바이트 수다', () => {
    // '안녕하세요\n' = 5자 × 3바이트 + 1 = 16바이트
    const obj: GitObject = { type: 'blob', content: '안녕하세요\n' };
    expect(decoder.decode(serializeObject(obj)).startsWith('blob 16\0')).toBe(true);
    expect(hashObject(obj)).toBe('7acc5bfda1ad42d94f276ffa48bebdf24daded8c');
  });
});

describe('tree', () => {
  it('단일 엔트리 tree의 해시가 실제 git과 일치한다', () => {
    const obj: GitObject = {
      type: 'tree',
      entries: [{ mode: '100644', name: 'f.txt', sha: BLOB_HELLO }],
    };
    expect(hashObject(obj)).toBe(TREE_SINGLE);
  });

  it('여러 엔트리 tree의 해시가 실제 git과 일치한다', () => {
    const obj: GitObject = {
      type: 'tree',
      entries: [
        { mode: '100644', name: 'README', sha: BLOB_EMPTY },
        { mode: '100644', name: 'a.txt', sha: BLOB_HELLO_WORLD },
        { mode: '100644', name: 'b.txt', sha: BLOB_HELLO },
      ],
    };
    expect(hashObject(obj)).toBe(TREE_MULTI);
  });

  it('엔트리 순서와 무관하게 같은 해시가 나온다 (직렬화 시 이름순 정렬)', () => {
    const shuffled: GitObject = {
      type: 'tree',
      entries: [
        { mode: '100644', name: 'b.txt', sha: BLOB_HELLO },
        { mode: '100644', name: 'README', sha: BLOB_EMPTY },
        { mode: '100644', name: 'a.txt', sha: BLOB_HELLO_WORLD },
      ],
    };
    expect(hashObject(shuffled)).toBe(TREE_MULTI);
  });

  it('빈 tree는 git의 well-known empty tree 해시가 된다', () => {
    expect(hashObject({ type: 'tree', entries: [] })).toBe(TREE_EMPTY);
  });

  it('sha는 hex 문자열이 아니라 20바이트 raw로 직렬화된다', () => {
    const obj: GitObject = {
      type: 'tree',
      entries: [{ mode: '100644', name: 'f.txt', sha: BLOB_HELLO }],
    };
    // 'tree 33\0' + '100644 f.txt\0' + 20바이트 = 헤더 8 + 13 + 20
    const bytes = serializeObject(obj);
    expect(bytes.length).toBe(8 + 13 + 20);
    // raw sha의 첫 바이트 = 0xb6 (hex 'b6')
    expect(bytes[8 + 13]).toBe(0xb6);
  });

  it('잘못된 sha 형식이면 던진다', () => {
    const obj: GitObject = {
      type: 'tree',
      entries: [{ mode: '100644', name: 'f.txt', sha: 'not-a-sha' }],
    };
    expect(() => serializeObject(obj)).toThrow(/invalid sha/);
  });
});

describe('commit', () => {
  it('루트 커밋(부모 없음)의 해시가 실제 git과 일치한다', () => {
    const obj: GitObject = {
      type: 'commit',
      tree: TREE_SINGLE,
      parents: [],
      author: sig(1),
      committer: sig(1),
      message: 'c1\n',
    };
    expect(hashObject(obj)).toBe(COMMIT_ROOT);
  });

  it('부모 1개 커밋의 해시가 실제 git과 일치한다', () => {
    const obj: GitObject = {
      type: 'commit',
      tree: TREE_MULTI,
      parents: [COMMIT_ROOT],
      author: sig(2),
      committer: sig(2),
      message: 'c2\n',
    };
    expect(hashObject(obj)).toBe(COMMIT_CHILD);
  });

  it('머지 커밋(부모 2개)의 해시가 실제 git과 일치한다', () => {
    const obj: GitObject = {
      type: 'commit',
      tree: TREE_MULTI,
      parents: [COMMIT_ROOT, COMMIT_CHILD],
      author: sig(3),
      committer: sig(3),
      message: 'merge\n',
    };
    expect(hashObject(obj)).toBe(COMMIT_MERGE);
  });

  it('직렬화 본문이 실제 git 포맷과 일치한다', () => {
    const obj: GitObject = {
      type: 'commit',
      tree: TREE_SINGLE,
      parents: [],
      author: sig(1),
      committer: sig(1),
      message: 'c1\n',
    };
    expect(decoder.decode(serializeObject(obj))).toBe(
      `commit 139\0tree ${TREE_SINGLE}\n` +
        'author Orrery <orrery@example.com> 1 +0000\n' +
        'committer Orrery <orrery@example.com> 1 +0000\n' +
        '\n' +
        'c1\n',
    );
  });

  it('내용이 1비트라도 다르면 해시가 달라진다 (커밋 = 내용의 해시)', () => {
    const base: GitObject = {
      type: 'commit',
      tree: TREE_SINGLE,
      parents: [],
      author: sig(1),
      committer: sig(1),
      message: 'c1\n',
    };
    const differentMessage: GitObject = { ...base, message: 'c2\n' };
    const differentClock: GitObject = { ...base, author: sig(2), committer: sig(2) };
    expect(hashObject(differentMessage)).not.toBe(hashObject(base));
    expect(hashObject(differentClock)).not.toBe(hashObject(base));
  });
});

describe('shortSha', () => {
  it('앞 7자를 반환한다', () => {
    expect(shortSha(BLOB_HELLO)).toBe('b6fc4c6');
  });
});
