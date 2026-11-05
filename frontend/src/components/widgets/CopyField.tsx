import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { toast } from '../../lib/toast';
import { Icon } from '../Icon';

/** Copies text, falling back to a hidden textarea where the API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Fall through to the textarea route. */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A labelled, read-only value with a copy button: a URL, a formula, a token. */
export function CopyField({
  label,
  value,
  multiline = false,
  secret = false,
}: {
  label?: string;
  value: string;
  multiline?: boolean;
  /** Marks the box as sensitive (the one-time token). */
  secret?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    if (await copyText(value)) {
      setCopied(true);
      toast.success(t('widgets.copied'));
    } else {
      toast.error(t('widgets.copyFailed'));
    }
  }

  return (
    <div className={cx('copy-field', secret && 'copy-field--secret')}>
      {label && <span className="copy-field-label">{label}</span>}
      <div className="copy-field-row">
        <code className={cx('copy-field-value', multiline && 'is-multiline')}>{value}</code>
        <button
          type="button"
          className="copy-field-btn"
          onClick={() => void onCopy()}
          aria-label={label ? t('widgets.copyThing', { thing: label }) : t('widgets.copy')}
        >
          <Icon icon={copied ? Check : Copy} size="sm" />
        </button>
      </div>
    </div>
  );
}
