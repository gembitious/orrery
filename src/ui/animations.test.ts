import { describe, expect, it } from 'vitest';
import { execute } from '../command/execute';
import { run } from '../command/run';
import { deriveSlides } from './animations';

const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];
const B6 = 'b6fc4c6'; // blob 'hello'의 짧은 해시

function slidesOf(setup: string[], command: string) {
  const repo = run(setup);
  const result = execute(repo, command);
  return { slides: deriveSlides(result.diff, repo, result.repo), result };
}

describe('deriveSlides — 오른쪽으로 (add/commit)', () => {
  it('git add: WT 셀 → index 셀', () => {
    const { slides } = slidesOf(['git init', 'echo hello > f.txt'], 'git add f.txt');
    expect(slides).toEqual([{ fromKey: 'cell:wt:f.txt', toKey: 'cell:idx:f.txt', label: B6 }]);
  });

  it('git add .: 파일마다 슬라이드', () => {
    const { slides } = slidesOf(['git init', 'echo a > a.txt', 'echo b > b.txt'], 'git add .');
    expect(slides.map((s) => s.fromKey).sort()).toEqual(['cell:wt:a.txt', 'cell:wt:b.txt']);
  });

  it('같은 내용 재-add는 no-op이므로 슬라이드 없음', () => {
    const { slides } = slidesOf(['git init', 'echo hello > f.txt', 'git add f.txt'], 'git add f.txt');
    expect(slides).toEqual([]);
  });

  it('git commit: index의 모든 파일이 HEAD 셀로', () => {
    const { slides } = slidesOf(['git init', 'echo hello > f.txt', 'git add f.txt'], 'git commit -m c1');
    expect(slides).toEqual([{ fromKey: 'cell:idx:f.txt', toKey: 'cell:head:f.txt', label: B6 }]);
  });

  it('detached HEAD에서의 commit도 슬라이드가 나온다', () => {
    const base = run(BASE);
    const c1 = base.refs.get('refs/heads/main') ?? '';
    const detached = run(['echo world > g.txt', 'git add g.txt'], {
      ...base,
      head: { kind: 'detached', sha: c1 },
    });
    const result = execute(detached, 'git commit -m c2');
    const slides = deriveSlides(result.diff, detached, result.repo);
    expect(slides.some((s) => s.toKey === 'cell:head:g.txt')).toBe(true);
  });
});

describe('deriveSlides — 왼쪽으로 (restore 계열)', () => {
  it('git restore: index 셀 → WT 셀', () => {
    const { slides } = slidesOf([...BASE, 'echo v2 > f.txt'], 'git restore f.txt');
    expect(slides).toEqual([{ fromKey: 'cell:idx:f.txt', toKey: 'cell:wt:f.txt', label: B6 }]);
  });

  it('git restore --staged: HEAD 셀 → index 셀', () => {
    const { slides } = slidesOf(
      [...BASE, 'echo v2 > f.txt', 'git add f.txt'],
      'git restore --staged f.txt',
    );
    expect(slides).toEqual([{ fromKey: 'cell:head:f.txt', toKey: 'cell:idx:f.txt', label: B6 }]);
  });

  it('git reset(제자리 unstage)도 head → idx 슬라이드', () => {
    const { slides } = slidesOf([...BASE, 'echo v2 > f.txt', 'git add f.txt'], 'git reset');
    expect(slides).toEqual([{ fromKey: 'cell:head:f.txt', toKey: 'cell:idx:f.txt', label: B6 }]);
  });

  it('수정 후 원래 내용으로 재-add하면 WT에서 온 것으로 본다 (wt → idx 우선)', () => {
    const { slides } = slidesOf(
      [...BASE, 'echo v2 > f.txt', 'git add f.txt', 'echo hello > f.txt'],
      'git add f.txt',
    );
    expect(slides).toEqual([{ fromKey: 'cell:wt:f.txt', toKey: 'cell:idx:f.txt', label: B6 }]);
  });
});

describe('deriveSlides — 통째로 바뀌는 전이는 슬라이드 없음', () => {
  it('git branch(생성): 커밋 객체가 새로 생기지 않으므로 없음', () => {
    const { slides } = slidesOf(BASE, 'git branch feature');
    expect(slides).toEqual([]);
  });

  it('git reset --mixed HEAD~1: movedRefs가 있으므로 없음', () => {
    const { slides } = slidesOf(
      [...BASE, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2', 'echo v2 > f.txt', 'git add f.txt'],
      'git reset HEAD~1',
    );
    expect(slides).toEqual([]);
  });

  it('git checkout: headChange가 있으므로 없음', () => {
    const { slides } = slidesOf(
      [
        ...BASE,
        'git checkout -b feature',
        'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
        'git checkout main',
      ],
      'git checkout feature',
    );
    expect(slides).toEqual([]);
  });
});
