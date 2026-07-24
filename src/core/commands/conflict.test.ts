import { describe, expect, it } from 'vitest';
import { execute } from '../../command/execute';
import { run } from '../../command/run';
import { hashObject } from '../objects';
import { getCommit } from '../revision';
import { computeStatus } from '../status';

const BASE = ['git init', 'echo base > f.txt', 'git add .', 'git commit -m c1'];
// f.txt를 양쪽이 서로 다르게 수정 → 내용 충돌
const CLASH = [
  ...BASE,
  'git checkout -b clash',
  'echo A > f.txt', 'git add .', 'git commit -m ca',
  'git checkout main',
  'echo B > f.txt', 'git add .', 'git commit -m cb',
];

const sha = (content: string) => hashObject({ type: 'blob', content });

describe('충돌 발생 (git merge)', () => {
  it('저장소가 머지 중 상태가 되고 index에 stage 1/2/3이 생긴다', () => {
    const before = run(CLASH);
    const result = execute(before, 'git merge clash');

    expect(result.error).toBeUndefined(); // 상태가 변했으므로 실패가 아니다
    expect(result.output).toEqual([
      'Auto-merging f.txt',
      'CONFLICT (content): Merge conflict in f.txt',
      'Automatic merge failed; fix conflicts and then commit the result.',
    ]);

    const repo = result.repo;
    expect(repo.merging).toEqual({
      theirs: before.refs.get('refs/heads/clash'),
      message: "Merge branch 'clash'",
    });
    const entry = repo.index.get('f.txt');
    expect(entry?.conflicted).toBe(true);
    if (entry?.conflicted === true) {
      expect(entry.stages).toEqual({ 1: sha('base'), 2: sha('B'), 3: sha('A') });
    }
  });

  it('working tree에 실제 충돌 마커가 쓰인다', () => {
    const repo = run([...CLASH, 'git merge clash']);
    expect(repo.workingTree.get('f.txt')).toBe(
      '<<<<<<< HEAD\nB\n=======\nA\n>>>>>>> clash',
    );
  });

  it('깨끗하게 합쳐지는 파일은 충돌 중에도 staged로 반영된다', () => {
    const repo = run([
      ...BASE,
      'git checkout -b both',
      'echo A > f.txt', 'echo t > t.txt', 'git add .', 'git commit -m ca',
      'git checkout main',
      'echo B > f.txt', 'git add .', 'git commit -m cb',
      'git merge both',
    ]);
    expect(repo.workingTree.get('t.txt')).toBe('t'); // 그쪽의 새 파일은 그대로 들어옴
    const status = computeStatus(repo);
    expect(status.entries).toEqual([
      { file: 'f.txt', unmerged: 'both modified' },
      { file: 't.txt', index: 'added' },
    ]);
  });

  it('modify/delete 충돌: 남은 쪽 버전이 WT에 남고 deleted by them', () => {
    const repo = run([
      ...BASE,
      'git checkout -b killer',
      'rm f.txt', 'git add f.txt', 'git commit -m del',
      'git checkout main',
      'echo mod > f.txt', 'git add .', 'git commit -m mod',
    ]);
    const result = execute(repo, 'git merge killer');
    expect(result.output[0]).toBe(
      'CONFLICT (modify/delete): f.txt deleted in killer and modified in HEAD.  ' +
        'Version HEAD of f.txt left in tree.',
    );
    expect(result.repo.workingTree.get('f.txt')).toBe('mod');
    const entry = result.repo.index.get('f.txt');
    if (entry?.conflicted === true) {
      expect(entry.stages[3]).toBeUndefined(); // 그쪽(theirs)이 지웠다
    }
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'f.txt', unmerged: 'deleted by them' },
    ]);
  });
});

describe('충돌 중의 status', () => {
  it('You have unmerged paths와 both modified 표기', () => {
    const repo = run([...CLASH, 'git merge clash']);
    expect(execute(repo, 'git status').output).toEqual([
      'On branch main',
      'You have unmerged paths.',
      '  (fix conflicts and run "git commit")',
      '  (use "git merge --abort" to abort the merge)',
      '',
      'Unmerged paths:',
      '  (use "git add <file>..." to mark resolution)',
      '\tboth modified:   f.txt',
      '',
      'no changes added to commit (use "git add" and/or "git commit -a")',
    ]);
  });

  it('해소 후에는 All conflicts fixed (unstage 힌트 없이)', () => {
    const repo = run([...CLASH, 'git merge clash', 'echo merged > f.txt', 'git add f.txt']);
    expect(execute(repo, 'git status').output).toEqual([
      'On branch main',
      'All conflicts fixed but you are still merging.',
      '  (use "git commit" to conclude merge)',
      '',
      'Changes to be committed:',
      '\tmodified:   f.txt',
    ]);
  });
});

describe('충돌 중 차단되는 명령들 (실제 git 문구)', () => {
  const conflicted = () => run([...CLASH, 'git merge clash']);

  it('commit', () => {
    expect(execute(conflicted(), 'git commit -m x').error).toBe(
      'error: Committing is not possible because you have unmerged files.\n' +
        "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
        'hint: as appropriate to mark resolution and make a commit.\n' +
        'fatal: Exiting because of an unresolved conflict.',
    );
  });

  it('checkout / merge / amend / stash / restore / rm --cached / reset --soft', () => {
    const repo = conflicted();
    expect(execute(repo, 'git checkout clash').error).toBe(
      'error: you need to resolve your current index first',
    );
    expect(execute(repo, 'git merge clash').error).toMatch(/^error: Merging is not possible/);
    expect(execute(repo, 'git commit --amend -m x').error).toBe(
      'fatal: You are in the middle of a merge -- cannot amend.',
    );
    expect(execute(repo, 'git stash').error).toMatch(/^f.txt: needs merge/);
    expect(execute(repo, 'git restore f.txt').error).toBe("error: path 'f.txt' is unmerged");
    expect(execute(repo, 'git rm --cached f.txt').error).toBe("error: path 'f.txt' is unmerged");
    expect(execute(repo, 'git reset --soft HEAD').error).toBe(
      'fatal: Cannot do a soft reset in the middle of a merge.',
    );
  });
});

describe('해소 플로우', () => {
  it('add로 해소하고 bare git commit이 MERGE_MSG로 머지를 완결한다', () => {
    const before = run(CLASH);
    const theirs = before.refs.get('refs/heads/clash') ?? '';
    const ours = before.refs.get('refs/heads/main') ?? '';

    const repo = run(
      ['git merge clash', 'echo merged > f.txt', 'git add f.txt', 'git commit'],
      before,
    );
    const mergeSha = repo.refs.get('refs/heads/main') ?? '';
    const merge = getCommit(repo, mergeSha);
    expect(merge.parents).toEqual([ours, theirs]); // MERGE_HEAD가 두 번째 부모
    expect(merge.message).toBe("Merge branch 'clash'\n");
    expect(repo.merging).toBeUndefined(); // 머지 상태 소비됨
    expect(computeStatus(repo).clean).toBe(true);
    expect(repo.workingTree.get('f.txt')).toBe('merged');
  });

  it('commit -m으로 메시지를 바꿔 완결할 수도 있다', () => {
    const repo = run([...CLASH, 'git merge clash', 'echo m > f.txt', 'git add f.txt',
      'git commit -m "custom merge"']);
    const merge = getCommit(repo, repo.refs.get('refs/heads/main') ?? '');
    expect(merge.message).toBe('custom merge\n');
    expect(merge.parents.length).toBe(2);
  });

  it('rm + add로 삭제를 선택해 해소할 수도 있다', () => {
    const repo = run([
      ...CLASH,
      'git merge clash',
      'rm f.txt', 'git add f.txt', // 삭제로 해소
      'git commit',
    ]);
    expect(repo.workingTree.has('f.txt')).toBe(false);
    expect(computeStatus(repo).clean).toBe(true);
  });

  it('머지 완결 커밋은 tree가 HEAD와 같아도 허용된다', () => {
    // 충돌을 우리 쪽(B)으로 해소 → tree는 HEAD와 동일하지만 머지는 완결되어야 한다
    const repo = run([...CLASH, 'git merge clash', 'echo B > f.txt', 'git add f.txt',
      'git commit']);
    const merge = getCommit(repo, repo.refs.get('refs/heads/main') ?? '');
    expect(merge.parents.length).toBe(2);
    expect(repo.merging).toBeUndefined();
  });
});

describe('git merge --abort', () => {
  it('머지 이전 상태로 복귀한다 (untracked 보존)', () => {
    const before = run([...CLASH, 'echo note > note.txt']);
    const conflicted = execute(before, 'git merge clash').repo;
    const result = execute(conflicted, 'git merge --abort');

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual([]);
    expect(result.repo.merging).toBeUndefined();
    expect(result.repo.workingTree.get('f.txt')).toBe('B'); // HEAD 버전으로 복원
    expect(result.repo.workingTree.get('note.txt')).toBe('note'); // untracked 보존
    expect(result.repo.index.get('f.txt')?.conflicted).toBeUndefined();
    expect(computeStatus(result.repo).entries).toEqual([
      { file: 'note.txt', worktree: 'untracked' },
    ]);
  });

  it('머지 중이 아니면 MERGE_HEAD missing', () => {
    expect(execute(run(BASE), 'git merge --abort').error).toBe(
      'fatal: There is no merge to abort (MERGE_HEAD missing).',
    );
  });
});

describe('마커를 그대로 add하면 마커째 커밋된다 (실제 git과 동일한 함정)', () => {
  it('충돌 마커가 blob으로 들어간다', () => {
    const repo = run([...CLASH, 'git merge clash', 'git add f.txt', 'git commit']);
    expect(repo.workingTree.get('f.txt')).toBe(
      '<<<<<<< HEAD\nB\n=======\nA\n>>>>>>> clash',
    );
    expect(computeStatus(repo).clean).toBe(true); // 마커째 커밋 완료
  });
});
