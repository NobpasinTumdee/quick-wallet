import { useEffect, useState } from 'react';

/**
 * How much the interface moves: one setting, per device.
 *
 *   full     every animation and transition
 *   reduced  short fades only — no slides, no stagger, no scale, still skeletons
 *   off      nothing animates; changes are instant
 *
 * The mode lives on <html data-motion>, set by the boot script in index.html
 * before first paint, so CSS can key every rule off it. Nothing saved means
 * "follow the device": reduced when the OS asks for less motion, full
 * otherwise — and it keeps following if the OS setting changes. JavaScript
 * animations (the chart's entry, Customize's glide, smooth scrolling) read the
 * same attribute through useMotion / motionMode.
 */

export type MotionMode = 'full' | 'reduced' | 'off';

/* Must match the boot script in index.html. */
export const MOTION_KEY = 'qw.motion';
const CHANGE_EVENT = 'qw-motion-change';
const OS_QUERY = '(prefers-reduced-motion: reduce)';

function isMode(value: unknown): value is MotionMode {
  return value === 'full' || value === 'reduced' || value === 'off';
}

/** The saved choice, or null when this device follows its OS setting. */
export function storedMotion(): MotionMode | null {
  try {
    const value = window.localStorage.getItem(MOTION_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** What the OS asks for. */
export function deviceMotion(): MotionMode {
  return typeof window.matchMedia === 'function' && window.matchMedia(OS_QUERY).matches ? 'reduced' : 'full';
}

/** The mode in force now. */
export function motionMode(): MotionMode {
  const value = document.documentElement.getAttribute('data-motion');
  return isMode(value) ? value : deviceMotion();
}

function apply(): void {
  const mode = storedMotion() ?? deviceMotion();
  if (document.documentElement.getAttribute('data-motion') !== mode) {
    document.documentElement.setAttribute('data-motion', mode);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
}

/** Saves a choice for this device; null goes back to following the OS. */
export function setMotionPreference(mode: MotionMode | null): void {
  try {
    if (mode) window.localStorage.setItem(MOTION_KEY, mode);
    else window.localStorage.removeItem(MOTION_KEY);
  } catch {
    /* Not stored; still applies until the page reloads. */
  }
  apply();
}

let started = false;

/** Once, at start-up: sets the attribute (if the boot script could not) and follows the OS while nothing is saved. */
export function initMotion(): void {
  if (started) return;
  started = true;
  apply();
  if (typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia(OS_QUERY);
  const onChange = () => {
    if (storedMotion() === null) apply();
  };
  query.addEventListener?.('change', onChange);
  /* Another tab changed the choice. */
  window.addEventListener('storage', (event) => {
    if (event.key === MOTION_KEY) apply();
  });
}

/** The mode in force, re-rendering when it changes. */
export function useMotion(): MotionMode {
  const [mode, setMode] = useState<MotionMode>(motionMode);
  useEffect(() => {
    const onChange = () => setMode(motionMode());
    window.addEventListener(CHANGE_EVENT, onChange);
    onChange();
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return mode;
}

/** The saved choice (null = follows the device), re-rendering when it changes. */
export function useMotionPreference(): [MotionMode | null, (mode: MotionMode | null) => void] {
  const [stored, setStored] = useState<MotionMode | null>(storedMotion);
  useEffect(() => {
    const onChange = () => setStored(storedMotion());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [stored, setMotionPreference];
}

/** Smooth scrolling is a slide: Full only. */
export function scrollBehavior(): ScrollBehavior {
  return motionMode() === 'full' ? 'smooth' : 'auto';
}

export function scrollIntoViewMotion(element: Element | null | undefined, options: ScrollIntoViewOptions = {}): void {
  element?.scrollIntoView({ ...options, behavior: scrollBehavior() });
}

/* ---- Customize ----
   While the layout editor is open nothing makes an entrance: cards are being
   moved, and a chart growing or a card fading in under the pointer reads as
   the layout changing. Set by AppShell; CSS keys off the same attribute. */

export function setCustomizing(on: boolean): void {
  const root = document.documentElement;
  if (root.hasAttribute('data-customizing') === on) return;
  root.toggleAttribute('data-customizing', on);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function isCustomizing(): boolean {
  return document.documentElement.hasAttribute('data-customizing');
}

/** Whether an entrance (a chart growing in, a card arriving) may play now: Full motion, Customize closed. */
export function useEntranceMotion(): boolean {
  const mode = useMotion();
  const [customizing, setState] = useState(isCustomizing);
  useEffect(() => {
    const onChange = () => setState(isCustomizing());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return mode === 'full' && !customizing;
}

/* ---- Tokens for JS animations ----
   The same values CSS uses (theme.css), so a JS animation keeps step with
   the stylesheet: a duration in ms and an easing string for element.animate. */

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function motionDuration(name: string, fallback: number): number {
  const value = token(name);
  const ms = value.endsWith('ms') ? parseFloat(value) : value.endsWith('s') ? parseFloat(value) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : fallback;
}

export function motionEasing(name: string, fallback: string): string {
  return token(name) || fallback;
}
