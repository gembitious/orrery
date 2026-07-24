import { describe, expect, it } from 'vitest';
import { createRepository } from '../core/repository';
import { execute } from './execute';
import { run } from './run';

describe('git init', () => {
  it('저장소를 초기화하고 HEAD가 unborn main을 가리킨다', () => {
    const result = execute(createRepository(), 'git init');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual(['Initialized empty Git repository in /repo/.git/']);
    expect(result.repo.initialized).toBe(true);
    expect(result.repo.head).toEqual({ kind: 'symbolic', ref: 'refs/heads/main' });
    // unborn branch: HEAD는 main을 가리키지만 refs/heads/main은 아직 없다
    expect(result.repo.refs.size).toBe(0);
    expect(result.repo.objects.size).toBe(0);
  });

  it('재초기화는 에러가 아니고 상태를 바꾸지 않는다', () => {
    const repo = run(['git init', 'echo "a" > f.txt']);
    const result = execute(repo, 'git init');
    expect(result.error).toBeUndefined();
    expect(result.output[0]).toMatch(/^Reinitialized existing Git repository/);
    expect(result.repo.workingTree.get('f.txt')).toBe('a');
  });

  it('init 전에 만든 파일은 init 후에도 남아 있다 (실제 git과 동일)', () => {
    const repo = run(['echo "pre" > f.txt', 'git init']);
    expect(repo.initialized).toBe(true);
    expect(repo.workingTree.get('f.txt')).toBe('pre');
  });
});

describe('echo > (파일 쓰기)', () => {
  it('파일을 생성하고 diff에 created가 남는다', () => {
    const result = execute(createRepository(), 'echo "hello world" > f.txt');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.get('f.txt')).toBe('hello world');
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'created' }]);
  });

  it('기존 파일 덮어쓰기는 diff에 modified가 남는다', () => {
    const repo = run(['echo "v1" > f.txt']);
    const result = execute(repo, 'echo "v2" > f.txt');
    expect(result.repo.workingTree.get('f.txt')).toBe('v2');
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'modified' }]);
  });

  it('따옴표 없는 여러 단어는 공백 하나로 이어진다 (셸 echo와 동일)', () => {
    const repo = run(['echo a b  c > f.txt']);
    expect(repo.workingTree.get('f.txt')).toBe('a b c');
  });

  it('빈 내용의 파일을 만들 수 있다', () => {
    const repo = run(['echo "" > empty.txt']);
    expect(repo.workingTree.get('empty.txt')).toBe('');
  });

  it('따옴표로 감싼 >는 내용으로 취급된다', () => {
    const repo = run(['echo ">" > f.txt']);
    expect(repo.workingTree.get('f.txt')).toBe('>');
  });

  it('리다이렉션 없는 echo는 출력만 한다', () => {
    const result = execute(createRepository(), 'echo hi there');
    expect(result.output).toEqual(['hi there']);
    expect(result.repo.workingTree.size).toBe(0);
  });

  it("파일명에 '/'가 들어가면 에러 (flat FS)", () => {
    const result = execute(createRepository(), 'echo "a" > dir/f.txt');
    expect(result.error).toMatch(/flat FS/);
  });

  it('대상 파일이 여러 개면 에러', () => {
    const result = execute(createRepository(), 'echo "a" > f.txt g.txt');
    expect(result.error).toBeDefined();
  });
});

describe('rm', () => {
  it('파일을 삭제하고 diff에 deleted가 남는다', () => {
    const repo = run(['echo "a" > f.txt']);
    const result = execute(repo, 'rm f.txt');
    expect(result.error).toBeUndefined();
    expect(result.repo.workingTree.has('f.txt')).toBe(false);
    expect(result.diff.workingTreeChanges).toEqual([{ file: 'f.txt', kind: 'deleted' }]);
  });

  it('없는 파일이면 실제 rm과 같은 에러', () => {
    const result = execute(createRepository(), 'rm ghost.txt');
    expect(result.error).toBe("rm: cannot remove 'ghost.txt': No such file or directory");
  });

  it('옵션이나 다중 파일은 지원하지 않는다', () => {
    const repo = run(['echo "a" > f.txt']);
    expect(execute(repo, 'rm -rf f.txt').error).toBeDefined();
    expect(execute(repo, 'rm f.txt f.txt').error).toBeDefined();
  });
});

describe('에러 경로', () => {
  it('init 전의 git 명령은 not a git repository', () => {
    const result = execute(createRepository(), 'git status');
    expect(result.error).toBe(
      'fatal: not a git repository (or any of the parent directories): .git',
    );
  });

  it('init 후 미구현 git 명령은 명시적 미지원 에러', () => {
    const repo = run(['git init']);
    expect(execute(repo, 'git diff').error).toBe(
      "orrery: 'diff'은(는) 아직 지원하지 않습니다",
    );
  });

  it('git에 없는 하위 명령은 실제 git 문구', () => {
    const repo = run(['git init']);
    expect(execute(repo, 'git frobnicate').error).toBe(
      "git: 'frobnicate' is not a git command. See 'git --help'.",
    );
  });

  it('지원하지 않는 최상위 명령', () => {
    expect(execute(createRepository(), 'ls -la').error).toMatch(/지원하지 않는 명령/);
  });

  it('닫히지 않은 따옴표', () => {
    expect(execute(createRepository(), 'echo "abc').error).toMatch(/따옴표/);
  });

  it('빈 입력은 no-op 성공', () => {
    const repo = createRepository();
    const result = execute(repo, '   ');
    expect(result.error).toBeUndefined();
    expect(result.repo).toBe(repo);
  });
});

describe('불변성', () => {
  it('성공한 명령은 원본 Repository를 수정하지 않는다', () => {
    const before = run(['git init', 'echo "a" > f.txt']);
    execute(before, 'echo "b" > f.txt');
    execute(before, 'rm f.txt');
    expect(before.workingTree.get('f.txt')).toBe('a');
    expect(before.workingTree.size).toBe(1);
  });

  it('실패한 명령은 원본 Repository 객체를 그대로 반환한다', () => {
    const repo = createRepository();
    const result = execute(repo, 'rm ghost.txt');
    expect(result.repo).toBe(repo);
  });
});

describe('run 헬퍼', () => {
  it('명령 시퀀스를 순서대로 실행한다', () => {
    const repo = run([
      'git init',
      'echo "a" > a.txt',
      'echo "b" > b.txt',
      'rm a.txt',
    ]);
    expect(repo.initialized).toBe(true);
    expect([...repo.workingTree.keys()]).toEqual(['b.txt']);
  });

  it('중간에 실패하면 어떤 명령이 실패했는지와 함께 던진다', () => {
    expect(() => run(['git init', 'rm ghost.txt'])).toThrow(/rm ghost.txt/);
  });
});
