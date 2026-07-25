import { describe, expect, it } from 'vitest';
import { run } from '../command/run';
import { resolveHead } from '../core/repository';
import { getCommit } from '../core/revision';
import { inspectObject } from './inspect';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const TREE_C1 = '6d7572818a587501467139ad1ef01aebe98eeb6d';
const BLOB_HELLO = 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0';
const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('inspectObject', () => {
  it('커밋: 헤더 size가 known-answer(139)와 일치하고 tree sha가 링크 토큰이다', () => {
    const repo = run(BASE);
    const inspection = inspectObject(repo, C1);
    expect(inspection?.type).toBe('commit');
    expect(inspection?.size).toBe(139); // 1.1에서 실제 git과 대조한 그 값
    expect(inspection?.tokens[0]).toEqual({ kind: 'text', text: 'commit 139' });
    expect(inspection?.tokens[1]).toEqual({ kind: 'nul' });
    expect(inspection?.tokens).toContainEqual({ kind: 'sha', sha: TREE_C1, raw: false });
  });

  it('부모가 있는 커밋은 parent sha도 링크 토큰이다', () => {
    const repo = run([...BASE, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2']);
    const head = resolveHead(repo) ?? '';
    const inspection = inspectObject(repo, head);
    expect(inspection?.tokens).toContainEqual({ kind: 'sha', sha: C1, raw: false });
  });

  it('tree: 엔트리가 이름순이고 blob sha는 raw 링크 토큰이다', () => {
    const repo = run([
      'git init',
      'echo hello > b.txt', 'echo hello > a.txt', 'git add .', 'git commit -m c1',
    ]);
    const head = getCommit(repo, resolveHead(repo) ?? '');
    const inspection = inspectObject(repo, head.tree);
    expect(inspection?.type).toBe('tree');
    const texts = inspection?.tokens.filter((t) => t.kind === 'text').map((t) => t.text) ?? [];
    const aIdx = texts.findIndex((t) => t.includes('a.txt'));
    const bIdx = texts.findIndex((t) => t.includes('b.txt'));
    expect(aIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx); // 이름순
    expect(inspection?.tokens).toContainEqual({ kind: 'sha', sha: BLOB_HELLO, raw: true });
  });

  it('blob: 내용이 그대로 보이고 size는 바이트 수', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt']);
    const inspection = inspectObject(repo, BLOB_HELLO);
    expect(inspection?.type).toBe('blob');
    expect(inspection?.size).toBe(5);
    expect(inspection?.tokens).toContainEqual({ kind: 'text', text: 'hello' });
  });

  it('없는 객체는 undefined — add 전의 working tree 해시가 이 경우다', () => {
    const repo = run(['git init', 'echo hello > f.txt']); // add 안 함
    expect(inspectObject(repo, BLOB_HELLO)).toBeUndefined();
  });
});
