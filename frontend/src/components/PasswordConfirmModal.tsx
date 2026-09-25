import { AlertTriangle } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Alert, Button, Field, Input, Modal } from './ui';
import { cx } from '../lib/format';

/**
 * "Type your password to confirm."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * It is a way of making someone stop and mean it, and of proving that the
 * person at the keyboard is the account holder rather than whoever picked the
 * phone up. It is *not* the security boundary: the server re-checks the
 * password inside the same request that deletes, so skipping this dialog by
 * calling the API directly gets you nowhere. Treating a modal as the
 * enforcement point is the mistake this component is deliberately not making.
 *
 * ---------------------------------------------------------------------------
 * HANDLING THE SECRET
 * ---------------------------------------------------------------------------
 * The value lives in component state for as long as the dialog is open and is
 * cleared on every close, on every successful submit, and whenever the dialog
 * is reopened. It is never lifted into a parent, never put in a ref that
 * outlives the dialog, never logged, and never travels as a URL parameter —
 * `useWallets.deleteWallet` puts it in the request body.
 *
 * `autoComplete="current-password"` is correct here and worth stating: this is
 * a re-authentication prompt for an existing credential, so a password manager
 * should offer to fill it. `new-password` would invite one to *save* whatever
 * is typed, which is the opposite of what is happening.
 */
export function PasswordConfirmModal({
  open,
  title,
  warning,
  confirmLabel,
  busy,
  passwordError,
  error,
  extra,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What is about to happen, in as much detail as the caller can give. */
  warning: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  /**
   * The password itself was rejected — red outline, message under the field.
   *
   * Kept apart from `error` on purpose: "that password is not right" and "this
   * wallet still has 12 transactions" are different failures, and marking the
   * field red for the second one tells the user to fix something that was
   * already correct.
   */
  passwordError?: string | null;
  /** Any other failure, shown as a message above the buttons. */
  error?: string | null;
  /** Extra controls above the field — the cascade toggle, for a wallet. */
  extra?: ReactNode;
  onConfirm: (password: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /* Cleared on both edges: reopening must never present the previous attempt,
     and nothing should linger in memory after the dialog goes away. */
  useEffect(() => {
    setPassword('');
    if (open) {
      /* A frame later — the sheet animates in, and focusing mid-transition
         scrolls the dialog in some browsers. */
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const wrong = Boolean(passwordError);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    onConfirm(password);
    /* Not cleared here: a wrong password should leave the field as it was so
       the user can correct a typo instead of retyping the whole thing. The
       close handler clears it. */
  }

  return (
    <Modal open onClose={onClose} width={440} title={title}>
      <form className="stack pw-confirm" onSubmit={submit}>
        <div className="pw-confirm-warning">
          <Icon icon={AlertTriangle} />
          <div>{warning}</div>
        </div>

        {extra}

        <Field
          label={t('confirm.password')}
          error={passwordError ?? undefined}
        >
          <Input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('confirm.passwordPlaceholder')}
            autoComplete="current-password"
            aria-invalid={wrong}
            className={cx(wrong && 'is-invalid')}
            disabled={busy}
          />
        </Field>

        {/* A failure that was not about the password — "still has 12
            transactions", a network error — belongs here as an ordinary
            message, not as a red outline on a field that was right. */}
        {error && <Alert tone="error">{error}</Alert>}

        <div className="cluster" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!password || busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
