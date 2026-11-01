import { ExternalLink, Globe, ImageOff, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Embed,
  domainOf,
  faviconUrl,
  isLoadableImage,
  shortenUrl,
  youTubePlayer,
  youTubeThumbnail,
} from '../../lib/embeds';
import { Icon } from '../Icon';
import { Modal } from '../ui';

/**
 * What a link alone on its line becomes in the reading view. Part of the
 * Markdown chunk, so none of it loads until a note is read. Nothing here
 * fetches anything the browser would not for a plain `<img>`: no page
 * titles, no previews, no iframe until a video is played.
 */
export function NoteEmbed({ embed, alt }: { embed: Embed; alt: string }) {
  if (embed.kind === 'youtube') return <YouTubeEmbed id={embed.id} start={embed.start} url={embed.url} />;
  if (embed.kind === 'image') return <Picture url={embed.url} alt={alt} block />;
  return <WebsiteCard url={embed.url} domain={embed.domain} />;
}

/**
 * A thumbnail with a play button until it is tapped; only then does the
 * player load, from the no-cookie domain. A note with ten videos costs ten
 * small images, not ten players.
 */
function YouTubeEmbed({ id, start, url }: { id: string; start: number; url: string }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <div className="md-yt">
      <div className="md-yt-frame">
        {playing ? (
          <iframe
            src={youTubePlayer(id, start)}
            title={t('notes.embedYouTubeTitle')}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            /* Scripts and its own origin are what the player needs to run;
               popups let its "Watch on YouTube" open a normal tab. */
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        ) : (
          <button type="button" className="md-yt-poster" aria-label={t('notes.embedPlay')} onClick={() => setPlaying(true)}>
            {!thumbFailed && (
              <img
                src={youTubeThumbnail(id)}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
              />
            )}
            <span className="md-yt-play" aria-hidden="true">
              <Icon icon={Play} size="lg" />
            </span>
            <span className="md-yt-badge" aria-hidden="true">
              YouTube
            </span>
          </button>
        )}
      </div>
      <a className="md-embed-open" href={url} target="_blank" rel="noopener noreferrer" title={url}>
        {t('notes.embedOpenYouTube')}
        <Icon icon={ExternalLink} size="sm" />
      </a>
    </div>
  );
}

/**
 * A picture from a link: lazy, no referrer, https only. Tapping opens it
 * full size on the shared Modal, so Back and Escape close it like any sheet.
 * Spans throughout, because `![alt](url)` can sit inside a sentence.
 */
export function Picture({ url, alt, block = false }: { url: string; alt: string; block?: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  if (!isLoadableImage(url)) {
    /* http: is never loaded into the app; offer it as a link instead. */
    return (
      <a className="md-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
        {alt || shortenUrl(url)}
      </a>
    );
  }

  if (failed) {
    return (
      <span className={block ? 'md-picture md-picture-failed is-block' : 'md-picture md-picture-failed'}>
        <Icon icon={ImageOff} size="sm" />
        <span className="md-picture-failed-text">{t('notes.embedImageFailed')}</span>
        <a className="md-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
          {shortenUrl(url)}
        </a>
      </span>
    );
  }

  return (
    <span className={block ? 'md-picture is-block' : 'md-picture'}>
      <button
        type="button"
        className="md-picture-btn"
        aria-label={alt ? `${t('notes.embedViewImage')}: ${alt}` : t('notes.embedViewImage')}
        onClick={() => setOpen(true)}
      >
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </button>
      {alt && <span className="md-picture-caption">{alt}</span>}
      <Modal open={open} title={alt || domainOf(url)} onClose={() => setOpen(false)} width={1100}>
        <span className="md-lightbox">
          <img src={url} alt={alt} decoding="async" referrerPolicy="no-referrer" />
          <a className="md-embed-open" href={url} target="_blank" rel="noopener noreferrer" title={url}>
            {t('notes.embedOpenOriginal')}
            <Icon icon={ExternalLink} size="sm" />
          </a>
        </span>
      </Modal>
    </span>
  );
}

/**
 * A link card: favicon, domain, the address shortened. No title or preview —
 * those would mean fetching the page, which only a server can do.
 */
function WebsiteCard({ url, domain }: { url: string; domain: string }) {
  const { t } = useTranslation();
  const [iconFailed, setIconFailed] = useState(false);
  const short = shortenUrl(url);

  return (
    <a className="md-card" href={url} target="_blank" rel="noopener noreferrer" title={url}>
      <span className="md-card-icon" aria-hidden="true">
        {iconFailed ? (
          <Icon icon={Globe} size="sm" />
        ) : (
          <img
            src={faviconUrl(domain)}
            alt=""
            width={20}
            height={20}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setIconFailed(true)}
          />
        )}
      </span>
      <span className="md-card-text">
        <span className="md-card-title">{short}</span>
        <span className="md-card-domain">{short === domain ? t('notes.embedKindWebsite') : domain}</span>
      </span>
      <span className="md-card-go" aria-hidden="true">
        <Icon icon={ExternalLink} size="sm" />
      </span>
    </a>
  );
}
