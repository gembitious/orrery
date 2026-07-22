/**
 * 가상 FS 명령 — git 외에 허용하는 유일한 예외 2개.
 * working tree만 만지고 index/objects/refs에는 손대지 않는다 (실제 셸과 동일).
 */
import type { Repository } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success } from '../result';

/** flat FS 불변식: '/' 금지, '.'/'..' 금지 */
export function validateFileName(name: string): string | undefined {
  if (name.length === 0) return 'orrery: 파일명이 비어 있습니다';
  if (name.includes('/')) return `orrery: 파일명에 '/'를 쓸 수 없습니다 (flat FS): '${name}'`;
  if (name === '.' || name === '..') return `orrery: '${name}'은(는) 파일명으로 쓸 수 없습니다`;
  return undefined;
}

/** `echo "content" > file.txt` — 파일 생성/덮어쓰기 */
export function writeFile(repo: Repository, name: string, content: string): CommandResult {
  const invalid = validateFileName(name);
  if (invalid !== undefined) return failure(repo, invalid);

  const existed = repo.workingTree.has(name);
  const workingTree = new Map(repo.workingTree);
  workingTree.set(name, content);

  const diff = emptyDiff();
  diff.workingTreeChanges.push({ file: name, kind: existed ? 'modified' : 'created' });
  return success({ ...repo, workingTree }, [], diff);
}

/** `rm file.txt` — working tree에서 파일 삭제 (index는 건드리지 않는다) */
export function removeFile(repo: Repository, name: string): CommandResult {
  if (!repo.workingTree.has(name)) {
    return failure(repo, `rm: cannot remove '${name}': No such file or directory`);
  }
  const workingTree = new Map(repo.workingTree);
  workingTree.delete(name);

  const diff = emptyDiff();
  diff.workingTreeChanges.push({ file: name, kind: 'deleted' });
  return success({ ...repo, workingTree }, [], diff);
}
