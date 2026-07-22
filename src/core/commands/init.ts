/**
 * `git init` — 저장소 초기화.
 *
 * 실제 git처럼 init 직후의 HEAD는 refs/heads/main을 가리키지만
 * refs/heads/main 자체는 아직 존재하지 않는다("unborn branch").
 * 첫 커밋이 만들어질 때 비로소 ref가 생긴다.
 */
import type { Repository } from '../repository';
import type { CommandResult } from '../result';
import { success } from '../result';

// SIMPLIFIED: 실제 경로가 없으므로 표시용 가상 경로를 쓴다. config/hooks 디렉터리 생성 생략.
const GIT_DIR = '/repo/.git/';

export function gitInit(repo: Repository): CommandResult {
  if (repo.initialized) {
    // 실제 git도 재초기화는 에러가 아니라 메시지만 낸다. 상태는 건드리지 않는다.
    return success(repo, [`Reinitialized existing Git repository in ${GIT_DIR}`]);
  }
  const next: Repository = {
    ...repo,
    initialized: true,
    head: { kind: 'symbolic', ref: 'refs/heads/main' },
  };
  return success(next, [`Initialized empty Git repository in ${GIT_DIR}`]);
}
