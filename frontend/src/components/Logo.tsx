import { cx } from '../lib/format';

/**
 * The app mark. Files live in `frontend/public/`, so they're referenced by URL
 * rather than imported — Vite serves them as-is and they stay out of the bundle.
 *
 * The mark is transparent, so it sits on any theme without a plate behind it —
 * and `.logo`'s drop-shadow traces the mascot's own silhouette rather than the
 * edge of a badge.
 *
 * The one asset that is *not* transparent is `apple-touch-icon.png`: iOS
 * ignores alpha on a home-screen icon and flattens it onto black, so that size
 * ships pre-composited onto white.
 */
export function Logo({
  size = 28,
  className,
  /** Decorative next to a visible wordmark; give it a label when it stands alone. */
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <img
      // 128px asset covers the small marks at 2x DPI; the 512 is for large ones.
      src={size > 64 ? '/logo.png' : '/logo-128.png'}
      width={size}
      height={size}
      className={cx('logo', className)}
      style={{ width: size, height: size }}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
    />
  );
}
