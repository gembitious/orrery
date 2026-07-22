import { describe, expect, it } from 'vitest';
import { execute } from '../command/execute';
import { run } from '../command/run';
import { deriveSlides } from './animations';

const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

describe('deriveSlides', () => {
  it('git add: WT 셀 → index 셀 슬라이드', () => {
    const repo = run(['git init', 'echo hello > f.txt']);
    const result = execute(repo, 'git add f.txt');
    expect(deriveSlides(result.diff, result.repo)).toEqual([
      { fromKey: 'cell:wt:f.txt', toKey: 'cell:idx:f.txt', label: 'b6fc4c6' },
    ]);
  });

  it('git add .: 파일마다 슬라이드', () => {
    const repo = run(['git init', 'echo a > a.txt', 'echo b > b.txt']);
    const result = execute(repo, 'git add .');
    const slides = deriveSlides(result.diff, result.repo);
    expect(slides.map((s) => s.fromKey).sort()).toEqual(['cell:wt:a.txt', 'cell:wt:b.txt']);
  });

  it('같은 내용 재-add는 no-op이므로 슬라이드 없음', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git add f.txt');
    expect(deriveSlides(result.diff, result.repo)).toEqual([]);
  });

  it('git commit: index의 모든 파일이 HEAD 셀로 슬라이드', () => {
    const repo = run(['git init', 'echo hello > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git commit -m c1');
    expect(deriveSlides(result.diff, result.repo)).toEqual([
      { fromKey: 'cell:idx:f.txt', toKey: 'cell:head:f.txt', label: 'b6fc4c6' },
    ]);
  });

  it('detached HEAD에서의 commit도 슬라이드가 나온다', () => {
    const base = run(BASE);
    const c1 = base.refs.get('refs/heads/main') ?? '';
    const detached = run(['echo world > g.txt', 'git add g.txt'], {
      ...base,
      head: { kind: 'detached', sha: c1 },
    });
    const result = execute(detached, 'git commit -m c2');
    const slides = deriveSlides(result.diff, result.repo);
    expect(slides.some((s) => s.toKey === 'cell:head:g.txt')).toBe(true);
  });

  it('git branch(생성): 커밋 객체가 새로 생기지 않으므로 슬라이드 없음', () => {
    const repo = run(BASE);
    const result = execute(repo, 'git branch feature');
    expect(deriveSlides(result.diff, result.repo)).toEqual([]);
  });

  it('git reset --mixed: index가 통째로 바뀌어도 add 슬라이드를 만들지 않는다', () => {
    const repo = run([...BASE, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
      'echo v2 > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git reset HEAD~1');
    expect(deriveSlides(result.diff, result.repo)).toEqual([]);
  });

  it('git reset HEAD(제자리 unstage): staged sha가 WT 해시와 다르므로 슬라이드 없음', () => {
    const repo = run([...BASE, 'echo v2 > f.txt', 'git add f.txt']);
    const result = execute(repo, 'git reset');
    expect(deriveSlides(result.diff, result.repo)).toEqual([]);
  });

  it('git checkout: headChange가 있으므로 add 슬라이드를 만들지 않는다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b feature',
      'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
      'git checkout main',
    ]);
    const result = execute(repo, 'git checkout feature');
    expect(deriveSlides(result.diff, result.repo)).toEqual([]);
  });
});
