import { describe, expect, it } from 'vitest';
import { run } from '../command/run';
import { listCommitsByTime } from './graphData';

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
