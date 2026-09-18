import { useTranslation } from 'react-i18next';

/**
 * A plain data table — used twice: as the chart's table twin, and as the raw
 * rows of the source.
 *
 * The twin is not optional. Several validated series colours fall below 3:1
 * contrast on some themes, and the palette validator's relief rule is that a
 * low-contrast mark may never be the only way to read a value. It is also the
 * one fully accessible route through a dense scatter.
 *
 * Rows are capped. A table of 12,000 rows is not a table anyone reads, and
 * rendering it would stall the modal for a second on a phone. The cap is
 * stated under the table rather than applied silently.
 */
export const TABLE_ROW_CAP = 250;

export function ExplorerTable({
  headers,
  rows,
  numeric,
  format,
  caption,
}: {
  headers: string[];
  rows: unknown[][];
  /** Which columns are numbers — right-aligned, tabular figures. */
  numeric: boolean[];
  format: (value: unknown, column: number) => string;
  caption: string;
}) {
  const { t } = useTranslation();
  const shown = rows.slice(0, TABLE_ROW_CAP);

  return (
    <div className="xp-table-wrap">
      <table className="xp-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i} scope="col" className={numeric[i] ? 'is-num' : undefined}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={numeric[c] ? 'is-num' : undefined}>
                  {format(cell, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="xp-note">{t('explorer.tableCapped', { shown: shown.length, total: rows.length })}</p>
      )}
      {rows.length === 0 && <p className="xp-note">{t('explorer.tableEmpty')}</p>}
    </div>
  );
}
