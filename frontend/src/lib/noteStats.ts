import { stripMarkdown } from './notes';

/**
 * Words and reading time for a note, counted on the text without its
 * Markdown. Thai is written without spaces between words, so it is counted
 * with the browser's word segmenter; where there is none (Firefox before
 * 125), each run of Thai counts as one word per five characters and the
 * figure is marked approximate.
 */
export type NoteStats = { words: number; minutes: number; approximate: boolean };

const THAI = /[฀-๿]/;
/** Words a minute, a common middle figure for reading on a screen. */
const WPM = 200;

type Segmenter = { segment: (text: string) => Iterable<{ isWordLike?: boolean }> };
type SegmenterCtor = new (locale: string, options: { granularity: 'word' }) => Segmenter;

export function countWords(text: string, locale: string): { words: number; approximate: boolean } {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Ctor) {
    try {
      const segmenter = new Ctor(THAI.test(text) ? 'th' : locale, { granularity: 'word' });
      let words = 0;
      for (const part of segmenter.segment(text)) if (part.isWordLike) words += 1;
      return { words, approximate: false };
    } catch {
      /* An unknown locale tag: fall through to the estimate. */
    }
  }
  let words = 0;
  let approximate = false;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const thai = token.match(/[฀-๿]+/g);
    if (!thai) {
      if (/[\p{L}\p{N}]/u.test(token)) words += 1;
      continue;
    }
    approximate = true;
    for (const run of thai) words += Math.max(1, Math.round(run.length / 5));
    if (/[\p{L}\p{N}]/u.test(token.replace(/[฀-๿]+/g, ''))) words += 1;
  }
  return { words, approximate };
}

export function noteStats(body: string, locale: string): NoteStats {
  const { words, approximate } = countWords(stripMarkdown(body), locale);
  return { words, approximate, minutes: words ? Math.max(1, Math.round(words / WPM)) : 0 };
}
