/**
 * Pulling an amount, a date and a payee out of OCR text.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT "TAKE THE BIGGEST NUMBER"
 * ---------------------------------------------------------------------------
 * On a Thai bank slip the biggest number on the page is almost always the
 * *account balance*, not the transfer. Grabbing it would silently record a
 * ฿48,231.55 expense for a ฿120 coffee, and the user would have no idea where
 * the figure came from. So the amount is chosen by what the surrounding line
 * says, not by size, and lines that announce a balance or a fee are excluded
 * outright before anything is compared.
 *
 * ---------------------------------------------------------------------------
 * THE OTHER THAI-SPECIFIC TRAP: BUDDHIST ERA
 * ---------------------------------------------------------------------------
 * Thai slips print the year in the Buddhist Era — 2568, not 2025. Parsed
 * naively that is a date 543 years in the future, which sails past every
 * "is this a valid date" check and lands in the form looking plausible. Any
 * year above 2400 is converted, and two-digit years are disambiguated by
 * whether the CE reading would be in the future.
 *
 * Pure and dependency-free, so the whole extraction is testable without
 * Tesseract, a browser, or an image.
 */

export interface ParsedReceipt {
  amount?: number;
  /** `YYYY-MM-DD`. */
  date?: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Thai numerals → Arabic. Rare on slips, free to support. */
export function normalizeDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * Tidies OCR output without "correcting" it.
 *
 * Deliberately does not swap `O` for `0` or `l` for `1`. Those substitutions
 * fix some slips and corrupt others — turning a payee called "Lotus" into
 * "1otus" — and a wrong value the user cannot see the origin of is worse than
 * a missing one they are asked to type.
 */
export function cleanText(raw: string): string {
  return normalizeDigits(raw)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Amount                                                              */
/* ------------------------------------------------------------------ */

/** Lines carrying one of these are the ones worth reading an amount off. */
const AMOUNT_KEYWORDS = [
  'total',
  'amount',
  'grand total',
  'net',
  'paid',
  'จำนวนเงิน',
  'จํานวนเงิน',
  'จำนวน',
  'ยอดเงิน',
  'ยอดชำระ',
  'ยอดรวม',
  'รวมทั้งสิ้น',
  'รวมเงิน',
  'สุทธิ',
  'ชำระเงิน',
];

/**
 * Lines carrying one of these are excluded, whatever else they say.
 *
 * The balance is the dangerous one: it is on nearly every bank slip, it is
 * larger than the transfer, and it is formatted identically.
 */
const AMOUNT_BLOCKERS = [
  'balance',
  'available',
  'fee',
  'charge',
  'vat',
  'change',
  'cash',
  'ยอดคงเหลือ',
  'คงเหลือ',
  'ค่าธรรมเนียม',
  'ธรรมเนียม',
  'ภาษี',
  'เงินทอน',
  'ส่วนลด',
];

/** `1,234.56` / `1234.56` / `1 234,56` — grouped, with optional decimals. */
const MONEY = /\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;

function hasAny(line: string, needles: string[]): boolean {
  const lower = line.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

/**
 * Numbers that are identifiers, not money.
 *
 * Account and reference numbers are the other thing on a slip formatted with
 * digits and separators. A run of six or more digits with no decimal point is
 * an id; so is anything inside a masked account pattern.
 */
function looksLikeIdentifier(line: string, raw: string): boolean {
  if (/x{2,}/i.test(line)) return true;
  if (/\d[-\s]?\d{3,}[-\s]\d/.test(line) && !/\.\d{2}\b/.test(raw)) return true;
  const digits = raw.replace(/\D/g, '');
  return !raw.includes('.') && digits.length >= 6;
}

function toNumber(raw: string): number {
  // Strip grouping only — the decimal point is the one separator kept.
  return Number(raw.replace(/[ ,]/g, ''));
}

export function parseAmount(text: string): number | undefined {
  const lines = text.split('\n');

  const keyed: number[] = [];
  const plain: number[] = [];

  for (const line of lines) {
    if (hasAny(line, AMOUNT_BLOCKERS)) continue;

    const matches = line.match(MONEY);
    if (!matches) continue;

    const keyworded = hasAny(line, AMOUNT_KEYWORDS);

    for (const raw of matches) {
      if (looksLikeIdentifier(line, raw)) continue;

      const value = toNumber(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      // A slip amount above eight figures is OCR noise, not a purchase.
      if (value > 99_999_999) continue;

      // A bare integer on a keyword line is still probably the amount; a bare
      // integer anywhere else is more likely a count, a year, or a table row.
      const decimal = /\.\d{1,2}$/.test(raw);
      if (keyworded) keyed.push(value);
      else if (decimal) plain.push(value);
    }
  }

  // Keyword lines win outright, and among them the largest — a slip that says
  // "Total" twice is quoting a subtotal and a total.
  if (keyed.length) return Math.max(...keyed);
  if (plain.length) return Math.max(...plain);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Date                                                                */
/* ------------------------------------------------------------------ */

const THAI_MONTHS: Record<string, number> = {
  'ม.ค': 1, มกรา: 1, มกราคม: 1,
  'ก.พ': 2, กุมภา: 2, กุมภาพันธ์: 2,
  'มี.ค': 3, มีนา: 3, มีนาคม: 3,
  'เม.ย': 4, เมษา: 4, เมษายน: 4,
  'พ.ค': 5, พฤษภา: 5, พฤษภาคม: 5,
  'มิ.ย': 6, มิถุนา: 6, มิถุนายน: 6,
  'ก.ค': 7, กรกฎา: 7, กรกฎาคม: 7,
  'ส.ค': 8, สิงหา: 8, สิงหาคม: 8,
  'ก.ย': 9, กันยา: 9, กันยายน: 9,
  'ต.ค': 10, ตุลา: 10, ตุลาคม: 10,
  'พ.ย': 11, พฤศจิกา: 11, พฤศจิกายน: 11,
  'ธ.ค': 12, ธันวา: 12, ธันวาคม: 12,
};

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Resolves a written year to CE.
 *
 * Four digits above 2400 are Buddhist Era. Two digits are ambiguous — `68`
 * could be 2068 or BE 2568 — and are read as BE whenever the CE reading would
 * put the slip in the future, which is the only reading that can be right.
 */
export function resolveYear(raw: number, today = new Date()): number {
  const thisYear = today.getFullYear();

  if (raw > 2400) return raw - 543;
  if (raw >= 1000) return raw;

  const ce = 2000 + raw;
  if (ce <= thisYear + 1) return ce;
  return 2500 + raw - 543;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Rejects anything impossible or implausible for a receipt. */
function plausible(year: number, month: number, day: number, today: Date): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return false;

  const horizon = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
  return year >= 2000 && date <= horizon;
}

export function parseDate(text: string, today = new Date()): string | undefined {
  /* Numeric, day first — the order every Thai and most European slips use.
     A leading `(?!:)` guard is not needed because the separator class excludes
     the colon, which keeps "14:30" out of this. */
  const numeric = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g;
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = resolveYear(Number(match[3]), today);
    if (plausible(year, month, day, today)) return iso(year, month, day);
  }

  // ISO, which some POS printers emit.
  const isoLike = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  for (const match of text.matchAll(isoLike)) {
    const year = resolveYear(Number(match[1]), today);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (plausible(year, month, day, today)) return iso(year, month, day);
  }

  // "13 ก.ย. 2568" / "13 ก.ย. 68"
  const thai = /\b(\d{1,2})\s*([ก-๙]{1,3}\.?[ก-๙]?\.?|[ก-๙]{4,10})\s*(\d{2,4})\b/g;
  for (const match of text.matchAll(thai)) {
    const key = match[2].replace(/\.$/, '');
    const month = THAI_MONTHS[key] ?? THAI_MONTHS[key.replace(/\./g, '')];
    if (!month) continue;
    const day = Number(match[1]);
    const year = resolveYear(Number(match[3]), today);
    if (plausible(year, month, day, today)) return iso(year, month, day);
  }

  // "13 Sep 2025" and "Sep 13, 2025"
  const enDayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})\b/g;
  for (const match of text.matchAll(enDayFirst)) {
    const month = EN_MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (!month) continue;
    const day = Number(match[1]);
    const year = resolveYear(Number(match[3]), today);
    if (plausible(year, month, day, today)) return iso(year, month, day);
  }

  const enMonthFirst = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/g;
  for (const match of text.matchAll(enMonthFirst)) {
    const month = EN_MONTHS[match[1].slice(0, 3).toLowerCase()];
    if (!month) continue;
    const day = Number(match[2]);
    const year = resolveYear(Number(match[3]), today);
    if (plausible(year, month, day, today)) return iso(year, month, day);
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Payee                                                               */
/* ------------------------------------------------------------------ */

/** Phrases that introduce the recipient on the same or the following line. */
const PAYEE_KEYWORDS = [
  'pay to',
  'paid to',
  'merchant',
  'to:',
  'โอนเงินให้',
  'โอนไปยัง',
  'ไปยัง',
  'ผู้รับเงิน',
  'ผู้รับ',
  'ชื่อบัญชี',
  'ร้าน',
];

/** Lines that are never a payee, however early they appear. */
const PAYEE_NOISE =
  /^(?:[\d\s.,:/\-]+|.*(?:receipt|slip|invoice|tax|thank|เลขที่|อ้างอิง|รหัส|ใบเสร็จ|สลิป|วันที่|เวลา).*)$/i;

function tidyPayee(value: string): string {
  return value
    .replace(/^[\s:>\-–—]+/, '')
    .replace(/[\s:>\-–—]+$/, '')
    .slice(0, 60)
    .trim();
}

export function parsePayee(text: string): string | undefined {
  const lines = text.split('\n');

  // Keyworded first: "โอนเงินให้ นายสมชาย" or the line after "Pay to".
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const keyword = PAYEE_KEYWORDS.find((candidate) => lower.includes(candidate));
    if (!keyword) continue;

    const after = tidyPayee(line.slice(lower.indexOf(keyword) + keyword.length));
    if (after.length >= 2) return after;

    const next = tidyPayee(lines[index + 1] ?? '');
    if (next.length >= 2 && !PAYEE_NOISE.test(next)) return next;
  }

  /* Otherwise the first line that reads like a name. Receipts put the shop at
     the top, so first-that-qualifies beats longest or most-frequent here. */
  for (const line of lines.slice(0, 6)) {
    const candidate = tidyPayee(line);
    if (candidate.length < 3 || PAYEE_NOISE.test(candidate)) continue;
    // Needs letters — a row of prices is not a name.
    if (!/[A-Za-z฀-๿]{3,}/.test(candidate)) continue;
    return candidate;
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/* The whole job                                                       */
/* ------------------------------------------------------------------ */

export interface ReceiptParseResult extends ParsedReceipt {
  /** Nothing structured came out — the caller shows the raw text instead. */
  empty: boolean;
  /** Cleaned OCR text, kept so a failed parse can still help the user. */
  text: string;
}

/**
 * Best effort, and honest about it.
 *
 * When nothing parses, the cleaned text still comes back so the UI can drop the
 * first line into the note field. A scan that read *something* and offers it is
 * more use than one that shrugs.
 */
export function parseReceiptText(raw: string, today = new Date()): ReceiptParseResult {
  const text = cleanText(raw);

  const amount = parseAmount(text);
  const date = parseDate(text, today);
  const note = parsePayee(text);

  return {
    amount,
    date,
    note,
    empty: amount === undefined && date === undefined && note === undefined,
    text,
  };
}
