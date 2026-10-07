/**
 * CSV, written to survive the program most people will open it in.
 *
 * ---------------------------------------------------------------------------
 * THE BYTE-ORDER MARK
 * ---------------------------------------------------------------------------
 * Excel on Windows does not assume UTF-8. Handed a .csv with no marker it
 * decodes using the system's legacy codepage, and every Thai character becomes
 * mojibake — à¸ªà¸³ instead of สำ. The file is not corrupt; it is being read
 * wrong, which is worse, because the fix is invisible to the person looking at
 * it.
 *
 * A leading U+FEFF tells Excel the file is UTF-8 and it decodes correctly.
 * Other tools either honour it or skip it as whitespace, so the cost is one
 * character and the benefit is a file that opens properly for a Thai-language
 * user on the most common spreadsheet on earth.
 */
export const UTF8_BOM = '﻿';

/**
 * Escapes one field.
 *
 * The three characters that break a CSV are the comma, the double quote and
 * the newline — and all three appear in real transaction notes. A field
 * containing any of them is wrapped in quotes, and a quote inside becomes two
 * quotes, which is what RFC 4180 specifies and what every spreadsheet expects.
 *
 * A leading `=`, `+`, `-` or `@` is also prefixed with a quote character,
 * because Excel treats such a cell as a formula. A note reading
 * `=1+1` is harmless; `=HYPERLINK(...)` in a file someone forwards is not.
 * This is formula injection, and the export is exactly where it gets in.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  /* A number is never a formula, and has to stay a number: prefixing a
     negative amount with an apostrophe turns the whole Amount column into text
     and Excel will not sum it. The injection guard below is for free text
     only, which is where the risk actually comes from. */
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';

  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Joins rows with CRLF, which is what RFC 4180 says and what Excel prefers. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Hands the browser a file to save.
 *
 * The anchor is created, clicked and removed in the same tick, and the object
 * URL is revoked after — without that each export leaks the whole file into
 * memory for the life of the tab.
 */
export function downloadCsv(filename: string, csv: string): void {
  /* `text/csv;charset=utf-8` alongside the BOM: belt and braces, since some
     tools read the type and some read the bytes. */
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  /* Deferred: revoking synchronously can cancel the download in some
     browsers before it has read the blob. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
