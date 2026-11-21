import { Check, FileText, Plus, Search, X } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useExcelDB } from '../../hooks/useExcelDB';
import { useNotes } from '../../hooks/useNotes';
import { cx, formatDate, todayKey } from '../../lib/format';
import { matchesNoteSearch } from '../../lib/notes';
import { addLabel, type LabelError, LABEL_LEN, LABELS_MAX, labelSuggestions, LINKS_MAX, removeLabel } from '../../lib/planning/cardFields';
import type { PlanningStore } from '../../lib/planning/store';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { Transaction, WalletBalance } from '../../types';
import type { PlanMilestone } from '../../types/planning';
import { Icon } from '../Icon';
import { Button, Field, Input, Modal } from '../ui';

/* ---- Labels: chips, suggestions from the project, limits as they come up ---- */

export function LabelEditor({
  labels,
  known,
  onChange,
  autoFocus = false,
}: {
  labels: string[];
  known: string[];
  onChange: (labels: string[]) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState<LabelError | null>(null);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => labelSuggestions(known, labels, text), [known, labels, text]);
  const full = labels.length >= LABELS_MAX;

  const add = (raw: string) => {
    const result = addLabel(labels, raw);
    if (result.error) {
      setError(result.error === 'empty' ? null : result.error);
      return;
    }
    setError(null);
    setText('');
    setActive(-1);
    onChange(result.labels);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(active >= 0 && suggestions[active] ? suggestions[active] : text);
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Backspace' && !text && labels.length) {
      onChange(labels.slice(0, -1));
    }
  };

  const hint =
    error === 'tooLong'
      ? t('planning.labelTooLong', { max: LABEL_LEN })
      : error === 'duplicate'
        ? t('planning.labelDuplicate')
        : full || error === 'tooMany'
          ? t('planning.labelsFull', { max: LABELS_MAX })
          : labels.length >= LABELS_MAX - 3
            ? t('planning.labelsLeft', { count: LABELS_MAX - labels.length })
            : text.length > LABEL_LEN - 6
              ? t('planning.charsLeft', { count: Math.max(0, LABEL_LEN - text.length) })
              : null;

  return (
    <div className="plan-labels-edit">
      {labels.length > 0 && (
        <ul className="plan-chip-list" aria-label={t('planning.fieldLabels')}>
          {labels.map((label) => (
            <li key={label} className="plan-chip">
              <span>{label}</span>
              <button
                type="button"
                className="plan-chip-x"
                aria-label={t('planning.removeLabel', { label })}
                onClick={() => onChange(removeLabel(labels, label))}
              >
                <Icon icon={X} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="plan-label-add">
          <input
            ref={inputRef}
            className="control"
            value={text}
            autoFocus={autoFocus}
            maxLength={LABEL_LEN + 10}
            placeholder={t('planning.addLabel')}
            aria-label={t('planning.addLabel')}
            aria-autocomplete="list"
            enterKeyHint="enter"
            onChange={(e) => {
              /* Commas separate labels on the server: a pasted one becomes a space. */
              setText(e.target.value.replace(/,/g, ' '));
              setActive(-1);
              if (error !== 'tooMany') setError(null);
            }}
            onKeyDown={onKeyDown}
          />
          <Button size="sm" onClick={() => add(text)} disabled={!text.trim()}>
            {t('common.add')}
          </Button>
        </div>
      )}
      {hint && (
        <p className={cx('plan-hint', error && 'plan-hint--error')} role={error ? 'alert' : undefined}>
          {hint}
        </p>
      )}
      {suggestions.length > 0 && !full && (
        <div className="plan-suggest" role="listbox" aria-label={t('planning.labelSuggestions')}>
          {suggestions.map((label, i) => (
            <button
              key={label}
              type="button"
              role="option"
              aria-selected={i === active}
              className={cx('plan-suggest-chip', i === active && 'is-active')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(label)}
            >
              <Icon icon={Plus} size="sm" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LabelSheet({
  open,
  labels,
  known,
  onChange,
  onClose,
}: {
  open: boolean;
  labels: string[];
  known: string[];
  onChange: (labels: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t('planning.fieldLabels')}
      onClose={onClose}
      width={460}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('planning.done')}
        </Button>
      }
    >
      <LabelEditor labels={labels} known={known} onChange={onChange} autoFocus />
    </Modal>
  );
}

/* ---- Milestone: the project's open ones, or a new one ---- */

export function MilestoneSheet({
  open,
  projectId,
  milestones,
  value,
  store,
  onPick,
  onClose,
}: {
  open: boolean;
  projectId: string;
  milestones: PlanMilestone[];
  value: string;
  store: PlanningStore;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const shown = milestones.filter((m) => m.state === 'open' || m.id === value);

  const close = () => {
    setCreating(false);
    setTitle('');
    setDue('');
    onClose();
  };
  const create = () => {
    const clean = title.trim();
    if (!clean) return;
    const id = store.createMilestone(projectId, { title: clean, ...(due ? { dueDate: due } : {}) });
    onPick(id);
    close();
  };

  return (
    <Modal
      open={open}
      title={creating ? t('planning.newMilestone') : t('planning.fieldMilestone')}
      onClose={close}
      width={460}
      footer={
        creating ? (
          <>
            <Button onClick={() => setCreating(false)}>{t('planning.back')}</Button>
            <Button variant="primary" disabled={!title.trim()} onClick={create}>
              {t('common.create')}
            </Button>
          </>
        ) : undefined
      }
    >
      {creating ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field label={t('planning.fieldTitle')} className="span-2">
            <Input value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label={t('planning.fieldDueOptional')} className="span-2">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <button type="submit" hidden />
        </form>
      ) : (
        <div className="plan-move-list" role="radiogroup" aria-label={t('planning.fieldMilestone')}>
          <button
            type="button"
            role="radio"
            aria-checked={!value}
            className={cx('plan-move-option', !value && 'is-active')}
            onClick={() => {
              onPick('');
              close();
            }}
          >
            <span>{t('planning.noMilestone')}</span>
          </button>
          {shown.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={value === m.id}
              className={cx('plan-move-option', value === m.id && 'is-active')}
              onClick={() => {
                onPick(m.id);
                close();
              }}
            >
              <span className="plan-grow">{m.title}</span>
              {m.dueDate && <span className="plan-quiet">{formatDate(m.dueDate, settings.locale)}</span>}
            </button>
          ))}
          <button type="button" className="plan-move-option plan-move-option--new" onClick={() => setCreating(true)}>
            <Icon icon={Plus} size="sm" />
            <span>{t('planning.newMilestoneEllipsis')}</span>
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ---- Expenses: search, a date range, newest first ---- */

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function txLabel(tx: Pick<Transaction, 'note' | 'category'>, fallback: string): string {
  return tx.note.trim() || tx.category || fallback;
}

export function ExpensePicker({
  open,
  linked,
  wallets,
  onToggle,
  onClose,
}: {
  open: boolean;
  linked: string[];
  wallets: WalletBalance[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const today = todayKey();
  const [from, setFrom] = useState(() => shift(today, -90));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const range = from && to && from > to ? { from: to, to: from } : { from, to };
  const transactions = useExcelDB<Transaction>(
    'transactions',
    { from: range.from || undefined, to: range.to || undefined, limit: 2000 },
    { enabled: open },
  );
  const walletName = (id: string) => wallets.find((w) => w.id === id)?.name ?? '';
  const full = linked.length >= LINKS_MAX;

  const rows = useMemo(() => {
    const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return transactions.items
      .filter((tx) => tx.type === 'expense')
      .filter((tx) => {
        if (!words.length) return true;
        const hay = `${tx.note} ${tx.category} ${walletName(tx.walletId)} ${tx.amount}`.toLocaleLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- walletName reads wallets
  }, [transactions.items, search, wallets]);

  return (
    <Modal
      open={open}
      title={t('planning.linkExpense')}
      onClose={onClose}
      width={560}
      className="plan-picker"
      footer={
        <>
          <span className="plan-sheet-aside plan-quiet">{t('planning.linkedCount', { count: linked.length, max: LINKS_MAX })}</span>
          <Button variant="primary" onClick={onClose}>
            {t('planning.done')}
          </Button>
        </>
      }
    >
      <div className="plan-picker-tools">
        <label className="plan-search">
          <Icon icon={Search} size="sm" />
          <input
            type="search"
            value={search}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            enterKeyHint="search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="plan-range">
          <Field label={t('planning.rangeFrom')}>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('planning.rangeTo')}>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {full && <p className="plan-hint plan-hint--error">{t('planning.linksFull', { max: LINKS_MAX })}</p>}
      </div>
      {transactions.loading && !transactions.items.length ? (
        <ul className="plan-tx-list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="plan-tx-sk" />
          ))}
        </ul>
      ) : rows.length ? (
        <ul className="plan-tx-list">
          {rows.map((tx) => {
            const on = linked.includes(tx.id);
            return (
              <li key={tx.id}>
                <button
                  type="button"
                  className={cx('plan-tx', on && 'is-linked')}
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => onToggle(tx.id)}
                >
                  <span className={cx('plan-tx-check', on && 'is-on')} aria-hidden="true">
                    {on && <Icon icon={Check} size="sm" />}
                  </span>
                  <span className="plan-tx-body">
                    <span className="plan-tx-title">{txLabel(tx, t('planning.expense'))}</span>
                    <span className="plan-tx-meta">
                      {formatDate(tx.date, settings.locale)}
                      {walletName(tx.walletId) && ` · ${walletName(tx.walletId)}`}
                      {tx.note.trim() && tx.category && ` · ${tx.category}`}
                    </span>
                  </span>
                  <span className="plan-tx-amount">{money(tx.amount)}</span>
                  {on && <span className="sr-only">{t('planning.linked')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="plan-quiet plan-picker-empty">{t('planning.noExpenses')}</p>
      )}
    </Modal>
  );
}

/* ---- A note, by title ---- */

export function NotePicker({
  open,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const notes = useNotes({ enabled: open });
  const [search, setSearch] = useState('');
  const rows = useMemo(
    () => notes.items.filter((n) => matchesNoteSearch({ ...n, body: '' }, search)).slice(0, 200),
    [notes.items, search],
  );
  return (
    <Modal open={open} title={t('planning.linkNote')} onClose={onClose} width={520} className="plan-picker">
      <div className="plan-picker-tools">
        <label className="plan-search">
          <Icon icon={Search} size="sm" />
          <input
            type="search"
            value={search}
            autoFocus
            placeholder={t('planning.searchNotes')}
            aria-label={t('planning.searchNotes')}
            enterKeyHint="search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {notes.loading && !notes.items.length ? (
        <ul className="plan-tx-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="plan-tx-sk" />
          ))}
        </ul>
      ) : rows.length ? (
        <ul className="plan-tx-list">
          {rows.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={cx('plan-tx', note.id === value && 'is-linked')}
                aria-pressed={note.id === value}
                onClick={() => {
                  onPick(note.id);
                  onClose();
                }}
              >
                <span className="plan-tx-check plan-tx-check--icon" aria-hidden="true">
                  <Icon icon={note.id === value ? Check : FileText} size="sm" />
                </span>
                <span className="plan-tx-body">
                  <span className="plan-tx-title">{note.title || t('notes.untitled')}</span>
                  <span className="plan-tx-meta">{formatDate(note.updatedAt.slice(0, 10), settings.locale)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="plan-quiet plan-picker-empty">{t('planning.noNotesFound')}</p>
      )}
    </Modal>
  );
}
