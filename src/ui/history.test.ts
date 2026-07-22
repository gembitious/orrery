import { describe, expect, it } from 'vitest';
import { idleNav, navigateHistory, pushHistory } from './history';

describe('pushHistory', () => {
  it('명령을 쌓는다', () => {
    expect(pushHistory([], 'git init')).toEqual(['git init']);
    expect(pushHistory(['git init'], 'git status')).toEqual(['git init', 'git status']);
  });

  it('연속 중복은 한 번만', () => {
    expect(pushHistory(['git status'], 'git status')).toEqual(['git status']);
    // 연속이 아니면 중복이어도 쌓인다
    expect(pushHistory(['git status', 'git log'], 'git status')).toEqual([
      'git status', 'git log', 'git status',
    ]);
  });
});

describe('navigateHistory', () => {
  const items = ['git init', 'git add .', 'git status'];

  it('↑: 최근 명령부터 거슬러 올라간다', () => {
    const step1 = navigateHistory(items, idleNav, 'up', '');
    expect(step1.value).toBe('git status');
    const step2 = navigateHistory(items, step1.nav, 'up', step1.value);
    expect(step2.value).toBe('git add .');
    const step3 = navigateHistory(items, step2.nav, 'up', step2.value);
    expect(step3.value).toBe('git init');
    // 맨 처음에서 더 올라가면 그대로
    const step4 = navigateHistory(items, step3.nav, 'up', step3.value);
    expect(step4.value).toBe('git init');
  });

  it('↑ 탐색 시작 시 입력 중이던 초안을 보관하고, ↓로 끝을 지나면 복원한다', () => {
    const up = navigateHistory(items, idleNav, 'up', 'git bra'); // 치다 만 명령
    expect(up.value).toBe('git status');
    const down = navigateHistory(items, up.nav, 'down', up.value);
    expect(down.value).toBe('git bra'); // 초안 복원
    expect(down.nav.cursor).toBeNull();
  });

  it('↓: 미래 방향으로 내려간다', () => {
    const s1 = navigateHistory(items, idleNav, 'up', '');
    const s2 = navigateHistory(items, s1.nav, 'up', s1.value);
    const s3 = navigateHistory(items, s2.nav, 'down', s2.value);
    expect(s3.value).toBe('git status');
  });

  it('빈 히스토리에서 ↑는 아무 일도 없다', () => {
    const result = navigateHistory([], idleNav, 'up', 'draft');
    expect(result.value).toBe('draft');
    expect(result.nav.cursor).toBeNull();
  });

  it('탐색 중이 아닐 때 ↓는 아무 일도 없다', () => {
    const result = navigateHistory(items, idleNav, 'down', 'draft');
    expect(result.value).toBe('draft');
  });
});
