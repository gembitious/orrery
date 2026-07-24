/**
 * `git add` — working tree의 내용으로 blob을 만들어 object store에 넣고
 * index를 그 blob으로 갱신한다.
 *
 * git의 content-addressed 저장이 처음 드러나는 곳: 내용이 같으면 파일이 달라도
 * blob은 하나다. 또한 add는 "그 시점의 스냅샷"을 뜬다 — add 후 파일을 또 고치면
 * index는 여전히 이전 스냅샷을 가리킨다(1.5 status에서 staged+modified로 보인다).
 */
import { hashObject } from '../objects';
import type { Repository } from '../repository';
import { stagedSha } from '../repository';
import type { CommandResult } from '../result';
import { emptyDiff, failure, success } from '../result';

export function gitAdd(repo: Repository, pathspecs: string[]): CommandResult {
  // '.'은 working tree의 모든 파일 + index에만 남은 파일(삭제 staging)로 확장
  const names: string[] = [];
  const seen = new Set<string>();
  for (const spec of pathspecs) {
    const expanded =
      spec === '.' ? [...new Set([...repo.workingTree.keys(), ...repo.index.keys()])] : [spec];
    for (const name of expanded) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  // 실제 git처럼 매칭 실패는 fatal — 아무것도 stage하지 않고 통째로 실패한다
  for (const name of names) {
    if (!repo.workingTree.has(name) && !repo.index.has(name)) {
      return failure(repo, `fatal: pathspec '${name}' did not match any files`);
    }
  }

  const objects = new Map(repo.objects);
  const index = new Map(repo.index);
  const diff = emptyDiff();

  for (const name of names) {
    const content = repo.workingTree.get(name);

    if (content === undefined) {
      // working tree에서 지워졌지만 index에는 있는 파일: 삭제를 stage한다
      index.delete(name);
      diff.indexChanges.push({ file: name, kind: 'unstaged' });
      continue;
    }

    const blob = { type: 'blob', content } as const;
    const sha = hashObject(blob);
    if (!objects.has(sha)) {
      objects.set(sha, blob);
      diff.createdObjects.push(sha);
    }

    const prev = index.get(name);
    if (stagedSha(prev) === sha) continue; // 이미 같은 스냅샷이 staged — no-op
    // 충돌(unmerged) 엔트리였다면 이 대입이 곧 "해소 표시"다 — stage 1/2/3이
    // stage 0 하나로 접힌다 (실제 git add의 충돌 해소와 동일)
    index.set(name, { name, sha });
    diff.indexChanges.push({ file: name, kind: prev === undefined ? 'staged' : 'modified' });
  }

  // 실제 git add는 성공 시 아무것도 출력하지 않는다
  return success({ ...repo, objects, index }, [], diff);
}
