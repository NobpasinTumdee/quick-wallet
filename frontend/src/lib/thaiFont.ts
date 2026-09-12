/**
 * Sarabun, loaded into jsPDF at export time.
 *
 * ---------------------------------------------------------------------------
 * WHY FETCHED RATHER THAN BUNDLED
 * ---------------------------------------------------------------------------
 * jsPDF's built-in fonts are WinAnsi: no Thai glyphs, no ฿. Getting Thai into a
 * PDF means embedding a real TTF, and there are two ways to have one.
 *
 * Bundling it as base64 would put ~240kB of unreadable string into the repo and
 * into a chunk, forever, for a feature most sessions never touch. Fetching it
 * keeps both clean, costs ~180kB once per session, and the failure mode is
 * benign: if the network is unavailable the PDF falls back to Helvetica and
 * English, which is exactly what it did before this file existed.
 *
 * Sarabun is the natural choice — it is the Google Fonts sibling of
 * THSarabunNew, the face Thai government forms are set in, so a tax estimate
 * printed in it looks like what it is. Licensed OFL.
 *
 * The raw TTFs come from the google/fonts repository via jsDelivr, which serves
 * them with `Access-Control-Allow-Origin: *`. Google Fonts' own CSS API is not
 * usable here: it serves woff2, and jsPDF can only embed TTF.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * jsPDF has no OpenType shaping engine — no GSUB, no GPOS. For Thai that
 * matters in exactly one place: a tone mark sitting on top of an above-vowel
 * (ที่ = ท + ◌ี + ◌่) is drawn at its default height and lands *inside* the
 * vowel, so the mark vanishes. `drawThaiText` in taxPdf.ts lifts those marks
 * manually. Everything else — consonants, leading vowels, below-vowels, marks
 * directly on a consonant — needs no help.
 */

import type { jsPDF } from 'jspdf';

/** The family name registered with jsPDF. */
export const THAI_FONT_FAMILY = 'Sarabun';

const SOURCE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun';

const FACES = [
  { file: 'Sarabun-Regular.ttf', style: 'normal' },
  { file: 'Sarabun-Bold.ttf', style: 'bold' },
] as const;

/**
 * Fetched bytes, kept for the life of the page.
 *
 * Exporting twice in one session must not re-download 180kB. The promise
 * itself is cached rather than the result, so two exports fired in quick
 * succession share one request instead of racing.
 */
let pending: Promise<Record<string, string> | null> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunked: `String.fromCharCode(...bytes)` on a 90kB array blows the argument
  // limit in some browsers.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchFaces(): Promise<Record<string, string> | null> {
  try {
    const downloaded = await Promise.all(
      FACES.map(async (face) => {
        const response = await fetch(`${SOURCE}/${face.file}`, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`${face.file}: HTTP ${response.status}`);
        return [face.file, toBase64(await response.arrayBuffer())] as const;
      }),
    );
    return Object.fromEntries(downloaded);
  } catch {
    // Deliberately swallowed. The caller degrades to Helvetica, and a failed
    // font download is not a reason to deny someone their tax figures.
    return null;
  }
}

/**
 * Registers Sarabun on `doc`, returning whether Thai is now printable.
 *
 * `false` is a normal outcome, not an error: the caller switches to Helvetica
 * and transliterates, and says so on the page.
 */
export async function loadThaiFont(doc: jsPDF): Promise<boolean> {
  if (!pending) pending = fetchFaces();

  const faces = await pending;
  if (!faces) {
    // Let a later export retry — the network may simply have been down.
    pending = null;
    return false;
  }

  try {
    for (const face of FACES) {
      doc.addFileToVFS(face.file, faces[face.file]);
      doc.addFont(face.file, THAI_FONT_FAMILY, face.style);
    }
    // Proof it registered, rather than trusting that addFont succeeded.
    return Object.keys(doc.getFontList()).includes(THAI_FONT_FAMILY);
  } catch {
    return false;
  }
}

/** Drops the cache. Exists so a test can force the fallback path. */
export function resetThaiFontCache(): void {
  pending = null;
}
