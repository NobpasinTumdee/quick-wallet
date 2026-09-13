import { useCallback, useEffect, useState } from 'react';

/**
 * A boolean preference that survives a reload.
 *
 * The initial value is read **synchronously in the state initializer**, not in
 * an effect. That matters: an effect would run after the first paint, so the
 * sidebar would render expanded and then snap shut — which is the same flash
 * this app just spent effort removing from the theme.
 *
 * Every storage access is guarded. `localStorage` throws outright when a
 * browser is set to block site data, and a preference is never worth taking the
 * app down for; the fallback simply applies for that session.
 */
export function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === 'true';
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Quota, private mode, or blocked storage. It just will not persist. */
    }
  }, [key, value]);

  const toggle = useCallback(() => setValue((current) => !current), []);

  return [value, setValue, toggle];
}

/**
 * A whole-number preference that survives a reload, or `null` for "unset".
 *
 * Same synchronous-read discipline as above, and the same reason. `null` is a
 * real value here rather than an absence: a payday of "none" is a choice the
 * user can make, and it has to be distinguishable from never having chosen.
 */
export function useStoredNumber(
  key: string,
  fallback: number | null,
  { min, max }: { min: number; max: number },
): [number | null, (next: number | null) => void] {
  const clamp = useCallback(
    (value: number | null): number | null => {
      if (value === null || !Number.isFinite(value)) return null;
      const rounded = Math.round(value);
      return rounded < min || rounded > max ? null : rounded;
    },
    [min, max],
  );

  const [value, setValue] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return clamp(fallback);
      if (raw === '') return null;
      return clamp(Number(raw));
    } catch {
      return clamp(fallback);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value === null ? '' : String(value));
    } catch {
      /* Quota, private mode, or blocked storage. It just will not persist. */
    }
  }, [key, value]);

  const set = useCallback((next: number | null) => setValue(clamp(next)), [clamp]);

  return [value, set];
}
