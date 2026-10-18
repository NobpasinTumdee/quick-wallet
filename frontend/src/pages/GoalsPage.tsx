import { ChevronDown, PiggyBank, Plus, SearchX, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GoalCard } from '../components/GoalCard';
import { GoalForm, GoalPayload, SWATCHES } from '../components/GoalForm';
import { GoalPurchaseModal } from '../components/GoalPurchaseModal';
import { GoalReviewModal } from '../components/GoalReviewModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { GoalActionHandlers, GoalActionSheet } from '../components/goals/GoalActionSheet';
import { GoalFilterBar, GoalView } from '../components/goals/GoalFilterBar';
import { GoalFilterControls } from '../components/goals/GoalFilterControls';
import { GoalQuickAdd } from '../components/goals/GoalQuickAdd';
import { GoalSpendingSummary } from '../components/goals/GoalSpendingSummary';
import { GoalTable } from '../components/goals/GoalTable';
import '../components/goals/goals.css';
import {
  Alert,
  Button,
  Card,
  DecimalInput,
  EmptyState,
  Field,
  Modal,
  RefreshButton,
  parseDecimal,
} from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { useGoalFilters } from '../hooks/useGoalFilters';
import { useGoals } from '../hooks/useGoals';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { useStoredBoolean } from '../hooks/useStoredBoolean';
import { allocationSummary } from '../lib/goalMath';
import { GoalRow } from '../lib/goalFilters';
import { cx, formatPercent, todayKey } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Goal, WalletBalance } from '../types';

/**
 * Sinking funds — virtual envelopes.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE HEADER IS FOR
 * ---------------------------------------------------------------------------
 * Three figures, and the gap between the first and the third is the entire
 * feature: you hold X, you have promised Y, so you can actually spend Z. Every
 * other screen in this app answers "what do I have"; this is the only one that
 * answers "what is actually free".
 *
 * Funding writes no Transaction and moves no balance — see `lib/goalMath.ts`.
 * Buying does both, once, at the end of a goal's life: see `purchase` in
 * `useGoals`, and the wallet dialog it goes through.
 *
 * ---------------------------------------------------------------------------
 * TWO LAYOUTS
 * ---------------------------------------------------------------------------
 *   Phone    stacked: summary, a sticky search with quick chips, then the
 *            goals as cards. Every filter is in a bottom sheet; a card's
 *            secondary actions are behind "⋯".
 *   Desktop  every filter in a persistent panel that applies instantly, the
 *            spending breakdown inline, cards or a sortable table, and every
 *            action as a labelled button.
 *
 * The allocation header stays on top of both: a filter changes which goals
 * are listed, never how much of your cash is spoken for.
 */

interface FundTarget {
  goal: Goal;
  /** Adding or taking out — same sheet, opposite sign. */
  direction: 'add' | 'withdraw';
}

export function GoalsPage() {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const desktop = useMediaQuery(DESKTOP_QUERY);

  const goals = useGoals();
  const wallets = useExcelDB<WalletBalance>('wallets');
  const filter = useGoalFilters(goals.items, settings.locale);

  const [tableView, setTableView] = useStoredBoolean('quick-wallet.goals-table', false);
  const view: GoalView = tableView ? 'table' : 'cards';

  /* Completed goals need nothing from the user, so on a phone — where every
     card is a full screen-width of scrolling — they start folded away. */
  const [completedOpen, setCompletedOpen] = useState(desktop);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>();
  /** What quick-add had typed when "More options" was pressed. */
  const [draft, setDraft] = useState<Partial<GoalPayload> | undefined>();
  const [fundTarget, setFundTarget] = useState<FundTarget | null>(null);
  /** Raw string so a half-typed decimal survives; parsed on confirm. */
  const [fundAmount, setFundAmount] = useState('');

  /* The purchase flow: which goal is being bought, and out of what. */
  const [buying, setBuying] = useState<Goal | null>(null);
  const [payWalletId, setPayWalletId] = useState('');
  const [payDate, setPayDate] = useState(todayKey);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyBusy, setBuyBusy] = useState(false);

  /* The goal whose review is open, or null. Held as the row rather than its id
     so the modal seeds from the same object the card rendered — looking it up
     again would re-seed the form mid-edit on any background refresh. */
  const [reviewing, setReviewing] = useState<Goal | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  /** The goal whose "⋯" sheet is open (phones). */
  const [menuGoal, setMenuGoal] = useState<Goal | null>(null);

  const allocation = allocationSummary(wallets.items, goals.items);

  /* A goal is bought with real cash, so a brokerage account is not an option —
     the server refuses `mode: 'investment'` outright, and offering it here
     would only let the user pick something that comes back as an error. */
  const payableFrom = useMemo(
    () => wallets.items.filter((w) => !w.archived && w.mode === 'expense'),
    [wallets.items],
  );

  /* Rotated so two goals added in a row do not share a colour. */
  const nextColor = SWATCHES[goals.items.length % SWATCHES.length];

  function openBuy(goal: Goal) {
    setBuying(goal);
    setBuyError(null);
    /* Defaulted to the fullest wallet: the one most likely to cover it, and
       the choice is one tap away in the dropdown either way. */
    const richest = [...payableFrom].sort((a, b) => b.balance - a.balance)[0];
    setPayWalletId(richest?.id ?? '');
    setPayDate(todayKey());
  }

  async function confirmBuy() {
    if (!buying || !payWalletId || buyBusy) return;
    setBuyBusy(true);
    setBuyError(null);
    try {
      const result = await goals.purchase(buying.id, payWalletId, { date: payDate });
      setBuying(null);
      toast.success(
        t('goals.purchaseDone', { title: result.goal.title, amount: money(result.transaction.amount) }),
        t('goals.purchased'),
      );
    } catch (error) {
      /* Kept in the dialog rather than toasted away: the wallet choice is
         still on screen and is the thing most likely to need changing. */
      setBuyError(error instanceof Error ? error.message : String(error));
    } finally {
      setBuyBusy(false);
    }
  }

  function openNew(initial?: Partial<GoalPayload>) {
    setEditing(undefined);
    setDraft({ color: nextColor, ...initial });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(undefined);
    setDraft(undefined);
    goals.clearMutationError();
  }

  async function quickCreate(payload: GoalPayload) {
    await goals.create(payload);
  }

  async function save(payload: GoalPayload) {
    if (editing) await goals.update(editing.id, payload);
    else await goals.create(payload);
    closeForm();
  }

  /* The goal awaiting confirmation, or null. The row rather than a boolean,
     because the dialog has to name what it is about to delete and a flag
     cannot say which one. */
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await goals.remove(deleting.id);
      setDeleting(null);
    } catch {
      /* useExcelDB toasted it and rolled the row back; the dialog stays open
         so the user can try again or cancel. */
    } finally {
      /* Cleared even on failure, so a server error leaves the dialog open with
         its button usable rather than spinning forever. */
      setDeleteBusy(false);
    }
  }

  function openFund(goal: Goal, direction: FundTarget['direction']) {
    setFundTarget({ goal, direction });
    // Prefilling the shortfall makes the common case one tap; withdrawing has
    // no equivalent obvious figure, so it starts blank.
    setFundAmount(direction === 'add' ? String(Math.max(0, goal.remaining) || '') : '');
  }

  const fundValue = parseDecimal(fundAmount);

  async function confirmFund() {
    if (!fundTarget || fundValue <= 0 || goals.mutating) return;
    const { goal, direction } = fundTarget;

    try {
      await goals.fund(goal, direction === 'add' ? fundValue : -fundValue);
      setFundTarget(null);
    } catch {
      /* useExcelDB toasted it; leave the sheet open so the amount survives. */
    }
  }

  const handlers: GoalActionHandlers = {
    onFund: (goal) => openFund(goal, 'add'),
    onWithdraw: (goal) => openFund(goal, 'withdraw'),
    onBuy: openBuy,
    onReview: setReviewing,
    onEdit: (goal) => {
      setEditing(goal);
      setDraft(undefined);
      setFormOpen(true);
    },
    onDelete: setDeleting,
  };

  const hasPurchases = filter.rows.some((row) => row.goal.purchased);
  const filtered = filter.chips.length > 0;

  function renderCard(row: GoalRow) {
    const { goal } = row;
    return (
      <GoalCard
        key={goal.id}
        goal={goal}
        spend={row.spend}
        onFund={() => handlers.onFund(goal)}
        onWithdraw={() => handlers.onWithdraw(goal)}
        onBuy={() => handlers.onBuy(goal)}
        onEdit={() => handlers.onEdit(goal)}
        onDelete={() => handlers.onDelete(goal)}
        onReview={goal.purchased ? () => handlers.onReview(goal) : undefined}
        onMore={desktop ? undefined : () => setMenuGoal(goal)}
      />
    );
  }

  if (goals.initialLoading || wallets.initialLoading) {
    return <GoalsSkeleton />;
  }

  /* When the active section is empty — a "Completed" filter, or everything
     bought — the completed list is the whole answer and is never folded. */
  const showCompleted = completedOpen || filter.activeRows.length === 0;

  return (
    <>
      {/* ---- Cash vs locked vs available ---- */}
      <section className="alloc">
        <div className="alloc-figures">
          <div className="alloc-figure">
            <span className="section-label">{t('goals.totalCash')}</span>
            <strong>{money(allocation.totalCash)}</strong>
            <span className="alloc-hint">{t('goals.totalCashHint')}</span>
          </div>
          <div className="alloc-figure alloc-figure--locked">
            <span className="section-label">{t('goals.lockedInGoals')}</span>
            <strong>{money(allocation.locked)}</strong>
            <span className="alloc-hint">{t('goals.lockedInGoalsHint')}</span>
          </div>
          <div
            className={cx('alloc-figure', 'alloc-figure--available', allocation.overCommitted && 'is-over')}
          >
            <span className="section-label">{t('goals.availableToSpend')}</span>
            <strong>{money(allocation.available)}</strong>
            <span className="alloc-hint">{t('goals.availableToSpendHint')}</span>
          </div>
        </div>

        {/* One bar, two parts: promised and free. The whole is your cash. */}
        <div
          className="alloc-bar"
          style={{ '--locked': `${allocation.lockedPercent}%` } as React.CSSProperties}
          role="img"
          aria-label={`${formatPercent(allocation.lockedPercent, 0)} ${t('goals.lockedInGoals')}`}
        >
          <span className="alloc-bar-locked" />
        </div>
      </section>

      {allocation.overCommitted && (
        <Alert tone="warning" title={t('goals.overCommitted')}>
          {t('goals.overCommittedHint')}
        </Alert>
      )}

      <div className={cx('goals-layout', desktop && goals.items.length > 0 && 'has-panel')}>
        {/* ---- Desktop: every filter, always visible, applied instantly ---- */}
        {desktop && goals.items.length > 0 && (
          <aside className="goals-panel" aria-label={t('goals.filtersTitle')}>
            <div className="goals-panel-head">
              <h2>{t('goals.filters')}</h2>
              {filtered && (
                <Button size="sm" variant="ghost" onClick={filter.clearAll}>
                  {t('goals.clearAll')}
                </Button>
              )}
            </div>
            <GoalFilterControls
              filters={filter.filters}
              onChange={filter.update}
              onPreset={filter.replace}
              wallets={wallets.items}
              walletOptions={filter.walletOptions}
              categoryOptions={filter.categoryOptions}
            />
          </aside>
        )}

        <div className="goals-main">
          {hasPurchases && (
            <GoalSpendingSummary
              summary={filter.summary}
              filters={filter.filters}
              filtered={filtered}
              wallets={wallets.items}
              desktop={desktop}
              loading={filter.spendLoading}
            />
          )}

          {goals.items.length > 0 && (
            <GoalFilterBar
              state={filter}
              wallets={wallets.items}
              desktop={desktop}
              view={view}
              onView={(next) => setTableView(next === 'table')}
              total={filter.rows.length}
            />
          )}

          <Card
            title={t('goals.title')}
            subtitle={t('goals.subtitle')}
            actions={
              <>
                <RefreshButton
                  onRefresh={() => Promise.all([goals.refresh(), wallets.refresh(), filter.refreshSpend()])}
                  busy={goals.isValidating || wallets.isValidating}
                  label={t('common.refresh')}
                />
                <Button size="sm" variant="primary" onClick={() => openNew()}>
                  <Icon icon={Plus} size="sm" />
                  {t('goals.addGoal')}
                </Button>
              </>
            }
            padded={false}
          >
            {goals.mutationError && !formOpen && (
              <div className="goals-card-alert">
                <Alert tone="error" onDismiss={goals.clearMutationError}>
                  {goals.mutationError}
                </Alert>
              </div>
            )}

            {goals.items.length === 0 ? (
              <>
                <EmptyState
                  icon={<Icon icon={PiggyBank} size="xl" />}
                  title={t('goals.empty')}
                  description={t('goals.emptyHint')}
                />
                <div className="goals-quick-wrap">
                  <GoalQuickAdd color={nextColor} onCreate={quickCreate} onMore={openNew} />
                </div>
              </>
            ) : (
              <>
                <div className="goals-quick-wrap">
                  <GoalQuickAdd color={nextColor} onCreate={quickCreate} onMore={openNew} />
                </div>

                {filter.visible.length === 0 ? (
                  <EmptyState
                    icon={<Icon icon={SearchX} size="xl" />}
                    title={t('goals.noResults')}
                    description={t('goals.noResultsHint')}
                    action={
                      <Button variant="primary" onClick={filter.clearAll}>
                        {t('goals.clearFilters')}
                      </Button>
                    }
                  />
                ) : desktop && view === 'table' ? (
                  <GoalTable
                    rows={filter.visible}
                    filters={filter.filters}
                    onSort={filter.update}
                    handlers={handlers}
                  />
                ) : (
                  <>
                    {filter.activeRows.length > 0 && (
                      <section className="goal-section" aria-labelledby="goal-section-active">
                        <h3 className="goal-section-head" id="goal-section-active">
                          {t('goals.sectionActive')}
                          <span className="goal-section-count">{filter.activeRows.length}</span>
                        </h3>
                        <div className="goal-grid">{filter.activeRows.map(renderCard)}</div>
                      </section>
                    )}

                    {filter.completedRows.length > 0 && (
                      <section className="goal-section goal-section--done" aria-labelledby="goal-section-done">
                        <h3 className="goal-section-head" id="goal-section-done">
                          <button
                            type="button"
                            className="goal-section-toggle"
                            aria-expanded={showCompleted}
                            aria-controls="goal-section-done-list"
                            onClick={() => setCompletedOpen(!showCompleted)}
                            disabled={filter.activeRows.length === 0}
                          >
                            {t('goals.sectionCompleted')}
                            <span className="goal-section-count">{filter.completedRows.length}</span>
                            {filter.activeRows.length > 0 && (
                              <Icon
                                icon={ChevronDown}
                                size="sm"
                                className={cx('goal-section-caret', showCompleted && 'is-open')}
                              />
                            )}
                          </button>
                        </h3>
                        {showCompleted && (
                          <div className="goal-grid" id="goal-section-done-list">
                            {filter.completedRows.map(renderCard)}
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </Card>
        </div>
      </div>

      <GoalActionSheet goal={menuGoal} onClose={() => setMenuGoal(null)} handlers={handlers} />

      <ConfirmDialog
        open={deleting !== null}
        title={t('goals.deleteTitle')}
        /* The goal's own name above the generic warning: the warning explains
           the consequence, this says which row it applies to. */
        body={
          <>
            <strong className="confirm-subject">{deleting?.title}</strong>
            {t('goals.deleteWarning')}
          </>
        }
        confirmLabel={t('goals.deleteConfirmAction')}
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />

      <GoalReviewModal
        open={reviewing !== null}
        goal={reviewing ?? undefined}
        busy={reviewBusy}
        onClose={() => setReviewing(null)}
        onSubmit={(review) => {
          if (!reviewing || reviewBusy) return;
          setReviewBusy(true);
          /* Closed on success only. A review is typed, not picked, and
             dropping the dialog before the write lands would lose the text
             with nowhere to recover it from. */
          goals
            .reviewGoal(reviewing.id, review)
            .then(() => setReviewing(null))
            .catch(() => {
              /* useExcelDB toasted it; the dialog keeps the typed review. */
            })
            .finally(() => setReviewBusy(false));
        }}
      />

      <GoalPurchaseModal
        goal={buying}
        wallets={payableFrom}
        walletId={payWalletId}
        onWalletId={setPayWalletId}
        date={payDate}
        onDate={setPayDate}
        busy={buyBusy}
        error={buyError}
        onClose={() => setBuying(null)}
        onConfirm={() => void confirmBuy()}
      />

      <GoalForm
        open={formOpen}
        goal={editing}
        draft={draft}
        busy={goals.mutating}
        error={goals.mutationError}
        onClose={closeForm}
        onSubmit={save}
      />

      {/* ---- Fund / withdraw ---- */}
      <Modal
        open={Boolean(fundTarget)}
        title={
          fundTarget?.direction === 'withdraw'
            ? t('goals.withdrawTitle', { title: fundTarget?.goal.title ?? '' })
            : t('goals.fundTitle', { title: fundTarget?.goal.title ?? '' })
        }
        onClose={() => setFundTarget(null)}
        width={400}
        footer={
          <>
            <Button onClick={() => setFundTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={goals.mutating}
              disabled={fundValue <= 0}
              onClick={() => void confirmFund()}
            >
              {fundTarget?.direction === 'withdraw'
                ? t('goals.withdrawConfirm')
                : t('goals.fundConfirm')}
            </Button>
          </>
        }
      >
        {fundTarget && (
          <>
            <Field
              label={
                fundTarget.direction === 'withdraw'
                  ? t('goals.withdrawAmount')
                  : t('goals.fundAmount')
              }
              hint={
                fundTarget.direction === 'withdraw' ? t('goals.withdrawHint') : t('goals.fundHint')
              }
            >
              <DecimalInput
                value={fundAmount}
                onChange={setFundAmount}
                placeholder="0.00"
                autoFocus
              />
            </Field>

            {fundTarget.direction === 'withdraw' && fundTarget.goal.savedAmount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFundAmount(String(fundTarget.goal.savedAmount))}
              >
                {t('goals.withdrawAll')}
              </Button>
            )}

            <p className="field-hint" style={{ marginTop: 10 }}>
              <Icon icon={Target} size="sm" />{' '}
              {t('goals.saved', {
                saved: money(
                  Math.max(
                    0,
                    fundTarget.goal.savedAmount +
                      (fundTarget.direction === 'add' ? fundValue : -fundValue),
                  ),
                ),
                target: money(fundTarget.goal.targetAmount),
              })}
            </p>
          </>
        )}
      </Modal>
    </>
  );
}

/**
 * The page's own shape, shimmering: the allocation strip and three cards.
 * Sized like the real thing so nothing jumps when the data lands.
 */
function GoalsSkeleton() {
  return (
    <div className="goals-skeleton" aria-busy="true">
      <div className="alloc sk-card">
        <div className="alloc-figures">
          {[0, 1, 2].map((i) => (
            <div key={i} className="alloc-figure">
              <span className="sk" style={{ width: '45%', height: 10 }} />
              <span className="sk sk-strong" style={{ width: '70%', height: 26 }} />
            </div>
          ))}
        </div>
        <span className="sk" style={{ width: '100%', height: 8 }} />
      </div>
      <div className="goal-grid goal-grid--skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="goal-card sk-card">
            <span className="sk sk-strong" style={{ width: '60%', height: 16 }} />
            <span className="sk" style={{ width: '100%', height: 8 }} />
            <span className="sk" style={{ width: '40%', height: 12 }} />
            <span className="sk" style={{ width: '50%', height: 30, marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
