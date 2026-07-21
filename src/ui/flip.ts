/**
 * FLIP(First-Last-Invert-Play) 유틸리티.
 *
 * capture(): 명령 실행 직전, data-flip-key 요소들의 화면 위치를 기록 (First)
 * play():    리렌더 직후(useLayoutEffect), 새 위치를 재고 (Last)
 *            이전 위치와의 차이만큼 역변환에서 0으로 트랜지션 (Invert+Play),
 *            새로 등장한 요소는 팝/페이드, 값이 바뀐 셀은 펄스,
 *            deriveSlides가 정한 고스트 칩을 셀 사이로 날린다.
 *
 * 규칙: data-flip-key를 단 요소는 자기 자신에 transform 속성/스타일을 갖지 않는다
 * (SVG에서는 위치 지정용 transform이 있는 g의 "안쪽"에 키를 단다 — CSS transform이
 * 속성 transform을 덮어써 위치가 깨지는 것을 막기 위해).
 * 중첩 키 금지: 부모/자식이 함께 키를 가지면 이동이 이중 적용된다.
 */
import type { Slide } from './animations';

interface Snapshot {
  rect: DOMRect;
  val: string | null;
}

const MOVE = { duration: 320, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' };
const POP = { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.15)' };
const SLIDE = { duration: 450, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' };

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface FlipController {
  capture: () => void;
  play: (slides: Slide[]) => void;
}

export function createFlip(getRoot: () => HTMLElement | null): FlipController {
  let before = new Map<string, Snapshot>();

  const collect = (root: HTMLElement): Map<string, Element> => {
    const map = new Map<string, Element>();
    for (const el of root.querySelectorAll('[data-flip-key]')) {
      const key = el.getAttribute('data-flip-key');
      if (key !== null) map.set(key, el);
    }
    return map;
  };

  const capture = (): void => {
    before = new Map();
    const root = getRoot();
    if (root === null) return;
    for (const [key, el] of collect(root)) {
      before.set(key, {
        rect: el.getBoundingClientRect(),
        val: el.getAttribute('data-flip-val'),
      });
    }
  };

  const play = (slides: Slide[]): void => {
    const root = getRoot();
    const prev = before;
    before = new Map();
    // prev가 비어 있어도 진행한다 — 빈 저장소에서의 첫 명령도 등장 애니메이션을 받는다
    // (마운트 직후의 play는 keyed 요소가 없어 자연히 no-op)
    if (root === null || reducedMotion()) return;

    const after = collect(root);

    for (const [key, el] of after) {
      const snap = prev.get(key);

      if (snap === undefined) {
        const enter = el.getAttribute('data-flip-enter');
        if (enter === 'pop') {
          el.animate([{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'scale(1)' }], POP);
        } else if (enter === 'fade') {
          el.animate([{ opacity: 0 }, { opacity: 1 }], POP);
        }
        continue;
      }

      const now = el.getBoundingClientRect();
      const dx = snap.rect.left - now.left;
      const dy = snap.rect.top - now.top;
      if (dx !== 0 || dy !== 0) {
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          MOVE,
        );
      }

      const val = el.getAttribute('data-flip-val');
      if (snap.val !== null && val !== null && snap.val !== val) {
        el.animate(
          [
            { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
            { backgroundColor: 'transparent' },
          ],
          { duration: 700, easing: 'ease-out' },
        );
      }
    }

    for (const slide of slides) {
      const from = prev.get(slide.fromKey);
      const toEl = after.get(slide.toKey);
      if (from === undefined || toEl === undefined) continue;
      const to = toEl.getBoundingClientRect();

      const ghost = document.createElement('div');
      ghost.className = 'ghost-chip';
      ghost.textContent = slide.label;
      ghost.style.left = `${from.rect.left}px`;
      ghost.style.top = `${from.rect.top}px`;
      document.body.appendChild(ghost);
      const anim = ghost.animate(
        [
          { transform: 'translate(0, 0)', opacity: 0.95 },
          {
            transform: `translate(${to.left - from.rect.left}px, ${to.top - from.rect.top}px)`,
            opacity: 0.35,
          },
        ],
        SLIDE,
      );
      anim.onfinish = () => ghost.remove();
      anim.oncancel = () => ghost.remove();
    }
  };

  return { capture, play };
}
