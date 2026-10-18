/**
 * Dev-only: "does anything on this screen make the page scroll sideways?"
 *
 * In the browser console:
 *   qwOverflow()          check the current width
 *   await qwOverflowAll() check 320 → 1920 inside an iframe of this page
 *
 * A page passes when `document.documentElement.scrollWidth <= innerWidth`.
 * When it fails, the culprits are listed: every element whose right edge is
 * past the viewport and whose parent's is not, which is the element that
 * actually broke out rather than everything that contains it.
 *
 * `qwOverflowAll` loads the current URL into an off-screen iframe at each
 * width, so the real window is never resized. The iframe shares the session
 * token in localStorage, so it renders the same signed-in screen; give each
 * width a moment for data from the cache to land.
 */

export const OVERFLOW_WIDTHS = [320, 375, 414, 768, 1024, 1280, 1440, 1920] as const;

export interface OverflowReport {
  width: number;
  scrollWidth: number;
  ok: boolean;
  /** CSS-ish paths of the elements that stick out, worst first. */
  offenders: { path: string; right: number }[];
}

function describe(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  for (let depth = 0; node && depth < 4; depth += 1) {
    const classes = [...node.classList].slice(0, 2).map((name) => `.${name}`).join('');
    parts.unshift(`${node.tagName.toLowerCase()}${classes}`);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

export function checkOverflow(doc: Document = document): OverflowReport {
  const view = doc.defaultView ?? window;
  const width = view.innerWidth;
  const scrollWidth = doc.documentElement.scrollWidth;
  const offenders: OverflowReport['offenders'] = [];

  if (scrollWidth > width) {
    for (const element of doc.body.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right;
      if (right <= width + 0.5) continue;
      const parent = element.parentElement;
      if (parent && parent.getBoundingClientRect().right > width + 0.5) continue;
      offenders.push({ path: describe(element), right: Math.round(right) });
    }
    offenders.sort((a, b) => b.right - a.right);
  }

  return { width, scrollWidth, ok: scrollWidth <= width, offenders: offenders.slice(0, 15) };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function checkOverflowAtWidths(
  widths: readonly number[] = OVERFLOW_WIDTHS,
  settleMs = 2500,
): Promise<OverflowReport[]> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;height:900px;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const reports: OverflowReport[] = [];
  try {
    for (const width of widths) {
      frame.style.width = `${width}px`;
      frame.src = window.location.href;
      await new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
      await wait(settleMs);
      const doc = frame.contentDocument;
      if (doc) reports.push(checkOverflow(doc));
    }
  } finally {
    frame.remove();
  }
  console.table(reports.map(({ width, scrollWidth, ok, offenders }) => ({
    width,
    scrollWidth,
    ok,
    worst: offenders[0]?.path ?? '',
  })));
  return reports;
}

export function installOverflowCheck(): void {
  const target = window as unknown as Record<string, unknown>;
  target.qwOverflow = () => {
    const report = checkOverflow();
    console.log(report.ok ? `✓ no horizontal overflow at ${report.width}px` : `✗ overflow at ${report.width}px`, report);
    return report;
  };
  target.qwOverflowAll = checkOverflowAtWidths;
}
