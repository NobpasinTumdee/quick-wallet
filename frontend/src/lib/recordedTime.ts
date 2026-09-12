/**
 * The clock time a row was written.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE SAME AS THE TRANSACTION'S DATE
 * ---------------------------------------------------------------------------
 * A Transaction carries two temporal fields and they mean different things.
 * `date` is a `YYYY-MM-DD` key the user chose — when the money moved. It has no
 * clock component at all. `createdAt` is an ISO timestamp the server stamped —
 * when the row was written.
 *
 * For someone logging a coffee as they buy it those are the same moment; for
 * someone back-dating last week's rent they are a week apart. So this is
 * labelled "recorded at" everywhere it appears, never presented as the time of
 * the transaction, and the Activity filter that matches on it says the same
 * thing. Getting that wrong would be a quiet lie on every back-dated row.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RETURNS null RATHER THAN A DASH
 * ---------------------------------------------------------------------------
 * Rows written before `createdAt` existed have none, and an unparseable value
 * is always possible. A placeholder like "—" would put a column of dashes down
 * a list of older transactions; `null` lets each caller render nothing at all,
 * which is what an absent timestamp should look like.
 */

/**
 * `createdAt` as a local wall clock, or null when there is nothing to show.
 *
 * The hour format is left to `Intl` rather than forced to 24h: `en-US` wants
 * `2:32 PM`, `th-TH` wants `14:32`, and both are correct for their reader. The
 * locale is the app's own `settings.locale`, so this follows the language
 * switcher along with every other formatted value.
 *
 * `hour: 'numeric'`, not `'2-digit'` — the latter zero-pads a 12-hour clock and
 * produces "02:32 PM", which no en-US reader writes. Twenty-four-hour locales
 * pad either way, so this is the setting that is right in both.
 */
export function formatRecordedTime(createdAt: string | undefined, locale = 'en-US'): string | null {
  if (!createdAt) return null;

  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return null;

  try {
    return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  } catch {
    // An invalid locale tag throws rather than falling back. A wrong-looking
    // time beats a blank screen.
    return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
}

/**
 * True when the row was written on a different day from the one it is filed
 * under — i.e. it was back-dated.
 *
 * Exposed so a caller can choose to show the full stamp rather than a bare
 * clock in that case, where "14:32" under a date three days earlier reads as a
 * contradiction.
 */
export function wasBackdated(date: string, createdAt: string | undefined): boolean {
  if (!date || !createdAt) return false;

  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;

  const recordedDay = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')}`;

  return recordedDay !== date;
}
