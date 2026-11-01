import { useEffect, useState } from 'react';

/**
 * Per-device switches for the in-app number pad, and the amounts most
 * recently entered on this device. Browser storage only: both are
 * conveniences for one phone, and both must still work — falling back to
 * the defaults — when storage is blocked or throws (private windows, cleared
 * site data), hence the try/catch around every access.
 */

const PAD_KEY = 'qw.numberPad';
const RECENT_KEY = 'qw.recentAmounts';
const CHANGE_EVENT = 'qw-number-pad-change';
const RECENT_MAX = 4;
const RECENT_KEYS_MAX = 80;

/** The device setting: on unless switched off here. */
export function getNumberPadEnabled(): boolean {
  try {
    return window.localStorage.getItem(PAD_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setNumberPadEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PAD_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Not stored; still applies until the page reloads. */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: enabled }));
}

/* A phone or tablet held by touch alone. An iPad with a trackpad, or a
   touchscreen laptop, has a fine pointer too and keeps the normal input. */
const TOUCH_ONLY = '(hover: none) and (pointer: coarse)';

/** True where amount fields should open the in-app pad instead of the keyboard. */
export function useNumberPadMode(): boolean {
  const [enabled, setEnabled] = useState(getNumberPadEnabled);
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(TOUCH_ONLY).matches === true);

  useEffect(() => {
    const onChange = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    const query = window.matchMedia?.(TOUCH_ONLY);
    const onQuery = () => setTouch(query?.matches === true);
    query?.addEventListener?.('change', onQuery);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      query?.removeEventListener?.('change', onQuery);
    };
  }, []);

  return enabled && touch;
}

/** The setting itself, for the Settings switch. */
export function useNumberPadSetting(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(getNumberPadEnabled);
  useEffect(() => {
    const onChange = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [enabled, setNumberPadEnabled];
}

/* ---- Recent amounts ----
   Keyed by what the amount was for — "expense:Food", or a transfer's
   "transfer:<from>><to>" — so the chips offer the coffee price for coffee,
   not for rent. Newest first, no repeats, four at most. */

export function recentKey(
  type: 'expense' | 'income' | 'transfer',
  detail: { category?: string; walletId?: string; toWalletId?: string },
): string | null {
  if (type === 'transfer') {
    return detail.walletId && detail.toWalletId ? `transfer:${detail.walletId}>${detail.toWalletId}` : null;
  }
  return detail.category ? `${type}:${detail.category}` : null;
}

function readRecents(): Record<string, number[]> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

export function getRecentAmounts(key: string | null): number[] {
  if (!key) return [];
  const list = readRecents()[key];
  return Array.isArray(list) ? list.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0).slice(0, RECENT_MAX) : [];
}

export function rememberAmount(key: string | null, amount: number): void {
  if (!key || !(amount > 0)) return;
  try {
    const all = readRecents();
    const next = [amount, ...(all[key] ?? []).filter((n) => n !== amount)].slice(0, RECENT_MAX);
    delete all[key];
    /* Most recently used key last, so trimming drops the stalest. */
    const entries = [...Object.entries(all), [key, next] as [string, number[]]].slice(-RECENT_KEYS_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Storage blocked: no chips next time, nothing else lost. */
  }
}
