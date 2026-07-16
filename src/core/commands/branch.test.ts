import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';

const C1 = '370125d0f9a1dc2e537695a7a63d06d82802a7fa';
const BASE = ['git init', 'echo hello > f.txt', 'git add f.txt', 'git commit -m c1'];
// feature에만 있는 커밋을 만들어 미머지 상태를 구성
const DIVERGED = [
  ...BASE,
  'git checkout -b feature',
  'echo world > g.txt',
  'git add g.txt',
  'git commit -m c2',
  'git checkout main',
];

describe('git branch <name>', () => {
  it('HEAD 커밋을 가리키는 포인터를 만든다 (커밋 객체는 그대로)', () => {
    const before = run(BASE);
    const result = execute(before, 'git branch feature');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([]); // 실제 git branch는 침묵
    expect(result.repo.refs.get('refs/heads/feature')).toBe(C1);
    expect(result.repo.objects.size).toBe(before.objects.size);
    expect(result.repo.head).toEqual(before.head); // HEAD는 안 움직인다
    expect(result.diff.movedRefs).toEqual([{ ref: 'refs/heads/feature', to: C1 }]);
  });

  it('중복 이름은 실제 git 문구로 거부', () => {
    const repo = run([...BASE, 'git branch feature']);
    expect(execute(repo, 'git branch feature').error).toBe(
      "fatal: a branch named 'feature' already exists",
    );
  });

  it('unborn 상태에서는 가리킬 커밋이 없어 실패', () => {
    expect(execute(run(['git init']), 'git branch feature').error).toBe(
      "fatal: not a valid object name: 'main'",
    );
  });

  it('잘못된 브랜치 이름 거부', () => {
    const repo = run(BASE);
    for (const bad of ['bad..name', '.hidden', 'end/', 'a.lock', 'HEAD']) {
      expect(execute(repo, `git branch ${bad}`).error).toBe(
        `fatal: '${bad}' is not a valid branch name`,
      );
    }
    // '-'로 시작하는 이름은 파서가 옵션으로 해석한다 (실제 git도 unknown switch)
    expect(execute(repo, 'git branch -x').error).toMatch(/'-x'.*지원하지 않습니다/);
  });
});

describe('git branch (목록)', () => {
  it('이름순 정렬, 현재 브랜치에 * 표시', () => {
    const repo = run([...BASE, 'git branch feature', 'git branch alpha']);
    expect(execute(repo, 'git branch').output).toEqual(['  alpha', '  feature', '* main']);
  });

  it('detached HEAD는 첫 줄에 표시된다', () => {
    const repo = run([...BASE, 'git branch feature', `git checkout ${C1.slice(0, 7)}`]);
    expect(execute(repo, 'git branch').output).toEqual([
      '* (HEAD detached at 370125d)',
      '  feature',
      '  main',
    ]);
  });

  it('unborn 상태에서는 아무것도 출력하지 않는다', () => {
    expect(execute(run(['git init']), 'git branch').output).toEqual([]);
  });
});

describe('git branch -d / -D', () => {
  it('머지된(HEAD에서 도달 가능한) 브랜치는 -d로 삭제된다', () => {
    const repo = run([...BASE, 'git branch feature']);
    const result = execute(repo, 'git branch -d feature');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(['Deleted branch feature (was 370125d).']);
    expect(result.repo.refs.has('refs/heads/feature')).toBe(false);
    expect(result.diff.deletedRefs).toEqual(['refs/heads/feature']);
  });

  it('미머지 브랜치는 -d로 거부된다', () => {
    const repo = run(DIVERGED);
    expect(execute(repo, 'git branch -d feature').error).toBe(
      "error: the branch 'feature' is not fully merged.\n" +
        "If you are sure you want to delete it, run 'git branch -D feature'",
    );
    expect(repo.refs.has('refs/heads/feature')).toBe(true);
  });

  it('-D는 미머지 브랜치도 강제 삭제한다', () => {
    const repo = run(DIVERGED);
    const result = execute(repo, 'git branch -D feature');
    expect(result.error).toBeUndefined();
    expect(result.repo.refs.has('refs/heads/feature')).toBe(false);
    // 커밋 객체 자체는 남는다 — ref만 사라져 미아(unreachable)가 될 뿐
    const c2 = [...result.repo.objects.values()].filter((o) => o.type === 'commit');
    expect(c2.length).toBe(2);
  });

  it('현재 브랜치는 삭제할 수 없다', () => {
    expect(execute(run(BASE), 'git branch -d main').error).toBe(
      "error: cannot delete branch 'main' used by worktree at '/repo'",
    );
  });

  it('없는 브랜치', () => {
    expect(execute(run(BASE), 'git branch -d ghost').error).toBe("error: branch 'ghost' not found");
  });
});
