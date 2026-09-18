import { BLANK, ColumnKind, RawColumn, RawDataset, RawRow, columnFor, toCategory, toNumber, toTime } from './explorerData';

/**
 * Row filters for the Deep Analytics explorer.
 *
 * Applied to the raw rows *before* anything is summarised or drawn — a filter
 * that ran after aggregation would be filtering sums rather than transactions,
 * which is a different (and usually wrong) question.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OPERATORS DEPEND ON THE COLUMN
 * ---------------------------------------------------------------------------
 * `contains` on a number and `>` on a category are both expressible and both
 * meaningless: "amount contains 5" matches 15, 50 and 1,005; "category > Food"
 * is alphabetical order, which nobody means. Offering only the operators that
 * make sense for a column's kind removes a whole class of silent wrong answers.
 *
 *   number, date   =  ≠  >  <
 *   category       =  ≠  contains
 *   yes/no         =  ≠
 *
 * ---------------------------------------------------------------------------
 * WHAT A MISSING VALUE MATCHES
 * ---------------------------------------------------------------------------
 * For numbers and dates, a row with no usable value matches nothing — not even
 * ≠. "Amount ≠ 100" keeping rows whose amount is blank would count them into a
 * sum as though they were a value other than 100, which they are not; they are
 * no value. This is SQL's rule, and for a measure it is the right one.
 *
 * Categories are different: blank is itself a category here — it has a label,
 * "(blank)", and can be charted as a bar. So "category ≠ Food" keeps the blank
 * rows, which is what a person reading the legend would expect.
 */

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains';

export interface Filter {
  /** Stable key for React and for editing in place. */
  id: string;
  column: string | null;
  operator: FilterOperator;
  /** Always a string — it comes from an input. Parsed per column kind. */
  value: string;
}

export const OPERATORS_FOR: Record<ColumnKind, FilterOperator[]> = {
  number: ['eq', 'neq', 'gt', 'lt'],
  date: ['eq', 'neq', 'gt', 'lt'],
  category: ['eq', 'neq', 'contains'],
  boolean: ['eq', 'neq'],
};

let counter = 0;
export function newFilter(): Filter {
  counter += 1;
  return { id: `f${Date.now().toString(36)}${counter}`, column: null, operator: 'eq', value: '' };
}

/**
 * A filter reshaped to fit a column it was just pointed at.
 *
 * Changing the column of an existing filter must not leave behind an operator
 * the new column does not support (`contains` carried over onto a number) or a
 * value typed for the old one (`Food` against a date). The operator falls back
 * to `=` if it no longer applies, and the value is cleared when the kind
 * changes.
 */
export function retarget(filter: Filter, column: RawColumn | null, previous: RawColumn | null): Filter {
  if (!column) return { ...filter, column: null };
  const allowed = OPERATORS_FOR[column.kind];
  return {
    ...filter,
    column: column.key,
    operator: allowed.includes(filter.operator) ? filter.operator : 'eq',
    value: previous && previous.kind === column.kind ? filter.value : '',
  };
}

/**
 * Whether a filter is complete enough to apply.
 *
 * An incomplete filter is ignored rather than treated as "matches nothing". The
 * moment someone presses "Add filter", the new row has no column and no value;
 * if that emptied the chart, adding a filter would look like breaking it.
 */
export function isActive(filter: Filter, columns: RawColumn[]): boolean {
  const column = columnFor(columns, filter.column);
  if (!column) return false;
  if (!OPERATORS_FOR[column.kind].includes(filter.operator)) return false;
  if (column.kind === 'boolean') return filter.value === 'true' || filter.value === 'false';
  if (column.kind === 'number') return toNumber(filter.value) !== null;
  if (column.kind === 'date') return dayOf(filter.value) !== null;
  return filter.value.trim() !== '';
}

/** Midnight UTC of the calendar day a date value falls on. */
function dayOf(value: unknown): number | null {
  const time = toTime(value);
  if (time === null) return null;
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function compare(operator: FilterOperator, a: number, b: number): boolean {
  switch (operator) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return a > b;
    case 'lt':
      return a < b;
    default:
      return false;
  }
}

/** Build a predicate once per filter, so the per-row work is just the compare. */
function predicate(filter: Filter, column: RawColumn): (row: RawRow) => boolean {
  const key = column.key;

  if (column.kind === 'number') {
    const needle = toNumber(filter.value) as number;
    return (row) => {
      const value = toNumber(row[key]);
      return value !== null && compare(filter.operator, value, needle);
    };
  }

  if (column.kind === 'date') {
    /* By calendar day, not by instant. "Date = 14 Mar" must match a
       `createdAt` stamped 14 Mar 09:31, and "Date < 14 Mar" must not include
       it — both only work when the row is compared at the same granularity as
       the value the user typed. */
    const needle = dayOf(filter.value) as number;
    return (row) => {
      const value = dayOf(row[key]);
      return value !== null && compare(filter.operator, value, needle);
    };
  }

  if (column.kind === 'boolean') {
    const needle = filter.value === 'true';
    return (row) => {
      const value = row[key];
      const truthy = value === true || value === 'true';
      return filter.operator === 'eq' ? truthy === needle : truthy !== needle;
    };
  }

  /* Categories compare case-insensitively and trimmed. "food" and "Food " are
     the same category to anyone typing a filter, and a sheet edited by hand
     will have both. */
  const needle = filter.value.trim().toLocaleLowerCase();
  return (row) => {
    const raw = toCategory(row[key]);
    const value = raw === BLANK ? '' : raw.toLocaleLowerCase();
    if (filter.operator === 'contains') return value.includes(needle);
    if (filter.operator === 'eq') return value === needle;
    return value !== needle;
  };
}

/**
 * The rows that pass every active filter. Filters combine with AND — the UI
 * says so, because "match all" and "match any" read the same in a list.
 *
 * Returns the same dataset object when nothing is active, so a memo keyed on
 * it does not recompute the chart for an empty filter row.
 */
export function applyFilters(dataset: RawDataset, filters: Filter[]): RawDataset {
  const tests = filters
    .filter((filter) => isActive(filter, dataset.columns))
    .map((filter) => predicate(filter, columnFor(dataset.columns, filter.column) as RawColumn));

  if (tests.length === 0) return dataset;

  const rows = dataset.rows.filter((row) => tests.every((test) => test(row)));
  return { ...dataset, rows, rowCount: rows.length };
}

/**
 * The distinct values of a category column, most frequent first — the
 * suggestions offered while typing a category filter, so "Food" is a pick
 * rather than a spelling test.
 */
export function suggestions(dataset: RawDataset, columnKey: string, limit = 50): string[] {
  const counts = new Map<string, number>();
  for (const row of dataset.rows) {
    const value = toCategory(row[columnKey]);
    if (value === BLANK) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}
