import { MotionMode } from './motion';

/**
 * The one page entry, on <main>.
 *
 * Full: the page fades in and rises 8px over 180ms, and its first six cards
 * fade in 30ms apart, so the whole entry is over by 330ms. Reduced: the page
 * fades for 120ms, nothing rises or staggers. Off: nothing.
 *
 * Driven by attributes rather than classes so a React re-render of the same
 * element mid-entry cannot strip or keep them, and every animation uses
 * fill-mode `backwards` only: before it starts an element holds the first
 * frame, and once it ends nothing is left on it — no transform stays on the
 * page, so sticky headers inside it stick as before. The attributes are
 * removed when the entry is over anyway.
 *
 * Content is in the DOM and laid out from the first frame; only its opacity
 * and offset are animated, and nothing waits for the entry, so it never
 * delays data or input.
 */

const ITEMS = 6;
/* Longer than the longest entry (5 × 30ms delay + 180ms), with margin. */
const CLEANUP_MS = 400;

/** Containers whose children are the cards (Home's and Analytics' boards, card grids). */
const GRIDS = '.bento, .wallet-grid, .goal-grid, .split-grid, .debt-list';

let cleanup: (() => void) | null = null;

function visible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.height > 0 && box.width > 0 && box.top < window.innerHeight;
}

/** Up to six elements to stagger, in reading order: the page's sections, or the cards inside a grid. */
function pickItems(root: Element): HTMLElement[] {
  const items: HTMLElement[] = [];
  const visit = (parent: Element, depth: number) => {
    for (const child of Array.from(parent.children)) {
      if (items.length >= ITEMS) return;
      if (!(child instanceof HTMLElement) || child.classList.contains('sk-card') || !visible(child)) continue;
      if (depth < 3 && (child.matches(GRIDS) || child.querySelector(`:scope > ${GRIDS.split(', ').join(', :scope > ')}`))) {
        visit(child, depth + 1);
        continue;
      }
      items.push(child);
    }
  };
  visit(root, 0);
  return items;
}

/** Stops an entry in progress and removes what it set. */
export function cancelPageEntry(): void {
  cleanup?.();
  cleanup = null;
}

export function playPageEntry(main: HTMLElement | null, mode: MotionMode): void {
  cancelPageEntry();
  if (!main || mode === 'off') return;
  /* Only a skeleton so far: it keeps its own 150ms no-flash delay instead. */
  const content = Array.from(main.children).filter((child) => !child.classList.contains('sk-card'));
  if (!content.length) return;

  /* The page container itself rises (Full) or fades (Reduced); its first six
     cards, wherever they sit in the page, fade in 30ms apart (Full only). */
  const touched: HTMLElement[] = [main];
  main.setAttribute('data-enter', mode === 'full' ? 'rise' : 'fade');
  if (mode === 'full') {
    pickItems(main).forEach((item, index) => {
      item.setAttribute('data-enter-i', String(index));
      touched.push(item);
    });
  }

  const timer = window.setTimeout(() => cancelPageEntry(), CLEANUP_MS);
  cleanup = () => {
    window.clearTimeout(timer);
    for (const element of touched) {
      element.removeAttribute('data-enter');
      element.removeAttribute('data-enter-i');
    }
  };
}
