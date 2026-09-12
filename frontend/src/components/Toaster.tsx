import { dismissToast, useToasts } from '../lib/toast';
import { cx } from '../lib/format';

const ICONS = {
  error: '✕',
  warning: '!',
  success: '✓',
  info: 'i',
} as const;

/**
 * Toast stack. Mounted once at the app root.
 *
 * This is where optimistic writes surface their failures: the row is already
 * back to its old value by the time the toast appears, so the message explains
 * a rollback the user may otherwise not have noticed.
 */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;

  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cx('toast', `toast--${item.tone}`)}
          role={item.tone === 'error' || item.tone === 'warning' ? 'alert' : 'status'}
        >
          <span className={cx('toast-icon', `toast-icon--${item.tone}`)} aria-hidden="true">
            {ICONS[item.tone]}
          </span>
          <div className="toast-body">
            {item.title && <strong>{item.title}</strong>}
            <span>{item.message}</span>
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(item.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
