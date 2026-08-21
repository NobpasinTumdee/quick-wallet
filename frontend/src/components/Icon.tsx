/**
 * The single place icon geometry is decided.
 *
 * Lucide's default is 24px at stroke 2, which reads heavy next to this app's
 * 13–15px type. Everything here renders on a 1.75 stroke and one of four sizes,
 * so a nav glyph, a stat label and an empty-state illustration all look like
 * they were drawn by the same hand.
 *
 * Icons inherit `currentColor`, so colour stays a CSS concern — never a prop.
 *
 * NOTE: wallet icons are deliberately NOT part of this system. `wallet.icon` is
 * a user-chosen emoji string stored in the Wallets sheet and rendered as text;
 * it is left exactly as it was.
 */

import { LucideIcon } from 'lucide-react';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<IconSize, number> = {
  sm: 15, // inline with small/muted text
  md: 18, // nav items, buttons, stat labels — the default
  lg: 22, // section headers
  xl: 28, // empty-state medallions
};

/** Lighter than Lucide's default so the strokes sit with the UI type weight. */
export const ICON_STROKE = 1.75;

export function Icon({
  icon: Glyph,
  size = 'md',
  className,
  strokeWidth = ICON_STROKE,
  label,
}: {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
  strokeWidth?: number;
  /** Omit for decorative icons — they are hidden from assistive tech. */
  label?: string;
}) {
  return (
    <Glyph
      className={className}
      size={SIZES[size]}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
