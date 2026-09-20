import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  Inbox as InboxIcon,
  Plus,
  SlidersHorizontal,
  StickyNote,
  X,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { TransactionForm, TransactionPayload } from './TransactionForm';
import { Alert, Button, DecimalInput, Input, Modal, Select, parseDecimal } from './ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { useInbox } from '../hooks/useInbox';
import { isDueSoon, isOverdue, prefillFor } from '../lib/inbox';
import { cx, formatDate, todayKey } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { InboxItem, InboxType, Transaction, WalletBalance } from '../types';

/**
 * The financial inbox, as a dashboard widget.
 *
 * ---------------------------------------------------------------------------
 * WHY CAPTURE COMES FIRST
 * ---------------------------------------------------------------------------
 * The input sits at the top and needs exactly one thing: a line of text. Every
 * other field is behind a toggle. That ordering is the whole feature — "Mai
 * owes me 300" gets written down in the two seconds someone has while leaving
 * a restaurant, or it does not get written down at all, and a form that asks
 * which wallet and which category first is a form that loses the note.
 *
 * ---------------------------------------------------------------------------
 * RESOLVING, AND THE ONE QUESTION IT ASKS
 * ---------------------------------------------------------------------------
 * Ticking an item off closes it. If the item has an amount and a direction,
 * the money may or may not have actually moved — paying Mai back and deciding
 * the debt is forgotten look identical from here — so it asks once, and takes
 * either answer at face value:
 *
 *   Yes → the ordinary transaction form, prefilled, with wallet and category
 *         still to choose; the item is resolved with the new entry's id
 *   No  → the item is simply closed, and nothing is written to the ledger
 *
 * The question is skipped entirely for a plain note, which has nothing to
 * record. A dialog with one sensible answer is a dialog that trains people to
 * dismiss dialogs.
 */

const TYPE_ICON: Record<InboxType, typeof StickyNote> = {
  'to-pay': ArrowUpRight,
  'to-receive': ArrowDownLeft,
  note: StickyNote,
};

export function FinancialInboxWidget({ wallets }: { wallets: WalletBalance[] }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const inbox = useInbox();
  const transactions = useExcelDB<Transaction>('transactions');

  /* ---- Capture ---- */
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<InboxType>('note');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  /* ---- Resolve ---- */
  const [asking, setAsking] = useState<InboxItem | null>(null);
  const [converting, setConverting] = useState<InboxItem | null>(null);

  const today = todayKey();
  const pending = inbox.pending;

  function resetCapture() {
    setText('');
    setAmount('');
    setDueDate('');
    setType('note');
    setExpanded(false);
  }

  async function submitCapture(event: FormEvent) {
    event.preventDefault();
    const line = text.trim();
    if (!line) return;

    const value = parseDecimal(amount);
    try {
      await inbox.add({
        text: line,
        amount: value > 0 ? value : 0,
        dueDate: dueDate || undefined,
        /* An amount typed without a direction is still a note about money, but
           it cannot be converted into one — so the default becomes "to pay",
           which is what an amount you wrote down usually is. The user can flip
           it in the same breath. */
        type: value > 0 && type === 'note' ? 'to-pay' : type,
      });
      resetCapture();
    } catch {
      /* useExcelDB toasted it; the text stays so nothing typed is lost. */
    }
  }

  /** The checkbox. Asks about the money only when there is money to ask about. */
  function tick(item: InboxItem) {
    if (item.convertible) setAsking(item);
    else void inbox.resolveItem(item.id);
  }

  async function recordTransaction(payload: TransactionPayload) {
    const item = converting;
    if (!item) return;
    const created = await transactions.create(payload);
    /* Resolved only once the entry exists, and with its id: an item closed
       before the write lands would leave the user with neither the reminder
       nor the transaction if the write then failed. */
    await inbox.resolveItem(item.id, created?.id);
    setConverting(null);
  }

  const prefill = converting ? prefillFor(converting, today) : null;

  return (
    <section className="inbox-widget" aria-labelledby="inbox-heading">
      <header className="inbox-head">
        <h2 id="inbox-heading">
          <Icon icon={InboxIcon} size="sm" />
          {t('inbox.title')}
        </h2>
        <p className="inbox-summary">
          {inbox.summary.pending === 0
            ? t('inbox.allClear')
            : [
                t('inbox.pendingCount', { count: inbox.summary.pending }),
                inbox.summary.owed > 0 ? t('inbox.owedSummary', { amount: money(inbox.summary.owed, { compact: true }) }) : '',
                inbox.summary.owedToYou > 0
                  ? t('inbox.owedToYouSummary', { amount: money(inbox.summary.owedToYou, { compact: true }) })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </header>

      {/* ---- Capture: one line, everything else behind the toggle ---- */}
      <form className="inbox-capture" onSubmit={submitCapture}>
        <div className="inbox-capture-row">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('inbox.placeholder')}
            aria-label={t('inbox.newItem')}
            maxLength={200}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cx('inbox-expand', expanded && 'is-active')}
            aria-expanded={expanded}
            aria-controls="inbox-capture-more"
            aria-label={t('inbox.moreOptions')}
            title={t('inbox.moreOptions')}
            onClick={() => setExpanded((open) => !open)}
          >
            <Icon icon={SlidersHorizontal} size="sm" />
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={!text.trim() || inbox.mutating}
            aria-label={t('inbox.add')}
            title={t('inbox.add')}
          >
            <Icon icon={Plus} size="sm" />
          </Button>
        </div>

        {expanded && (
          <div className="inbox-capture-more" id="inbox-capture-more">
            <Select
              value={type}
              aria-label={t('inbox.type')}
              onChange={(event) => setType(event.target.value as InboxType)}
            >
              <option value="note">{t('inbox.typeNote')}</option>
              <option value="to-pay">{t('inbox.typeToPay')}</option>
              <option value="to-receive">{t('inbox.typeToReceive')}</option>
            </Select>
            <DecimalInput value={amount} onChange={setAmount} placeholder={t('inbox.amount')} />
            <Input
              type="date"
              value={dueDate}
              aria-label={t('inbox.dueDate')}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        )}
      </form>

      {inbox.mutationError && (
        <Alert tone="error" onDismiss={inbox.clearMutationError}>
          {inbox.mutationError}
        </Alert>
      )}

      {/* ---- The list ---- */}
      {pending.length === 0 ? (
        <p className="inbox-empty">{t('inbox.empty')}</p>
      ) : (
        <ul className="inbox-list">
          {pending.map((item) => {
            const overdue = isOverdue(item, today);
            const soon = isDueSoon(item, today);

            return (
              <li key={item.id} className={cx('inbox-item', overdue && 'is-overdue')}>
                {/* A real checkbox: this is the one control on the widget that
                    changes state, and it has to be reachable by keyboard and
                    announced as checkable rather than as a button. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={false}
                  className="inbox-check"
                  aria-label={t('inbox.resolveItem', { text: item.text })}
                  onClick={() => tick(item)}
                >
                  <Icon icon={Check} size="sm" />
                </button>

                <span className={cx('inbox-kind', `is-${item.type}`)} aria-hidden="true">
                  <Icon icon={TYPE_ICON[item.type]} size="sm" />
                </span>

                <div className="inbox-body">
                  <span className="inbox-text">{item.text}</span>
                  {item.dueDate && (
                    <span className={cx('inbox-due', overdue && 'is-overdue', soon && 'is-soon')}>
                      <Icon icon={CalendarClock} size="sm" />
                      {overdue
                        ? t('inbox.overdue', { date: formatDate(item.dueDate, locale) })
                        : formatDate(item.dueDate, locale)}
                    </span>
                  )}
                </div>

                {item.amount > 0 && (
                  <span className={cx('inbox-amount', `is-${item.type}`)}>
                    {item.type === 'to-receive' ? '+' : item.type === 'to-pay' ? '−' : ''}
                    {money(item.amount)}
                  </span>
                )}

                <button
                  type="button"
                  className="inbox-remove"
                  aria-label={t('inbox.deleteItem', { text: item.text })}
                  onClick={() => void inbox.remove(item.id)}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- "Record this transaction now?" ---- */}
      <Modal
        open={Boolean(asking)}
        width={400}
        title={t('inbox.convertTitle')}
        onClose={() => setAsking(null)}
        footer={
          <>
            <Button
              onClick={() => {
                const item = asking;
                setAsking(null);
                if (item) void inbox.resolveItem(item.id);
              }}
            >
              {t('inbox.convertNo')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConverting(asking);
                setAsking(null);
              }}
            >
              {t('inbox.convertYes')}
            </Button>
          </>
        }
      >
        {asking && (
          <div className="stack">
            <p className="inbox-convert-line">
              <span>{asking.text}</span>
              <strong>{money(asking.amount)}</strong>
            </p>
            <p className="field-hint">
              {asking.type === 'to-pay' ? t('inbox.convertPayHint') : t('inbox.convertReceiveHint')}
            </p>
            <p className="field-hint">{t('inbox.convertNoHint')}</p>
          </div>
        )}
      </Modal>

      {/* The ordinary entry form, prefilled — wallet and category are still
          the user's to choose, because an inbox item cannot know either. */}
      <TransactionForm
        open={Boolean(converting && prefill)}
        wallets={wallets.filter((w) => !w.archived)}
        prefill={prefill ?? undefined}
        busy={transactions.mutating}
        error={transactions.mutationError}
        onClose={() => {
          setConverting(null);
          transactions.clearMutationError();
        }}
        onSubmit={recordTransaction}
      />
    </section>
  );
}
