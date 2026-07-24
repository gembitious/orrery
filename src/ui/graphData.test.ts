import { describe, expect, it } from 'vitest';
import { run } from '../command/run';
import { collectLabels, listCommitsByTime } from './graphData';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const C2 = '87c91b76e9e75bf0619d2e2af2c9eede5603cc8b';

describe('listCommitsByTime', () => {
  it('커밋만 최신순으로 나열한다 (blob/tree 제외)', () => {
    const repo = run([
      'git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1',
      'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
    ]);
    const nodes = listCommitsByTime(repo);
    expect(nodes.map((n) => n.sha)).toEqual([C2, C1]);
  });

  it('빈 저장소는 빈 배열', () => {
    expect(listCommitsByTime(run(['git init']))).toEqual([]);
  });
});

describe('collectLabels', () => {
  const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];

  it('symbolic HEAD는 headBranch로, 다른 브랜치는 branches로 구분된다', () => {
    const repo = run([...BASE, 'git branch feature', 'git branch alpha']);
    const labels = collectLabels(repo).get(C1);
    expect(labels).toEqual({
      detachedHead: false,
      headBranch: 'main',
      branches: ['alpha', 'feature'], // 이름순
      stashes: [],
    });
  });

  it('detached HEAD는 커밋에 직접 붙는다', () => {
    const repo = run([...BASE, `git checkout ${C1.slice(0, 7)}`]);
    const labels = collectLabels(repo).get(C1);
    expect(labels?.detachedHead).toBe(true);
    expect(labels?.headBranch).toBeUndefined();
    expect(labels?.branches).toEqual(['main']); // 브랜치 라벨은 그대로
  });

  it('브랜치가 서로 다른 커밋에 있으면 각자 커밋에 라벨이 붙는다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b feature',
      'echo world > g.txt', 'git add g.txt', 'git commit -m c2',
    ]);
    const labels = collectLabels(repo);
    expect(labels.get(C1)?.branches).toEqual(['main']);
    expect(labels.get(C2)?.headBranch).toBe('feature');
  });

  it('unborn 저장소는 빈 맵', () => {
    expect(collectLabels(run(['git init'])).size).toBe(0);
  });
});
