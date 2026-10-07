import { AlertTriangle } from 'lucide-react';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button, Modal } from './ui';
import { TranslationKey } from '../locales';

/**
 * "Are you sure?" — in the app's own voice.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `window.confirm`
 * ---------------------------------------------------------------------------
 * Four reasons, and only the first is cosmetic.
 *
 *   It is the browser's chrome, not ours. A system alert in the middle of a
 *   glass interface announces that the app stopped and something else took
 *   over.
 *
 *   It blocks the main thread. Nothing renders, no timer fires and no pending
 *   write settles while it is open — including the optimistic rollback that
 *   would tell you the last action failed.
 *
 *   It cannot say which button is dangerous. Both are grey, both are the
 *   browser's words, and "OK" is the one muscle memory presses.
 *
 *   And it cannot be driven by anything but a human hand, which means no test
 *   and no automation can ever walk a destructive path.
 *
 * ---------------------------------------------------------------------------
 * THE SAFE ACTION IS THE DEFAULT
 * ---------------------------------------------------------------------------
 * Cancel comes first in the DOM, so it is what a keyboard reaches first and
 * what Escape does. The destructive button wears the danger variant and says
 * what it will destroy — "Delete goal", never "OK" — because the label is the
 * last chance to notice you are on the wrong row.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onClose,
  tone = 'danger',
}: {
  open: boolean;
  title: ReactNode;
  /** What will actually happen. Plain language, including the consequence. */
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** `danger` for anything irreversible; `primary` for a merely weighty yes. */
  tone?: 'danger' | 'primary';
}) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          {/* First, and therefore the default focus target. */}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <span className={`confirm-mark is-${tone}`} aria-hidden="true">
          <Icon icon={AlertTriangle} />
        </span>
        <p className="confirm-text">{body}</p>
      </div>
    </Modal>
  );
}

/**
 * The state one of these needs, so a page does not hand-roll it each time.
 *
 * A page holds the *subject* of the confirmation — the goal, the bill — rather
 * than a boolean, because the dialog has to name what it is about to delete
 * and a boolean cannot tell it which row.
 */
export interface ConfirmCopy {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  confirmKey: TranslationKey;
}
