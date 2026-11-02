import { RefObject, useEffect, useLayoutEffect, useState } from 'react';

import { useMediaQuery } from '../hooks/useMediaQuery';

/**
 * The per-device choice between the classic phone layout and the new one.
 *
 * Kept in browser storage, like the number pad's switch: it is how this one
 * phone looks, not part of the account, and it must still work — falling back
 * to the default — when storage is blocked or throws.
 *
 * The new layout is CSS scoped under `:root.ui-mobile-v2` inside the phone
 * breakpoint, so the class alone changes nothing on a wider screen. The few
 * components whose markup differs ask `useMobileV2()`, which is only true on a
 * phone with the new layout chosen — so desktop and Classic render exactly the
 * DOM they always have.
 */

export type MobileLayout = 'classic' | 'new';

const KEY = 'qw.mobileLayout';
const CHANGE_EVENT = 'qw-mobile-layout-change';
/** For a device with no saved choice. A saved choice — either one — always
 *  wins (see getMobileLayout), and nothing here writes one on its own. */
const DEFAULT_LAYOUT: MobileLayout = 'new';
export const ROOT_CLASS = 'ui-mobile-v2';
/** The app's phone breakpoint: the overlay stack and the sheets use it too. */
export const MOBILE_QUERY = '(max-width: 767px)';

export function getMobileLayout(): MobileLayout {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === 'new' || stored === 'classic' ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function setMobileLayout(layout: MobileLayout): void {
  try {
    window.localStorage.setItem(KEY, layout);
  } catch {
    /* Not stored; still applies until the page reloads. */
  }
  applyRootClass(layout);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: layout }));
}

function applyRootClass(layout: MobileLayout): void {
  document.documentElement.classList.toggle(ROOT_CLASS, layout === 'new');
}

/** The setting, kept in step across every component that reads it. */
export function useMobileLayout(): [MobileLayout, (layout: MobileLayout) => void] {
  const [layout, setLayout] = useState(getMobileLayout);
  useEffect(() => {
    const onChange = (event: Event) => setLayout((event as CustomEvent<MobileLayout>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [layout, setMobileLayout];
}

/** Puts the root class on `<html>` from the stored choice. Mounted once. */
export function useMobileLayoutRootClass(): void {
  const [layout] = useMobileLayout();
  /* Before paint, so a phone set to New never flashes the classic layout. */
  useLayoutEffect(() => applyRootClass(layout), [layout]);
}

/** True only on a phone with the new layout chosen. */
export function useMobileV2(): boolean {
  const [layout] = useMobileLayout();
  const mobile = useMediaQuery(MOBILE_QUERY);
  return layout === 'new' && mobile;
}

/**
 * Publishes the top bar's live height as `--m2-topbar-h` on <html>, so the
 * new layout's sticky date headers stop just under it rather than sliding
 * beneath. Its height changes with the safe area, the month pill's line and
 * text size, so it is measured, not assumed. Only while `enabled`; the
 * property is removed again otherwise, leaving Classic and desktop untouched.
 */
export function useTopbarHeightVar(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const root = document.documentElement;
    if (!enabled || !element) return;
    const apply = () => root.style.setProperty('--m2-topbar-h', `${element.getBoundingClientRect().height}px`);
    apply();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--m2-topbar-h');
    };
  }, [ref, enabled]);
}
