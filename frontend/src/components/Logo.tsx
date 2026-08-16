import { cx } from '../lib/format';

/**
 * The app mark. Files live in `frontend/public/`, so they're referenced by URL
 * rather than imported — Vite serves them as-is and they stay out of the bundle.
 *
 * The transparent PNG is used everywhere in the UI so it sits correctly on any
 * theme; the white-background original is reserved for iOS home-screen icons.
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
