import {
  type KeyboardEvent as ReactKeyboardEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '../ConfirmDialog';
import { NumberPadPanel, canPaste, padOptions } from '../NumberPad';
import { OverdraftWarningModal } from '../OverdraftWarningModal';
import type { TransactionPayload } from '../TransactionForm';
import { Button, Modal } from '../ui';
import { useExcelDB } from '../../hooks/useExcelDB';
import { type PadKey, applyPadKey, evaluatePad, padValueToRaw, pastedToPad, rawToPad } from '../../lib/amountExpr';
import {
  type EditResult,
  type Favourite,
  type FavouriteDraft,
  type FavouriteList,
  type FavouriteSort,
  type FavouriteStyle,
  FAVOURITES_SYNC_FORMAT,
  applyUsage,
  draftFromTransaction,
  duplicateFavourite,
  favouriteGroups,
  favouritePayload,
  favouriteProblem,
  moveFavourite,
  orderedFavourites,
  parseFavLink,
  placeFavourite,
  removeFavourite,
  upsertFavourite,
} from '../../lib/favourites';
import { formatMoney, todayKey } from '../../lib/format';
import { useSyncedLayout } from '../../lib/layout/useSyncedLayout';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { getRecentAmounts, recentKey, rememberAmount } from '../../lib/numberPad';
import { checkOverdraft } from '../../lib/overdraft';
import { toast } from '../../lib/toast';
import type { TranslationKey } from '../../locales/en';
import type { Transaction, WalletBalance } from '../../types';
import { useAuth } from '../../state/AuthContext';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';

/* Only loaded when opened: the card's tap path never needs them. */
const FavouriteEditor = lazyWithRetry(() =>
  import('./FavouriteEditor').then((m) => ({ default: m.FavouriteEditor })),
);
const ManageFavourites = lazyWithRetry(() =>
  import('./ManageFavourites').then((m) => ({ default: m.ManageFavourites })),
);

/** How long Undo is offered. */
export const UNDO_MS = 6000;
/** After a save settles, further taps on the same favourite wait this long. */
export const COOL_DOWN_MS = 1000;
/** Usage counts are written in one go this long after the last tap. */
const USAGE_FLUSH_MS = 15000;

const PAD_OPTIONS = padOptions('money', false);
const TYPE_LABEL: Record<Favourite['type'], TranslationKey> = {
  expense: 'forms.typeExpense',
  income: 'forms.typeIncome',
  transfer: 'forms.typeTransfer',
};

interface FavouritesApi {
  list: FavouriteList;
  /** In the card's order (manual or by usage). */
  ordered: Favourite[];
  wallets: WalletBalance[];
  /** Favourites saving right now (taps on them are ignored). */
  busy: ReadonlySet<string>;
  /** Talk to the server about favourites (set by whatever shows or edits them). */
  requestSync: () => void;
  /** The one-tap action. */
  run: (fav: Favourite) => void;
  /** The full form, filled in ("Save with changes", "More", a broken favourite). */
  openForm: (fav: Favourite, amount?: number | null) => void;
  openEditor: (target?: Favourite | FavouriteDraft) => void;
  openManage: () => void;
  remove: (id: string) => void;
  duplicate: (id: string) => EditResult;
  move: (id: string, delta: number) => void;
  place: (id: string, index: number) => void;
  setStyle: (style: FavouriteStyle) => void;
  setSort: (sort: FavouriteSort) => void;
  upsert: (draft: FavouriteDraft) => EditResult;
}

/* The host is mounted beside the app, not around it (it loads late, and
   wrapping the tree late would remount it), so it publishes its API here. */
let published: FavouritesApi | null = null;
const listeners = new Set<() => void>();
function publish(api: FavouritesApi | null) {
  published = api;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The favourites, for the card and the sheets. Null until the host is up
 * (the card shows its skeleton meanwhile). Pass `sync` from anything that
 * shows them.
 */
export function useFavourites(options: { sync?: boolean } = {}): FavouritesApi | null {
  const api = useSyncExternalStore(subscribe, () => published);
  const requestSync = api?.requestSync;
  const sync = options.sync === true;
  useEffect(() => {
    if (sync) requestSync?.();
  }, [sync, requestSync]);
  return api;
}

function stripFavLink(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('fav')) return;
    url.searchParams.delete('fav');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* nothing to clean */
  }
}

/** A request from the main bundle, waiting for the host to load. */
export type FavouritesRequest =
  | { kind: 'editor'; target?: FavouriteDraft }
  | { kind: 'fromTransaction'; tx: Parameters<typeof draftFromTransaction>[0] };

/**
 * The favourites store and the one-tap engine. Mounted beside the shell by
 * state/FavouritesContext the first time anything uses favourites.
 *
 *  - The list is this device's copy, synced through UiPrefs like a layout
 *    (lib/favourites.ts says where and why). Nothing is asked of the server
 *    until something shows or edits favourites, so Home without the card
 *    makes exactly the requests it made before.
 *  - A save goes through the same optimistic `transactions.create` as the
 *    New transaction form, so balances, budgets, goals and Activity update
 *    the same way. Undo deletes it through the normal delete.
 *  - Double taps: a favourite that is saving ignores taps until its save has
 *    settled, then for a further second. The server has no duplicate check
 *    for the app's own adds (only widgets send a clientId), so this is the guard.
 */
export function FavouritesHost({
  wallets,
  walletsLoading,
  onOpenForm,
  requests,
  onHandled,
}: {
  wallets: WalletBalance[];
  walletsLoading: boolean;
  onOpenForm: (prefill: Partial<TransactionPayload>) => void;
  requests: FavouritesRequest[];
  onHandled: (count: number) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const { user } = useAuth();

  const [syncWanted, setSyncWanted] = useState(false);
  const { layout: list, save, pull } = useSyncedLayout(FAVOURITES_SYNC_FORMAT, user?.id, syncWanted);
  const latest = useRef(list);
  latest.current = list;
  const requestSync = useCallback(() => setSyncWanted(true), []);

  /* Write-only, like the "+" button's: subscribing would fetch a list nothing here shows. */
  const transactions = useExcelDB<Transaction>('transactions', undefined, { enabled: false });

  /* ---- Usage counts, batched ---- */
  const pendingUsage = useRef(new Map<string, { uses: number; day: string }>());
  const usageTimer = useRef<number | null>(null);
  const flushUsage = useCallback(() => {
    if (usageTimer.current !== null) window.clearTimeout(usageTimer.current);
    usageTimer.current = null;
    if (pendingUsage.current.size === 0) return;
    const counts = pendingUsage.current;
    pendingUsage.current = new Map();
    const next = applyUsage(latest.current, counts);
    if (next !== latest.current) save(next);
  }, [save]);
  const countUse = useCallback(
    (id: string, delta: number) => {
      const map = pendingUsage.current;
      const day = todayKey();
      const current = map.get(id) ?? { uses: 0, day };
      const uses = current.uses + delta;
      if (uses <= 0) map.delete(id);
      else map.set(id, { uses, day });
      if (usageTimer.current !== null) window.clearTimeout(usageTimer.current);
      usageTimer.current = window.setTimeout(flushUsage, USAGE_FLUSH_MS);
    },
    [flushUsage],
  );
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushUsage();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushUsage);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushUsage);
    };
  }, [flushUsage]);

  /* ---- Editing the list ---- */
  const commitList = useCallback((next: FavouriteList) => save(next), [save]);
  const upsert = useCallback(
    (draft: FavouriteDraft) => {
      const result = upsertFavourite(latest.current, draft);
      if (result.ok) commitList(result.list);
      return result;
    },
    [commitList],
  );
  const remove = useCallback((id: string) => commitList(removeFavourite(latest.current, id)), [commitList]);
  const duplicate = useCallback(
    (id: string) => {
      const result = duplicateFavourite(latest.current, id, t('favourites.copySuffix'));
      if (result.ok) commitList(result.list);
      return result;
    },
    [commitList, t],
  );
  const move = useCallback(
    (id: string, delta: number) => {
      const next = moveFavourite(latest.current, id, delta);
      if (next !== latest.current) commitList(next);
    },
    [commitList],
  );
  const place = useCallback(
    (id: string, index: number) => {
      const next = placeFavourite(latest.current, id, index);
      if (next !== latest.current) commitList(next);
    },
    [commitList],
  );
  const setStyle = useCallback((style: FavouriteStyle) => commitList({ ...latest.current, style }), [commitList]);
  const setSort = useCallback((sort: FavouriteSort) => commitList({ ...latest.current, sort }), [commitList]);

  /* ---- Sheets ---- */
  const [editor, setEditor] = useState<{ target?: Favourite | FavouriteDraft } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const openEditor = useCallback(
    (target?: Favourite | FavouriteDraft) => {
      setSyncWanted(true);
      /* Edits are made on the newest copy: another device may have changed the list. */
      void pull();
      setEditor({ target });
    },
    [pull],
  );
  const openManage = useCallback(() => {
    setSyncWanted(true);
    void pull();
    setManageOpen(true);
  }, [pull]);

  const walletOf = useCallback((id: string) => wallets.find((wallet) => wallet.id === id) ?? null, [wallets]);

  const openForm = useCallback(
    (fav: Favourite, amount?: number | null) => {
      const payload = favouritePayload(fav, amount ?? fav.amount ?? 0, todayKey());
      onOpenForm({ ...payload, amount: payload.amount > 0 ? payload.amount : undefined });
    },
    [onOpenForm],
  );

  /* ---- Saving ---- */
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const blockedUntil = useRef(new Map<string, number>());
  const isBlocked = (id: string) => (blockedUntil.current.get(id) ?? 0) > Date.now();
  const block = (id: string, until: number) => {
    blockedUntil.current.set(id, until);
    setBusy((prev) => new Set(prev).add(id));
  };
  const release = (id: string) => {
    blockedUntil.current.set(id, Date.now() + COOL_DOWN_MS);
    window.setTimeout(() => {
      if ((blockedUntil.current.get(id) ?? 0) <= Date.now()) {
        blockedUntil.current.delete(id);
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }, COOL_DOWN_MS);
  };

  const describe = (fav: Favourite, amount: number) => {
    const from = walletOf(fav.walletId)?.name ?? '';
    const tail = fav.type === 'transfer' ? `${from} → ${walletOf(fav.toWalletId)?.name ?? ''}` : `${from} · ${fav.category}`;
    return `${money(amount)} · ${tail}`;
  };

  const [overdraft, setOverdraft] = useState<{ fav: Favourite; amount: number } | null>(null);
  const [confirm, setConfirm] = useState<{ fav: Favourite; amount: number } | null>(null);
  const [pad, setPad] = useState<{ fav: Favourite } | null>(null);
  const [expr, setExpr] = useState('');

  /** Saves now (every check already passed). */
  const commit = (fav: Favourite, amount: number) => {
    if (isBlocked(fav.id)) return;
    block(fav.id, Number.POSITIVE_INFINITY);
    const created = transactions.create(favouritePayload(fav, amount, todayKey()));
    countUse(fav.id, 1);
    rememberAmount(recentKey(fav.type, fav), amount);
    let undone = false;
    toast.success(describe(fav, amount), t('favourites.added', { name: fav.name }), {
      duration: UNDO_MS,
      action: {
        label: t('favourites.undo'),
        onClick: () => {
          if (undone) return;
          undone = true;
          countUse(fav.id, -1);
          created
            .then((row) => transactions.remove(row.id))
            .then(() => toast.info(t('favourites.undone', { name: fav.name })))
            .catch(() => undefined);
        },
      },
    });
    created
      .catch(() => {
        /* useExcelDB rolled it back and said why; it was not used. */
        countUse(fav.id, -1);
      })
      .finally(() => release(fav.id));
  };

  /** Checks the wallet, then saves or asks. */
  const attempt = (fav: Favourite, amount: number, confirmed = false) => {
    if (isBlocked(fav.id)) return;
    const wallet = walletOf(fav.walletId);
    const check = checkOverdraft({ wallet, type: fav.type, amount });
    if (check.warn && !confirmed) {
      setOverdraft({ fav, amount });
      return;
    }
    commit(fav, amount);
  };

  const problemText = (problem: 'wallet' | 'to' | 'category') =>
    t(problem === 'wallet' ? 'favourites.problemWallet' : problem === 'to' ? 'favourites.problemTo' : 'favourites.problemCategory');

  const run = (fav: Favourite) => {
    if (isBlocked(fav.id)) return;
    const problem = favouriteProblem(fav, wallets);
    if (problem) {
      toast.info(problemText(problem), fav.name);
      openForm(fav);
      return;
    }
    if (fav.amount === null) {
      setExpr('');
      setPad({ fav });
      return;
    }
    if (fav.ask) {
      setConfirm({ fav, amount: fav.amount });
      return;
    }
    attempt(fav, fav.amount);
  };
  const runRef = useRef(run);
  runRef.current = run;

  /* ---- ?fav=<id>: opens it (its confirm, or the number pad) — never saves silently ---- */
  const [linkId] = useState(() => parseFavLink(window.location.search));
  useEffect(() => {
    if (linkId) stripFavLink();
  }, [linkId]);
  const linkDone = useRef(false);
  useEffect(() => {
    if (!linkId || linkDone.current || walletsLoading || !user?.id) return;
    linkDone.current = true;
    setSyncWanted(true);
    void (async () => {
      if (!latest.current.favs.some((fav) => fav.id === linkId)) await pull();
      const fav = latest.current.favs.find((item) => item.id === linkId);
      if (!fav) {
        toast.info(t('favourites.linkMissing'));
        return;
      }
      if (fav.amount !== null && !favouriteProblem(fav, wallets)) setConfirm({ fav, amount: fav.amount });
      else runRef.current(fav);
    })();
  }, [linkId, walletsLoading, user?.id, pull, wallets, t]);

  /* ---- The amount sheet ---- */
  const padFav = pad?.fav ?? null;
  const result = evaluatePad(expr, PAD_OPTIONS);
  const padAmount = result.value ?? 0;
  const padValid = !result.error && padAmount > 0;
  const recents = useMemo(() => (padFav ? getRecentAmounts(recentKey(padFav.type, padFav)) : []), [padFav]);
  const press = (key: PadKey) => setExpr((current) => applyPadKey(current, key, PAD_OPTIONS));
  const closePad = () => setPad(null);
  const savePad = () => {
    if (!padFav || !padValid) return;
    const fav = padFav;
    setPad(null);
    attempt(fav, padAmount);
  };
  const onPadKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      savePad();
      return;
    }
    const key = /^\d$/.test(event.key)
      ? (event.key as PadKey)
      : event.key === '.' || event.key === ','
        ? '.'
        : event.key === '+'
          ? '+'
          : event.key === '-'
            ? '-'
            : event.key === 'Backspace'
              ? 'back'
              : null;
    if (key && !(event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter'))) {
      event.preventDefault();
      press(key);
    }
  };

  const api = useMemo<FavouritesApi>(
    () => ({
      list,
      ordered: orderedFavourites(list),
      wallets,
      busy,
      requestSync,
      run: (fav) => runRef.current(fav),
      openForm,
      openEditor,
      openManage,
      remove,
      duplicate,
      move,
      place,
      setStyle,
      setSort,
      upsert,
    }),
    [list, wallets, busy, requestSync, openForm, openEditor, openManage, remove, duplicate, move, place, setStyle, setSort, upsert],
  );

  useEffect(() => {
    publish(api);
  }, [api]);
  useEffect(() => () => publish(null), []);

  /* Requests made before this chunk arrived, and any after. */
  useEffect(() => {
    if (requests.length === 0) return;
    for (const request of requests) {
      openEditor(request.kind === 'editor' ? request.target : draftFromTransaction(request.tx));
    }
    onHandled(requests.length);
  }, [requests, openEditor, onHandled]);

  const overdraftFav = overdraft?.fav ?? null;
  const overdraftCheck = checkOverdraft({
    wallet: overdraftFav ? walletOf(overdraftFav.walletId) : null,
    type: overdraftFav?.type ?? 'income',
    amount: overdraft?.amount ?? 0,
  });

  return (
    <>

      {/* The amount, when the favourite has none: everything else is filled in. */}
      <Modal open={padFav !== null} title={padFav?.name ?? ''} onClose={closePad} width={380}>
        {padFav && (
          <div className="fav-pad" tabIndex={-1} data-autofocus onKeyDown={onPadKey}>
            <NumberPadPanel
              className="fav-pad-panel"
              expr={expr}
              result={result}
              options={PAD_OPTIONS}
              kind="money"
              currency={money.base}
              header={
                <div className="qa-path">
                  <span
                    className={
                      padFav.type === 'income' ? 'text-positive' : padFav.type === 'expense' ? 'text-negative' : 'qa-path-transfer'
                    }
                  >
                    {t(TYPE_LABEL[padFav.type])}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="qa-path-name">{walletOf(padFav.walletId)?.name}</span>
                  <span aria-hidden="true">{padFav.type === 'transfer' ? '→' : '·'}</span>
                  <strong className="qa-path-name">
                    {padFav.type === 'transfer' ? walletOf(padFav.toWalletId)?.name : padFav.category}
                  </strong>
                </div>
              }
              footnote={
                money.converting && padValid
                  ? `≈ ${formatMoney(money.convert(padAmount), money.display, settings.locale)}`
                  : undefined
              }
              chips={recents}
              onChip={(value) => setExpr(rawToPad(padValueToRaw(value, PAD_OPTIONS.decimals), PAD_OPTIONS))}
              onKey={press}
              onPaste={
                canPaste
                  ? () => {
                      void navigator.clipboard
                        .readText()
                        .then((text) => {
                          const next = pastedToPad(text, PAD_OPTIONS);
                          if (next === null) throw new Error('not a number');
                          setExpr(next);
                        })
                        .catch(() => toast.error(t('pad.pasteFailed')));
                    }
                  : undefined
              }
              done={{ label: t('favourites.save'), disabled: !padValid, run: savePad }}
            />
            <div className="fav-pad-more">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const fav = padFav;
                  setPad(null);
                  openForm(fav, padValid ? padAmount : null);
                }}
              >
                {t('favourites.more')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* "Ask before saving", and every ?fav= link with an amount. */}
      <ConfirmDialog
        open={confirm !== null}
        tone="primary"
        title={t('favourites.confirmTitle', { name: confirm?.fav.name ?? '' })}
        body={confirm ? `${t(TYPE_LABEL[confirm.fav.type])} · ${describe(confirm.fav, confirm.amount)}` : ''}
        confirmLabel={t('favourites.save')}
        onConfirm={() => {
          const held = confirm;
          setConfirm(null);
          if (held) attempt(held.fav, held.amount);
        }}
        onClose={() => setConfirm(null)}
      />

      {/* The same warning, against the same wallet, as the form and the drag shortcut. */}
      <OverdraftWarningModal
        open={overdraft !== null}
        wallet={overdraftFav ? walletOf(overdraftFav.walletId) : null}
        amount={overdraft?.amount ?? 0}
        check={overdraftCheck}
        onConfirm={() => {
          const held = overdraft;
          setOverdraft(null);
          if (held) attempt(held.fav, held.amount, true);
        }}
        onCancel={() => setOverdraft(null)}
      />

      {editor && (
        <Suspense fallback={null}>
          <FavouriteEditor
            target={editor.target}
            wallets={wallets.filter((wallet) => !wallet.archived)}
            groups={favouriteGroups(list)}
            count={list.favs.length}
            onSave={upsert}
            onDelete={(id) => {
              remove(id);
              setEditor(null);
            }}
            onClose={() => setEditor(null)}
          />
        </Suspense>
      )}
      {manageOpen && (
        <Suspense fallback={null}>
          <ManageFavourites onClose={() => setManageOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
