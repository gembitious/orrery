import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const C2 = '87c91b76e9e75bf0619d2e2af2c9eede5603cc8b';
const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];
const TWO = [...BASE, 'echo world > g.txt', 'git add g.txt', 'git commit -m c2'];

describe('git log', () => {
  it('전체 포맷이 실제 git과 일치한다 (데코레이션, epoch 날짜 포함)', () => {
    expect(execute(run(BASE), 'git log').output).toEqual([
      `commit ${C1} (HEAD -> main)`,
      'Author: Orrery <orrery@example.com>',
      'Date:   Thu Jan 1 00:00:01 1970 +0000',
      '',
      '    c1',
    ]);
  });

  it('최신 커밋부터 부모 방향으로 출력한다', () => {
    const output = execute(run(TWO), 'git log').output;
    expect(output).toEqual([
      `commit ${C2} (HEAD -> main)`,
      'Author: Orrery <orrery@example.com>',
      'Date:   Thu Jan 1 00:00:02 1970 +0000',
      '',
      '    c2',
      '',
      `commit ${C1}`,
      'Author: Orrery <orrery@example.com>',
      'Date:   Thu Jan 1 00:00:01 1970 +0000',
      '',
      '    c1',
    ]);
  });

  it('다른 브랜치 라벨도 데코레이션에 나온다', () => {
    const repo = run([...TWO, 'git branch feature', 'git branch alpha']);
    const output = execute(repo, 'git log').output;
    expect(output[0]).toBe(`commit ${C2} (HEAD -> main, alpha, feature)`);
  });

  it('detached HEAD는 HEAD 라벨이 커밋에 직접 붙는다', () => {
    const repo = run([...TWO, `git checkout ${C1.slice(0, 7)}`]);
    const output = execute(repo, 'git log').output;
    // C1에서 detached — C2는 로그에 나오지 않는다 (HEAD 기준 순회)
    expect(output[0]).toBe(`commit ${C1} (HEAD)`);
    expect(output.join('\n')).not.toContain(C2);
  });

  it('브랜치가 갈라지면 HEAD 쪽 체인만 보인다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b feature',
      'echo x > x.txt',
      'git add x.txt',
      'git commit -m on-feature',
      'git checkout main',
    ]);
    const output = execute(repo, 'git log').output;
    expect(output.join('\n')).toContain('c1');
    expect(output.join('\n')).not.toContain('on-feature');
  });

  it('멀티라인 메시지는 4칸 들여쓰기로 전부 출력된다', () => {
    const repo = run(['git init', 'echo a > f.txt', 'git add f.txt',
      'git commit -m "title\n\nbody line"']);
    const output = execute(repo, 'git log').output;
    expect(output.slice(-3)).toEqual(['    title', '    ', '    body line']);
  });

  it('unborn 상태에서는 실제 git 문구로 실패한다', () => {
    expect(execute(run(['git init']), 'git log').error).toBe(
      "fatal: your current branch 'main' does not have any commits yet",
    );
    const renamed = run(['git init', 'git checkout -b dev']);
    expect(execute(renamed, 'git log').error).toBe(
      "fatal: your current branch 'dev' does not have any commits yet",
    );
  });

  it('log는 상태를 바꾸지 않는다', () => {
    const repo = run(TWO);
    const result = execute(repo, 'git log');
    expect(result.repo).toBe(repo);
  });

  it('인자는 아직 미지원', () => {
    expect(execute(run(BASE), 'git log --oneline').error).toMatch(/지원하지 않습니다/);
  });
});
