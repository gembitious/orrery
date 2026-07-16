import { describe, expect, it } from 'vitest';
import { run } from '../command/run';
import { buildAreasView } from './areasData';

const BASE = ['git init', 'echo v1 > f.txt', 'git add f.txt', 'git commit -m c1'];

function rowOf(view: ReturnType<typeof buildAreasView>, file: string) {
  const row = view.rows.find((r) => r.file === file);
  if (row === undefined) throw new Error(`no row for ${file}`);
  return row;
}

describe('buildAreasView', () => {
  it('깨끗한 tracked 파일: 세 셀의 blob sha가 모두 같다', () => {
    const view = buildAreasView(run(BASE));
    const row = rowOf(view, 'f.txt');
    expect(row.worktree?.sha).toBeDefined();
    expect(row.worktree?.sha).toBe(row.index?.sha);
    expect(row.index?.sha).toBe(row.head?.sha);
    expect(row.worktree?.badge).toBeUndefined();
    expect(row.index?.badge).toBeUndefined();
  });

  it('staged+modified: 세 영역의 sha가 전부 다르다', () => {
    const view = buildAreasView(
      run([...BASE, 'echo v2 > f.txt', 'git add f.txt', 'echo v3 > f.txt']),
    );
    const row = rowOf(view, 'f.txt');
    expect(row.worktree?.badge).toBe('modified');
    expect(row.index?.badge).toBe('modified');
    expect(row.worktree?.sha).not.toBe(row.index?.sha);
    expect(row.index?.sha).not.toBe(row.head?.sha);
  });

  it('untracked: WT에만 있고 badge는 untracked', () => {
    const view = buildAreasView(run(['git init', 'echo x > new.txt']));
    const row = rowOf(view, 'new.txt');
    expect(row.worktree?.badge).toBe('untracked');
    expect(row.index).toBeUndefined();
    expect(row.head).toBeUndefined();
  });

  it('staged new file: WT와 index 셀의 sha가 같고 added 배지', () => {
    const view = buildAreasView(run(['git init', 'echo x > a.txt', 'git add a.txt']));
    const row = rowOf(view, 'a.txt');
    expect(row.index?.badge).toBe('added');
    expect(row.worktree?.sha).toBe(row.index?.sha);
    expect(row.head).toBeUndefined();
  });

  it('unstaged 삭제: WT 유령 셀, index/HEAD에는 남아 있다', () => {
    const view = buildAreasView(run([...BASE, 'rm f.txt']));
    const row = rowOf(view, 'f.txt');
    expect(row.worktree).toBeUndefined();
    expect(row.worktreeDeleted).toBe(true);
    expect(row.index?.sha).toBe(row.head?.sha);
  });

  it('staged 삭제: index 유령 셀, HEAD에만 남아 있다', () => {
    const view = buildAreasView(run([...BASE, 'rm f.txt', 'git add f.txt']));
    const row = rowOf(view, 'f.txt');
    expect(row.worktree).toBeUndefined();
    expect(row.worktreeDeleted).toBe(false); // index에 없으므로 WT 삭제 배지도 아님
    expect(row.index).toBeUndefined();
    expect(row.indexDeleted).toBe(true);
    expect(row.head?.sha).toBeDefined();
  });

  it('HEAD 라벨: 브랜치 / unborn / detached', () => {
    expect(buildAreasView(run(BASE)).headLabel).toBe('main');
    expect(buildAreasView(run(['git init'])).headLabel).toBe('unborn');
    const repo = run(BASE);
    const detached = { ...repo, head: { kind: 'detached', sha: repo.refs.get('refs/heads/main') ?? '' } as const };
    expect(buildAreasView(detached).headLabel).toBe('detached');
  });

  it('행은 파일명순', () => {
    const view = buildAreasView(run(['git init', 'echo 1 > z.txt', 'echo 2 > a.txt']));
    expect(view.rows.map((r) => r.file)).toEqual(['a.txt', 'z.txt']);
  });
});
