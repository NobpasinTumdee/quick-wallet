import { FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normaliseUrl } from '../../lib/markdownEdit';
import { Button, Field, Input, Modal } from '../ui';

/**
 * Link text and an address. The text is optional — without it the address
 * itself goes in, which the reading view shortens — and the address is
 * checked here, so a note never gains a `javascript:` or `data:` link from
 * this dialog. A missing scheme gets `https://`.
 */
export function LinkDialog({
  open,
  initialText,
  onInsert,
  onClose,
}: {
  open: boolean;
  initialText: string;
  onInsert: (label: string, url: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(initialText);
    setUrl('');
    setError(false);
  }, [open, initialText]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normaliseUrl(url);
    if (!clean) {
      setError(true);
      return;
    }
    onInsert(label, clean);
  }

  return (
    <Modal
      open={open}
      title={t('notes.linkTitle')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId}>
            {t('notes.linkInsert')}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label={t('notes.linkText')} hint={t('notes.linkTextHint')}>
          <Input
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            enterKeyHint="next"
            data-autofocus={initialText ? undefined : ''}
          />
        </Field>
        <Field label={t('notes.linkUrl')} error={error ? t('notes.linkInvalid') : undefined}>
          <Input
            value={url}
            inputMode="url"
            type="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://example.com"
            aria-invalid={error || undefined}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(false);
            }}
            enterKeyHint="done"
            /* With the text already filled from the selection, start at the address. */
            data-autofocus={initialText ? '' : undefined}
          />
        </Field>
      </form>
    </Modal>
  );
}
