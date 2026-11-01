/**
 * Which links in a note become embeds, decided from the URL alone — no
 * network, no backend. Used by the reading view, the Embed dialog and the
 * list preview, so all three agree on what a link is.
 *
 * Only http and https are ever embeds; pictures and videos need https,
 * since they load inside the app.
 */

export type Embed =
  | { kind: 'youtube'; url: string; id: string; start: number }
  | { kind: 'image'; url: string }
  | { kind: 'website'; url: string; domain: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif)$/i;

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}

/** "1h2m3s", "90s", "90" → seconds; 0 when absent or unreadable. */
function parseStart(raw: string | null): number {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** The video in a YouTube link, with its start time; null for anything else
 *  (a playlist on its own, a channel, a search). */
export function parseYouTube(url: string): { id: string; start: number } | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = parsed.pathname.split('/');
    if (first === 'watch') id = parsed.searchParams.get('v');
    else if (first === 'shorts' || first === 'embed' || first === 'live') id = second ?? null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const hashStart = /(?:^|&)t=([^&]+)/.exec(parsed.hash.slice(1))?.[1] ?? null;
  const start = parseStart(parsed.searchParams.get('t') ?? parsed.searchParams.get('start') ?? hashStart);
  return { id, start };
}

/** An https address whose path (query ignored) ends in a picture extension. */
export function isImageUrl(url: string): boolean {
  const parsed = parse(url);
  return Boolean(parsed && parsed.protocol === 'https:' && IMAGE_PATH.test(parsed.pathname));
}

/** An image that may be loaded: https only — never `data:` or `http:`. */
export function isLoadableImage(url: string): boolean {
  return parse(url)?.protocol === 'https:';
}

export function domainOf(url: string): string {
  return parse(url)?.hostname.replace(/^www\./, '') ?? '';
}

/** What a URL on a line of its own becomes, or null to leave it as text. */
export function classifyEmbed(url: string): Embed | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const youtube = parseYouTube(url);
  if (youtube) return { kind: 'youtube', url, ...youtube };
  if (isImageUrl(url)) return { kind: 'image', url };
  return { kind: 'website', url, domain: parsed.hostname.replace(/^www\./, '') };
}

export function youTubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function youTubePlayer(id: string, start: number): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start > 0 ? `&start=${start}` : ''}`;
}

/** Sends the domain (only) to Google's favicon service. */
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

/**
 * The text of a URL alone on a line — bare, or in angle brackets, with
 * surrounding spaces — or null when the line holds anything else.
 */
export function loneUrl(line: string): string | null {
  const m = /^\s*<?(https?:\/\/[^\s<>]+?)>?\s*$/i.exec(line);
  return m ? m[1] : null;
}

/**
 * A long address made readable: the domain and the start of the path,
 * "…" for the rest. The full address stays in the tooltip.
 */
export function shortenUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') return decodeURIComponent(url.pathname);
    const host = url.hostname.replace(/^www\./, '');
    const path = decodeSafe(`${url.pathname}${url.search}${url.hash}`).replace(/\/$/, '');
    if (!path) return host;
    if ((host + path).length <= 34) return host + path;
    const first = path.split(/[/?#]/).filter(Boolean)[0] ?? '';
    return `${host}/${first.length > 16 ? first.slice(0, 16) : first}…`;
  } catch {
    return href.length > 40 ? `${href.slice(0, 37)}…` : href;
  }
}

function decodeSafe(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/**
 * The Markdown the Embed dialog inserts. A picture with a caption needs
 * `![caption](url)`; anything else is the URL alone, which is what makes it
 * an embed — in angle brackets when it ends in punctuation the autolinker
 * would otherwise leave off.
 */
export function embedMarkdown(url: string, caption: string): string {
  const clean = caption.replace(/\s+/g, ' ').trim();
  if (isImageUrl(url) && clean) {
    const label = clean.replace(/([[\]\\])/g, '\\$1');
    const safe = url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `![${label}](${safe})`;
  }
  return /[.,;:!?)\]'"*_~]$/.test(url) ? `<${url}>` : url;
}
