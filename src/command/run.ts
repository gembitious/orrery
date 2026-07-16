/**
 * 명령 시퀀스를 순서대로 실행해 최종 Repository를 반환한다.
 * 테스트의 기본 도구이자, Phase 5의 상태 공유(URL 히스토리 리플레이)에서도 재사용한다.
 * 결정론적 해시 덕분에 같은 시퀀스는 언제나 같은 상태를 만든다.
 */
import type { Repository } from '../core/repository';
import { createRepository } from '../core/repository';
import { execute } from './execute';

export function run(inputs: string[], base?: Repository): Repository {
  let repo = base ?? createRepository();
  for (const input of inputs) {
    const result = execute(repo, input);
    if (result.error !== undefined) {
      throw new Error(`run: '${input}' 실패 — ${result.error}`);
    }
    repo = result.repo;
  }
  return repo;
}
