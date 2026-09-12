/**
 * PDF export for the tax estimate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DRAWS THE PAGE INSTEAD OF SCREENSHOTTING IT
 * ---------------------------------------------------------------------------
 * The obvious approach is html2canvas over the receipt, and it would not work
 * here. This app's palette is built almost entirely out of `color-mix()`
 * (`--accent-soft`, `--glass-bg`, `--surface-hover`, every derived token in
 * theme.css), and the receipt's surfaces use `backdrop-filter`. html2canvas
 * parses neither: `color-mix()` fails its colour parser and `backdrop-filter`
 * is silently ignored. A capture of *this particular* UI comes out with black
 * or transparent panels — the glassmorphism that makes it look good on screen
 * is exactly what makes it un-screenshottable.
 *
 * Drawing the document with jsPDF's own primitives instead gives real vector
 * text (selectable, searchable, sharp at any zoom), a layout designed for A4
 * rather than a screenshot of a screen layout, and a file measured in tens of
 * kilobytes. The numbers come from the `ThaiTaxResult` object, the same one the
 * receipt renders from, so the PDF and the screen cannot disagree.
 *
 * ---------------------------------------------------------------------------
 * THAI
 * ---------------------------------------------------------------------------
 * Sarabun is fetched and embedded at export time (see `lib/thaiFont.ts`), so
 * the document carries the same Thai terms as the receipt and a real ฿ sign.
 *
 * jsPDF has no OpenType shaping, which for Thai breaks in exactly one place: a
 * tone mark stacked on an above-vowel is drawn at its default height, lands
 * inside the vowel, and disappears. `ที่นี่มีชื่อ` renders as `ทีนีมีชือ` —
 * silently, and with the meaning changed. `splitRaisedMarks` below pulls those
 * marks out and `draw` redraws them lifted, which was verified by rasterising
 * the output and looking at it.
 *
 * If the font cannot be fetched the document falls back to Helvetica and
 * English, and says so in the footer. That is the same document this file
 * produced before Thai support existed, so the failure is a downgrade rather
 * than a broken export.
 */

import { THAI_FONT_FAMILY, loadThaiFont } from './thaiFont';
import { ThaiTaxResult } from './thaiTaxEngine';

/* ---- A4 in points, and the grid everything sits on ---- */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const RIGHT = PAGE.width - MARGIN;
const BOTTOM_LIMIT = PAGE.height - MARGIN - 26;

/** Ink. Deliberately near-black and one blue — a tax document is not a poster. */
const INK = { strong: 17, body: 68, muted: 120, ghost: 175 } as const;
const ACCENT: [number, number, number] = [59, 111, 255];
const POSITIVE: [number, number, number] = [15, 122, 84];
const RULE = 214;

/* ------------------------------------------------------------------ */
/* Thai text handling                                                  */
/* ------------------------------------------------------------------ */

/** Vowels that occupy the space directly above the consonant. */
const ABOVE_VOWEL = /[ัิ-ื็ํ]/;
/** Tone marks and thanthakhat, which want to sit above whatever precedes them. */
const TONE_MARK = /[่-์]/;
const HAS_THAI = /[฀-๿]/;

/**
 * How far to lift a tone mark that has an above-vowel underneath it, as a
 * fraction of the font size. Picked by rendering 0.24 / 0.30 / 0.36 and
 * comparing: 0.24 still grazes the vowel, 0.36 floats away from the word.
 */
const MARK_LIFT = 0.3;

/** What the drawing helpers need to know about the current font state. */
interface FontState {
  thai: boolean;
  family: string;
}

/**
 * Pulls out the tone marks that need manual lifting, recording where each one
 * belongs.
 *
 * The marks are zero-advance in the font, so removing them moves nothing else —
 * the remaining text lays out identically, and each mark's x is simply the
 * width of the text that precedes it.
 */
export function splitRaisedMarks(value: string): {
  base: string;
  marks: { ch: string; offset: number }[];
} {
  const marks: { ch: string; offset: number }[] = [];
  let base = '';

  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (index > 0 && TONE_MARK.test(ch) && ABOVE_VOWEL.test(value[index - 1])) {
      // Recorded as a character offset into `base`; the caller converts it to
      // points, since only it knows the active font size.
      marks.push({ ch, offset: base.length });
      continue;
    }
    base += ch;
  }

  return { base, marks };
}

/**
 * Transliterates away anything the built-in fonts cannot encode.
 *
 * Only used on the Helvetica fallback path. Thai is dropped rather than
 * mangled: a blank is honest, a wrong glyph is not.
 */
export function toWinAnsi(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/฿/g, 'THB')
    .replace(/[   ]/g, ' ')
    .replace(/[^ -ÿ\n]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function money(value: number, currency: string, font: FontState): string {
  const amount = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // The ฿ sign only exists once Sarabun is embedded.
  return font.thai && currency === 'THB' ? `฿${amount}` : `${currency} ${amount}`;
}

function plain(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** `2026-01-01` → `1 Jan 2026`, without dragging in a date library. */
function longDate(key: string): string {
  const parsed = new Date(`${key}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface TaxPdfOptions {
  result: ThaiTaxResult;
  /** The books' currency. Printed as-is: the PDF must not claim THB if it isn't. */
  currency: string;
  /** Appears under the title. */
  taxpayerName?: string;
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds the document and hands it back unsaved.
 *
 * Split from `exportTaxPdf` so the layout can be exercised outside a browser —
 * `doc.save()` needs a DOM, everything above it does not. A PDF generator that
 * can only be verified by a human clicking a button and squinting is one that
 * silently rots.
 *
 * jsPDF is imported dynamically so its ~390kB never enters the main bundle.
 */
export async function buildTaxDocument({
  result,
  currency,
  taxpayerName,
}: TaxPdfOptions): Promise<import('jspdf').jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  const font: FontState = { thai: await loadThaiFont(doc), family: THAI_FONT_FAMILY };
  // Sarabun sets a little smaller than Helvetica at the same point size.
  const SCALE = font.thai ? 1.08 : 1;

  /* ------------------------------------------------------------------ */
  /* Drawing helpers                                                     */
  /* ------------------------------------------------------------------ */

  let y = MARGIN;

  const useFont = (bold?: boolean, size = 10) => {
    doc.setFont(font.thai ? font.family : 'helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size * SCALE);
  };

  /**
   * The one place text reaches the page.
   *
   * On the Thai path it pulls out tone marks that would be swallowed by an
   * above-vowel and redraws them lifted. Right alignment is resolved to a left
   * origin first, because the marks are placed by measured offset and cannot be
   * expressed relative to a right edge.
   */
  const draw = (
    value: string,
    x: number,
    options: {
      size?: number;
      bold?: boolean;
      ink?: number | [number, number, number];
      align?: 'left' | 'right';
      /** Overrides the running cursor, for text that sits beside other text. */
      atY?: number;
    } = {},
  ) => {
    const size = (options.size ?? 10) * SCALE;
    const baseline = options.atY ?? y;

    useFont(options.bold, options.size ?? 10);
    const colour = options.ink ?? INK.body;
    if (Array.isArray(colour)) doc.setTextColor(colour[0], colour[1], colour[2]);
    else doc.setTextColor(colour);

    const text = font.thai ? value : toWinAnsi(value);
    if (!text) return;

    if (!font.thai || !HAS_THAI.test(text)) {
      doc.text(text, x, baseline, { align: options.align ?? 'left' });
      return;
    }

    const { base, marks } = splitRaisedMarks(text);
    const left = options.align === 'right' ? x - doc.getTextWidth(base) : x;

    doc.text(base, left, baseline);
    for (const mark of marks) {
      const at = left + doc.getTextWidth(base.slice(0, mark.offset));
      doc.text(mark.ch, at, baseline - MARK_LIFT * size);
    }
  };

  const rule = (weight = 0.5, colour = RULE) => {
    doc.setDrawColor(colour);
    doc.setLineWidth(weight);
    doc.line(MARGIN, y, RIGHT, y);
  };

  /** Starts a new page when the next block would not fit. */
  const ensureSpace = (needed: number) => {
    if (y + needed <= BOTTOM_LIMIT) return;
    doc.addPage();
    y = MARGIN;
  };

  /**
   * One line of the receipt: an English label, the Thai term beneath it, and
   * the figure on the right. The Thai line is dropped entirely on the fallback
   * path rather than left as an empty gap.
   */
  const row = (
    label: string,
    value: string,
    options: {
      thaiLabel?: string;
      note?: string;
      bold?: boolean;
      ink?: number | [number, number, number];
      size?: number;
    } = {},
  ) => {
    ensureSpace(34);
    const size = options.size ?? 10;

    draw(label, MARGIN, { size, bold: options.bold, ink: options.bold ? INK.strong : INK.body });
    draw(value, RIGHT, {
      size,
      bold: options.bold,
      ink: options.ink ?? INK.strong,
      align: 'right',
    });

    const sub = [font.thai ? options.thaiLabel : undefined, options.note]
      .filter(Boolean)
      .join('  ·  ');
    if (sub) {
      y += 11;
      draw(sub, MARGIN, { size: 8, ink: INK.muted });
    }
    y += 18;
  };

  const heading = (label: string) => {
    ensureSpace(28);
    draw(label.toUpperCase(), MARGIN, { size: 8, bold: true, ink: INK.muted });
    y += 14;
  };

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */

  y += 6;
  draw('Thai Personal Income Tax', MARGIN, { size: 19, bold: true, ink: INK.strong });
  y += 17;
  draw(
    font.thai
      ? 'ภาษีเงินได้บุคคลธรรมดา · Estimate (P.N.D. 90/91)'
      : 'Estimate - Personal Income Tax (P.N.D. 90/91)',
    MARGIN,
    { size: 10, ink: INK.muted },
  );
  y += 21;

  draw(`${longDate(result.from)} to ${longDate(result.to)}`, MARGIN, {
    size: 10,
    bold: true,
    ink: INK.strong,
  });
  draw(`Generated ${longDate(new Date().toISOString().slice(0, 10))}`, RIGHT, {
    size: 9,
    ink: INK.muted,
    align: 'right',
  });
  y += 14;

  if (taxpayerName) {
    draw(`Prepared for ${taxpayerName}`, MARGIN, { size: 9, ink: INK.muted });
    y += 14;
  }

  y += 4;
  doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, MARGIN + 46, y);
  y += 26;

  /* ------------------------------------------------------------------ */
  /* How the taxable figure is reached                                   */
  /* ------------------------------------------------------------------ */

  heading('Calculation');

  row('Gross assessable income', money(result.grossIncome, currency, font), {
    thaiLabel: 'เงินได้พึงประเมิน',
    note: `${result.transactionCount} income transaction${result.transactionCount === 1 ? '' : 's'}`,
  });

  row(
    `Less: standard expense deduction (50%, max ${plain(100_000)})`,
    `- ${money(result.expenseDeduction, currency, font)}`,
    {
      thaiLabel: 'ค่าใช้จ่าย',
      note: result.expenseDeductionCapped
        ? `50% would be ${money(result.expenseDeductionUncapped, currency, font)}; the cap applies`
        : undefined,
    },
  );

  row('Less: personal allowance', `- ${money(result.allowances.personal, currency, font)}`, {
    thaiLabel: 'ค่าลดหย่อนส่วนตัว',
  });

  /* ---- The optional allowances ----
     Only the ones actually claimed are printed. A row of zeroes would say
     nothing except that the fields exist. */
  const { socialSecurity, insurance, funds } = result.allowances;

  if (socialSecurity.applied > 0) {
    row('Less: social security', `- ${money(socialSecurity.applied, currency, font)}`, {
      thaiLabel: 'ประกันสังคม',
      note: socialSecurity.capped
        ? `${money(socialSecurity.requested, currency, font)} entered, capped at ${plain(socialSecurity.cap ?? 0)}`
        : undefined,
    });
  }

  if (insurance.applied > 0) {
    row('Less: life and health insurance', `- ${money(insurance.applied, currency, font)}`, {
      thaiLabel: 'ประกันชีวิตและสุขภาพ',
      note: insurance.capped
        ? `${money(insurance.requested, currency, font)} entered, capped at ${plain(insurance.cap ?? 0)}`
        : undefined,
    });
  }

  if (funds.applied > 0) {
    row('Less: investment funds', `- ${money(funds.applied, currency, font)}`, {
      thaiLabel: 'กองทุนรวม SSF / RMF / Thai ESG',
      note: 'as entered; own limits not verified',
    });
  }

  y += 2;
  rule();
  y += 16;

  row('Net taxable income', money(result.netTaxableIncome, currency, font), {
    thaiLabel: 'เงินได้สุทธิ',
    bold: true,
    size: 11,
  });

  y += 12;

  /* ------------------------------------------------------------------ */
  /* The ladder                                                          */
  /* ------------------------------------------------------------------ */

  ensureSpace(60 + result.brackets.length * 17);
  heading('Progressive tax bands');

  const COL = { band: MARGIN, rate: MARGIN + 210, taxable: MARGIN + 330, tax: RIGHT };

  useFont(true, 8);
  doc.setTextColor(INK.muted);
  doc.text('BAND', COL.band, y);
  doc.text('RATE', COL.rate, y, { align: 'right' });
  doc.text('TAXABLE', COL.taxable, y, { align: 'right' });
  doc.text('TAX', COL.tax, y, { align: 'right' });
  y += 8;
  rule(0.5, 230);
  y += 14;

  for (const bracket of result.brackets) {
    // Unreached bands stay on the page but recede: seeing the whole ladder is
    // what makes a marginal system legible, so they are context, not clutter.
    const ink = bracket.isMarginal ? INK.strong : bracket.reached ? INK.body : INK.ghost;
    const label =
      bracket.upTo === Infinity
        ? `Over ${plain(bracket.from)}`
        : `${plain(bracket.from === 0 ? 0 : bracket.from + 1)} to ${plain(bracket.upTo)}`;
    const cell = { size: 9.5, bold: bracket.isMarginal, ink } as const;

    draw(label, COL.band, cell);
    draw(`${(bracket.rate * 100).toFixed(0)}%`, COL.rate, { ...cell, align: 'right' });
    draw(bracket.reached ? plain(bracket.taxableInBand) : '-', COL.taxable, {
      ...cell,
      align: 'right',
    });
    draw(
      bracket.reached
        ? bracket.tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '-',
      COL.tax,
      { ...cell, align: 'right' },
    );

    if (bracket.isMarginal) {
      // Measure the label in the font it was *drawn* in, not in the small font
      // about to be selected — otherwise the tag is placed short and lands on
      // top of the band it is annotating.
      useFont(true, 9.5);
      const labelWidth = doc.getTextWidth(label);

      useFont(false, 7.5);
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.text('marginal rate', COL.band + labelWidth + 10, y);
    }

    y += 17;
  }

  y += 2;
  rule();
  y += 18;

  /* ------------------------------------------------------------------ */
  /* Settlement                                                          */
  /* ------------------------------------------------------------------ */

  const settling = result.withholdingTax > 0;
  const boxHeight = settling ? (font.thai ? 150 : 122) : font.thai ? 66 : 52;
  ensureSpace(boxHeight + 20);

  const boxTop = y - 14;
  doc.setFillColor(246, 248, 252);
  doc.roundedRect(MARGIN, boxTop, CONTENT_WIDTH, boxHeight, 4, 4, 'F');

  y += 6;
  draw('Tax payable', MARGIN + 14, { size: 10, bold: true, ink: INK.strong });
  draw(money(result.taxPayable, currency, font), RIGHT - 14, {
    size: settling ? 12 : 16,
    bold: true,
    ink: INK.strong,
    align: 'right',
    atY: y + 4,
  });

  if (font.thai) {
    y += 12;
    draw('ภาษีที่ต้องชำระ', MARGIN + 14, { size: 8, ink: INK.muted });
  }

  y += 20;
  draw(
    `Effective rate ${result.effectiveRate.toFixed(2)}%  ·  Marginal rate ${result.marginalRate.toFixed(0)}%  ·  ${money(result.monthlyEquivalent, currency, font)} per month`,
    MARGIN + 14,
    { size: 8.5, ink: INK.muted },
  );

  if (settling) {
    y += 22;
    draw('Less: tax withheld at source', MARGIN + 14, { size: 10, ink: INK.body });
    draw(`- ${money(result.withholdingTax, currency, font)}`, RIGHT - 14, {
      size: 10,
      ink: INK.body,
      align: 'right',
    });

    if (font.thai) {
      y += 11;
      draw('ภาษีหัก ณ ที่จ่าย', MARGIN + 14, { size: 8, ink: INK.muted });
    }

    y += 14;
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN + 14, y, RIGHT - 14, y);
    y += 20;

    /* The answer the reader came for: not "your tax" but "pay this", or "you
       are getting this back". Refunds read green, and neither is ever shown as
       a negative number — "you owe -฿55,000" looks like a bug even when the
       arithmetic behind it is right. */
    const settledInk = result.isRefund ? POSITIVE : INK.strong;
    draw(result.isRefund ? 'Estimated refund due' : 'Tax still to pay', MARGIN + 14, {
      size: 11,
      bold: true,
      ink: settledInk,
    });
    draw(
      money(result.isRefund ? result.refundAmount : result.amountOwed, currency, font),
      RIGHT - 14,
      { size: 15, bold: true, ink: settledInk, align: 'right', atY: y + 3 },
    );

    if (font.thai) {
      y += 12;
      draw(result.isRefund ? 'เงินภาษีที่ได้คืน' : 'ภาษีที่ต้องชำระเพิ่ม', MARGIN + 14, {
        size: 8,
        ink: INK.muted,
      });
    }
  }

  y = boxTop + boxHeight + 30;

  /* ------------------------------------------------------------------ */
  /* Assumptions — the part that makes the number honest                 */
  /* ------------------------------------------------------------------ */

  ensureSpace(50);
  heading('What this estimate assumes');

  for (const assumption of result.assumptions) {
    const text = font.thai ? assumption : toWinAnsi(assumption);
    useFont(false, 8);
    doc.setTextColor(INK.muted);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH - 14) as string[];

    // A new page is cheaper than a disclaimer that runs off the bottom.
    ensureSpace(lines.length * 11 + 6);

    draw('•', MARGIN, { size: 8, ink: INK.muted });
    lines.forEach((line, index) => {
      draw(line, MARGIN + 14, { size: 8, ink: INK.muted, atY: y + index * 11 });
    });
    y += lines.length * 11 + 6;
  }

  /* ---- Footer on every page ---- */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    useFont(false, 7.5);
    doc.setTextColor(INK.muted);
    // When the font failed to load, the reader deserves to know why the page
    // is not in Thai rather than assuming the feature is broken.
    const note = font.thai
      ? 'Generated by Quick Wallet · an estimate, not a tax filing'
      : toWinAnsi(
          'Generated by Quick Wallet · an estimate, not a tax filing · Thai font unavailable, printed in English',
        );
    doc.text(note, MARGIN, PAGE.height - 28);
    doc.text(`${page} / ${pages}`, RIGHT, PAGE.height - 28, { align: 'right' });
  }

  return doc;
}

/** Builds the document and hands it to the browser as a download. */
export async function exportTaxPdf(options: TaxPdfOptions): Promise<void> {
  const doc = await buildTaxDocument(options);
  doc.save(taxPdfFilename(options.result.from, options.result.to));
}

export function taxPdfFilename(from: string, to: string): string {
  return `thai-tax-estimate-${from}-to-${to}.pdf`;
}
