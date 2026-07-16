/**
 * 명령 히스토리 탐색 (순수 함수 — React 무관).
 * 셸 관례를 따른다: ↑는 과거로, ↓는 미래로, 끝을 지나면 입력 중이던
 * 초안(draft)이 복원된다. 연속 중복 명령은 한 번만 쌓인다.
 */

export interface HistoryNav {
  /** history 안에서의 위치. null이면 탐색 중이 아님(새 입력 중) */
  cursor: number | null;
  /** 탐색을 시작할 때 입력 중이던 내용 — ↓로 끝을 지나면 복원된다 */
  draft: string;
}

export const idleNav: HistoryNav = { cursor: null, draft: '' };

/** 제출된 명령을 히스토리에 쌓는다. 직전 명령과 같으면 중복 저장하지 않는다 */
export function pushHistory(items: string[], command: string): string[] {
  return items[items.length - 1] === command ? items : [...items, command];
}

export function navigateHistory(
  items: string[],
  nav: HistoryNav,
  direction: 'up' | 'down',
  current: string,
): { nav: HistoryNav; value: string } {
  if (direction === 'up') {
    if (items.length === 0) return { nav, value: current };
    if (nav.cursor === null) {
      // 탐색 시작 — 지금 치고 있던 내용을 보관
      return { nav: { cursor: items.length - 1, draft: current }, value: items[items.length - 1] };
    }
    const cursor = Math.max(0, nav.cursor - 1);
    return { nav: { ...nav, cursor }, value: items[cursor] };
  }

  // down
  if (nav.cursor === null) return { nav, value: current };
  if (nav.cursor >= items.length - 1) {
    return { nav: { cursor: null, draft: '' }, value: nav.draft };
  }
  const cursor = nav.cursor + 1;
  return { nav: { ...nav, cursor }, value: items[cursor] };
}
