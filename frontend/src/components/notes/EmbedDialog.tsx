import { Globe, Image as ImageIcon, SquarePlay } from 'lucide-react';
import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Embed,
  classifyEmbed,
  embedMarkdown,
  faviconUrl,
  shortenUrl,
  youTubeThumbnail,
} from '../../lib/embeds';
import { normaliseUrl } from '../../lib/markdownEdit';
import { Icon } from '../Icon';
import { Button, Field, Input, Modal } from '../ui';

/** The URL as typed, if it is one an embed may use: http or https only. */
function readEmbed(raw: string): Embed | null {
  const url = normaliseUrl(raw);
  if (!url || !/^https?:/i.test(url)) return null;
  return classifyEmbed(url);
}

/**
 * One address in, the right Markdown out. The type is worked out as the
 * address is typed or pasted and shown with a small preview, so what goes
 * into the note is never a surprise.
 */
export function EmbedDialog({
  open,
  onInsert,
  onClose,
}: {
  open: boolean;
  onInsert: (markdown: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setCaption('');
    setError(false);
  }, [open]);

  const embed = useMemo(() => (url.trim() ? readEmbed(url) : null), [url]);
  /* An http picture is shown as a link card: say why, rather than surprise. */
  const httpPicture = embed?.kind === 'website' && /^http:/i.test(embed.url) && /\.(png|jpe?g|gif|webp|avif)$/i.test(new URL(embed.url).pathname);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!embed) {
      setError(true);
      return;
    }
    onInsert(embedMarkdown(embed.url, embed.kind === 'image' ? caption : ''));
  }

  return (
    <Modal
      open={open}
      title={t('notes.embedTitle')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId}>
            {t('notes.embedInsert')}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field
          label={t('notes.embedUrl')}
          hint={t('notes.embedUrlHint')}
          error={error && !embed ? t('notes.embedInvalid') : undefined}
        >
          <Input
            value={url}
            inputMode="url"
            type="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            aria-invalid={(error && !embed) || undefined}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(false);
            }}
            enterKeyHint="done"
            data-autofocus=""
          />
        </Field>

        {embed && <EmbedPreview key={embed.url} embed={embed} />}
        {httpPicture && <p className="note-embed-note">{t('notes.embedImageHttps')}</p>}

        {embed?.kind === 'image' && (
          <Field label={t('notes.embedCaption')} hint={t('notes.embedCaptionHint')}>
            <Input value={caption} maxLength={200} onChange={(event) => setCaption(event.target.value)} enterKeyHint="done" />
          </Field>
        )}
      </form>
    </Modal>
  );
}

function EmbedPreview({ embed }: { embed: Embed }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const kind =
    embed.kind === 'youtube'
      ? { icon: SquarePlay, label: t('notes.embedKindYouTube') }
      : embed.kind === 'image'
        ? { icon: ImageIcon, label: t('notes.embedKindImage') }
        : { icon: Globe, label: t('notes.embedKindWebsite') };

  const image =
    embed.kind === 'youtube' ? youTubeThumbnail(embed.id) : embed.kind === 'image' ? embed.url : faviconUrl(embed.domain);

  return (
    <div className={`note-embed-preview is-${embed.kind}`} aria-live="polite">
      <div className="note-embed-preview-media" aria-hidden="true">
        {failed ? (
          <Icon icon={kind.icon} size="lg" />
        ) : (
          <img src={image} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        )}
      </div>
      <div className="note-embed-preview-text">
        <span className="note-embed-kind">
          <Icon icon={kind.icon} size="sm" />
          {kind.label}
        </span>
        <span className="note-embed-url" title={embed.url}>
          {shortenUrl(embed.url)}
        </span>
        {failed && embed.kind !== 'website' && <span className="note-embed-note">{t('notes.embedPreviewFailed')}</span>}
      </div>
    </div>
  );
}
