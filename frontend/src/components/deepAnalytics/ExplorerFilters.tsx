import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { TranslationKey } from '../../locales';
import { RawColumn, RawDataset, columnFor } from '../../lib/explorerData';
import {
  Filter,
  FilterOperator,
  OPERATORS_FOR,
  isActive,
  newFilter,
  retarget,
  suggestions,
} from '../../lib/explorerFilters';

/**
 * The filter list: add a condition, pick a column, an operator and a value.
 *
 * Every row edits in place and applies as soon as it is complete. There is no
 * Apply button — the chart already recomputes in a few milliseconds, and a
 * button between typing and seeing would only add a step in which the screen
 * shows something other than what the controls say.
 */

const OPERATOR_KEY: Record<FilterOperator, TranslationKey> = {
  eq: 'explorer.opEq',
  neq: 'explorer.opNeq',
  gt: 'explorer.opGt',
  lt: 'explorer.opLt',
  contains: 'explorer.opContains',
};

const DATE_OPERATOR_KEY: Partial<Record<FilterOperator, TranslationKey>> = {
  gt: 'explorer.opAfter',
  lt: 'explorer.opBefore',
};

export function ExplorerFilters({
  dataset,
  filters,
  onChange,
  matched,
}: {
  dataset: RawDataset | null;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  /** Rows surviving the filters, for the count under the list. */
  matched: number | null;
}) {
  const { t } = useTranslation();
  const columns = dataset?.columns ?? [];
  const active = filters.filter((filter) => isActive(filter, columns)).length;

  const update = (id: string, next: Filter) =>
    onChange(filters.map((filter) => (filter.id === id ? next : filter)));

  return (
    <div className="xp-filters">
      {filters.length === 0 ? (
        <p className="xp-field-hint">{t('explorer.noFilters')}</p>
      ) : (
        <>
          {filters.length > 1 && <p className="xp-field-hint">{t('explorer.filtersMatchAll')}</p>}
          <ul className="xp-filter-list">
            {filters.map((filter, index) => (
              <FilterRow
                key={filter.id}
                index={index}
                filter={filter}
                dataset={dataset}
                columns={columns}
                onChange={(next) => update(filter.id, next)}
                onRemove={() => onChange(filters.filter((f) => f.id !== filter.id))}
              />
            ))}
          </ul>
        </>
      )}

      <div className="xp-filter-footer">
        <button
          type="button"
          className="xp-add-filter"
          disabled={!dataset}
          onClick={() => onChange([...filters, newFilter()])}
        >
          <Icon icon={Plus} size="sm" />
          {t('explorer.addFilter')}
        </button>
        {active > 0 && matched !== null && dataset && (
          <span className="xp-filter-count" aria-live="polite">
            {t('explorer.filteredCount', { shown: matched, total: dataset.rowCount })}
          </span>
        )}
      </div>
    </div>
  );
}

function FilterRow({
  index,
  filter,
  dataset,
  columns,
  onChange,
  onRemove,
}: {
  index: number;
  filter: Filter;
  dataset: RawDataset | null;
  columns: RawColumn[];
  onChange: (next: Filter) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const column = columnFor(columns, filter.column);
  const operators = column ? OPERATORS_FOR[column.kind] : [];
  const complete = isActive(filter, columns);
  const base = `xp-filter-${filter.id}`;
  const listId = `${base}-values`;

  return (
    <li className={complete ? 'xp-filter is-active' : 'xp-filter'}>
      <div className="xp-filter-head">
        <span className="xp-filter-index">{t('explorer.filterN', { n: index + 1 })}</span>
        <button
          type="button"
          className="xp-filter-remove"
          onClick={onRemove}
          aria-label={t('explorer.removeFilter', { n: index + 1 })}
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>

      <label className="sr-only" htmlFor={`${base}-col`}>
        {t('explorer.filterColumn')}
      </label>
      <select
        id={`${base}-col`}
        value={filter.column ?? ''}
        onChange={(event) =>
          onChange(retarget(filter, columnFor(columns, event.target.value || null), column))
        }
      >
        <option value="">{t('explorer.chooseColumn')}</option>
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.header}
          </option>
        ))}
      </select>

      <div className="xp-filter-condition">
        <label className="sr-only" htmlFor={`${base}-op`}>
          {t('explorer.filterOperator')}
        </label>
        <select
          id={`${base}-op`}
          value={filter.operator}
          disabled={!column}
          onChange={(event) => onChange({ ...filter, operator: event.target.value as FilterOperator })}
        >
          {(column ? operators : (['eq'] as FilterOperator[])).map((op) => (
            <option key={op} value={op}>
              {/* "Greater than 14 March" is not how anyone says it. */}
              {t((column?.kind === 'date' && DATE_OPERATOR_KEY[op]) || OPERATOR_KEY[op])}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`${base}-value`}>
          {t('explorer.filterValue')}
        </label>
        {column?.kind === 'boolean' ? (
          <select
            id={`${base}-value`}
            value={filter.value}
            onChange={(event) => onChange({ ...filter, value: event.target.value })}
          >
            <option value="">{t('explorer.chooseValue')}</option>
            <option value="true">{t('explorer.yes')}</option>
            <option value="false">{t('explorer.no')}</option>
          </select>
        ) : (
          <>
            <input
              id={`${base}-value`}
              type={column?.kind === 'date' ? 'date' : 'text'}
              inputMode={column?.kind === 'number' ? 'decimal' : undefined}
              value={filter.value}
              disabled={!column}
              placeholder={column ? t('explorer.valuePlaceholder') : ''}
              list={column?.kind === 'category' ? listId : undefined}
              onChange={(event) => onChange({ ...filter, value: event.target.value })}
            />
            {column?.kind === 'category' && dataset && (
              <datalist id={listId}>
                {suggestions(dataset, column.key).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
    </li>
  );
}
