import { FormEvent, useEffect, useRef, useState } from 'react';

import { WatchlistItem } from '../types';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Textarea,
  decimalToInput,
  parseDecimal,
} from './ui';

export interface WatchlistPayload {
  symbol: string;
  category: string;
  targetPrice: number;
  note: string;
}

/** Raw strings while typing; parsed once, on submit. */
interface FormState {
  symbol: string;
  category: string;
  targetPrice: string;
  note: string;
}

function initialState(entry?: WatchlistItem, defaultCategory = ''): FormState {
  return {
    symbol: entry?.symbol ?? '',
    category: entry?.category ?? defaultCategory,
    targetPrice: decimalToInput(entry?.targetPrice),
    note: entry?.note ?? '',
  };
}

/**
 * Add or edit a watched symbol.
 *
 * Only the ticker is required. A target price and a note are the two things
 * that turn a list of symbols into a reason for each one being there, but
 * forcing them at the moment of adding would just get zeros typed in.
 *
 * Category is a free-text input backed by a `<datalist>` rather than a select:
 * picking from what you already use and inventing a new one are the same
 * gesture, so there is no "add new category" mode to find.
 */
export function WatchlistForm({
  open,
  entry,
  categories,
  /** Pre-selects the section the user was looking at when they pressed add. */
  defaultCategory,
  /** Returns the existing row when this ticker is already watched. */
  findBySymbol,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  entry?: WatchlistItem;
  categories: string[];
  defaultCategory?: string;
  findBySymbol: (symbol: string) => WatchlistItem | undefined;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: WatchlistPayload) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(entry, defaultCategory));
  const [localError, setLocalError] = useState<string | null>(null);

  /* Reset only when the sheet opens onto a different record — `categories` is
     rebuilt on every background revalidation, and depending on it would wipe a
     half-typed form under the user. Same rule as the other forms here. */
  const defaultsRef = useRef(defaultCategory);
  defaultsRef.current = defaultCategory;

  useEffect(() => {
    if (open) {
      setForm(initialState(entry, defaultsRef.current));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* The server rejects a duplicate with a 409. Catching it here means the user
     finds out while typing rather than after a round trip. */
  const clash = form.symbol.trim() ? findBySymbol(form.symbol) : undefined;
  const duplicate = Boolean(clash && clash.id !== entry?.id);

  async function submit(event: FormEvent) {
    event.preventDefault();

    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) {
      setLocalError('Enter a ticker symbol');
      return;
    }
    if (duplicate) {
      setLocalError(`${symbol} is already on your watchlist under "${clash?.category}"`);
      return;
    }
    setLocalError(null);

    try {
      await onSubmit({
        symbol,
        category: form.category.trim(),
        targetPrice: parseDecimal(form.targetPrice),
        note: form.note.trim(),
      });
    } catch {
      /* parent shows `error` */
    }
  }

  return (
    <Modal
      open={open}
      title={entry ? `Edit ${entry.symbol}` : 'Add to watchlist'}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={duplicate}>
            {entry ? 'Save' : 'Add symbol'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field
          label="Symbol"
          className="span-2"
          hint="Ticker as the quote provider expects it, e.g. AAPL."
        >
          <Input
            value={form.symbol}
            onChange={(e) => patch('symbol', e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={20}
            required
            autoFocus={!entry}
          />
        </Field>

        <Field
          label="Category"
          className="span-2"
          hint="Type a new one or pick one you already use. Blank becomes “Watching”."
        >
          <Input
            value={form.category}
            onChange={(e) => patch('category', e.target.value)}
            placeholder="Watching"
            maxLength={40}
            list="watchlist-categories"
            autoFocus={Boolean(entry)}
          />
          {/* Free text with suggestions: choosing an existing category and
              inventing one are the same gesture. */}
          <datalist id="watchlist-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Target price"
          className="span-2"
          hint="Optional. The price you are waiting for — up or down. The row flags when it gets close."
        >
          <DecimalInput
            value={form.targetPrice}
            onChange={(raw) => patch('targetPrice', raw)}
            placeholder="Leave blank for no target"
          />
        </Field>

        <Field label="Note" className="span-2" hint="Why you are watching it.">
          <Textarea
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            maxLength={300}
            placeholder="Waiting for the post-earnings dip"
          />
        </Field>

        {duplicate && (
          <div className="span-2">
            <Alert tone="warning" title={`${form.symbol.trim().toUpperCase()} is already watched`}>
              It is on your list under “{clash?.category}”. Edit that entry instead of adding a
              second one — two rows for the same ticker would show the same price twice.
            </Alert>
          </div>
        )}

        {(localError || error) && !duplicate && (
          <div className="span-2">
            <Alert tone="error">{localError || error}</Alert>
          </div>
        )}

        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
