/**
 * Cash-flow Sankey data.
 *
 * Turns a month of transactions into the `{ nodes, links }` shape Recharts'
 * <Sankey> requires, tracing:
 *
 *     income source  ->  wallet  ->  expense category
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THAT ARE EASY TO GET WRONG HERE
 * ---------------------------------------------------------------------------
 *
 * 1. TRANSFERS MAKE CYCLES. Bank -> Brokerage -> Bank is a legitimate pair of
 *    transactions and an illegal Sankey: the layout walks the graph assigning
 *    depth and never settles on a cycle. Transfers are excluded entirely and
 *    counted in `skipped`, so the UI can say so out loud rather than silently
 *    dropping money.
 *
 * 2. A NODE'S HEIGHT IS max(inflow, outflow), NOT inflow. Recharts computes
 *    `value: Math.max(sum(sourceLinks), sum(targetLinks))`. So a wallet that
 *    spent 5,000 but only received 3,000 this month renders 5,000 tall with a
 *    3,000 ribbon arriving — a 2,000 gap the reader has to invent an
 *    explanation for. Every wallet is therefore balanced to inflow == outflow
 *    with one of two synthetic nodes:
 *
 *      "Existing balance" -> wallet     when it spent more than it received
 *      wallet -> "Left over"            when it received more than it spent
 *
 *    Both are true statements about the month, and they make each wallet's two
 *    sides agree exactly.
 *
 * 3. A WALLET WITH NO INCOME LANDS IN COLUMN ONE. Recharts seeds depth from
 *    nodes with no inbound link, so a wallet that only spent would be drawn
 *    beside "Salary" as though it were an income source. The "Existing balance"
 *    link from (2) fixes this as a side effect: every wallet has an inbound
 *    link, so every wallet sits in the middle column.
 *
 * The function is pure and formats nothing — the component owns currency.
 */

// Type-only: nothing from this module survives compilation, so the file has no
// runtime dependencies at all and can be exercised directly by a test runner.
import type { Transaction, WalletBalance } from '../types';

export type FlowStage = 'income' | 'wallet' | 'expense';

export interface FlowNode {
  name: string;
  stage: FlowStage;
  /**
   * Total flowing through this node. Recharts recomputes this for layout; it is
   * kept here so the tooltip and the table view can read it without the chart.
   */
  total: number;
  /** True for "Existing balance" and "Left over" — see note 2 above. */
  synthetic?: boolean;
}

/** Recharts requires `source`/`target` as indices into `nodes`. */
export interface FlowLink {
  source: number;
  target: number;
  value: number;
}

export interface CashFlow {
  nodes: FlowNode[];
  links: FlowLink[];
  /** False when the month has nothing to draw — the caller renders an empty state. */
  hasData: boolean;
  totals: {
    /** Real income recorded this month, excluding the synthetic opening balance. */
    income: number;
    /** Real spending this month, excluding the synthetic leftover. */
    expense: number;
    net: number;
    /** Spending funded by money already in the wallets. */
    openingBalance: number;
    /** Received and not spent. */
    leftOver: number;
  };
  skipped: {
    /** Transfers are structurally excluded — see note 1. */
    transfers: number;
    /** Rows whose walletId matches no wallet. Kept under a fallback name, never dropped. */
    orphaned: number;
  };
}

export interface CashFlowOptions {
  /** `YYYY-MM`. When given, rows outside the month are filtered out first. */
  period?: string;
  /** Income sources kept before the tail folds into "Other income". */
  maxIncomeSources?: number;
  /** Expense categories kept before the tail folds into "Other spending". */
  maxExpenseCategories?: number;
}

export const OPENING_BALANCE_LABEL = 'Existing balance';
export const LEFT_OVER_LABEL = 'Left over';
export const OTHER_INCOME_LABEL = 'Other income';
export const OTHER_EXPENSE_LABEL = 'Other spending';
const UNCATEGORISED = 'Uncategorised';
const UNKNOWN_WALLET = 'Unknown wallet';

/** Nodes that always sink to the bottom of their column — bookkeeping, not headline flows. */
const SINK_LABELS = new Set<string>([
  OPENING_BALANCE_LABEL,
  LEFT_OVER_LABEL,
  OTHER_INCOME_LABEL,
  OTHER_EXPENSE_LABEL,
]);

/**
 * Separator for the composite map keys below.
 *
 * Wallet names and categories are free text from a spreadsheet and routinely
 * contain spaces ("Bangkok Bank", "Other income"), so joining on one and
 * splitting it back would tear names in half and merge unrelated flows. U+001F
 * (unit separator) cannot appear in a sheet cell.
 */
const SEP = '\u001f';

const key2 = (a: string, b: string) => `${a}${SEP}${b}`;
const unkey2 = (k: string): [string, string] => {
  const at = k.indexOf(SEP);
  return [k.slice(0, at), k.slice(at + SEP.length)];
};

/** Two decimal places. Keeps float dust from becoming a hairline ribbon. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Anything below half a cent is noise, not a flow. */
const EPSILON = 0.005;

function addTo(map: Map<string, number>, k: string, amount: number): void {
  map.set(k, (map.get(k) ?? 0) + amount);
}

function sum(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

/**
 * Keeps the `limit` largest entries; everything past that renames to
 * `otherLabel`. Returns the rename map so callers rewrite keys in place rather
 * than aggregating twice.
 */
function foldTail(totals: Map<string, number>, limit: number, otherLabel: string): Map<string, string> {
  const rename = new Map<string, string>();
  if (totals.size <= limit) return rename;

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [name] of ranked.slice(limit)) rename.set(name, otherLabel);
  return rename;
}

export function buildCashFlow(
  transactions: readonly Transaction[] | null | undefined,
  wallets: readonly WalletBalance[] | null | undefined,
  options: CashFlowOptions = {},
): CashFlow {
  const { period, maxIncomeSources = 6, maxExpenseCategories = 8 } = options;

  let transfers = 0;
  let orphaned = 0;

  const emptyResult = (): CashFlow => ({
    nodes: [],
    links: [],
    hasData: false,
    totals: { income: 0, expense: 0, net: 0, openingBalance: 0, leftOver: 0 },
    skipped: { transfers, orphaned },
  });

  const walletName = new Map((wallets ?? []).map((w) => [w.id, w.name]));

  /* ---- pass 1: aggregate by label -------------------------------------- */

  const inflow = new Map<string, number>(); // source -> wallet
  const outflow = new Map<string, number>(); // wallet -> category
  const incomeBySource = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const walletIn = new Map<string, number>();
  const walletOut = new Map<string, number>();

  for (const tx of transactions ?? []) {
    if (!tx) continue;
    if (period && String(tx.date ?? '').slice(0, 7) !== period) continue;

    if (tx.type === 'transfer') {
      transfers += 1;
      continue;
    }
    if (tx.type !== 'income' && tx.type !== 'expense') continue;

    // The backend clamps amounts at 0, but a hand-edited sheet cell can hold
    // anything; a negative here would quietly subtract from a ribbon.
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let wallet = walletName.get(tx.walletId);
    if (wallet === undefined) {
      orphaned += 1;
      wallet = UNKNOWN_WALLET;
    }

    const category = String(tx.category ?? '').trim() || UNCATEGORISED;

    if (tx.type === 'income') {
      addTo(incomeBySource, category, amount);
      addTo(walletIn, wallet, amount);
      addTo(inflow, key2(category, wallet), amount);
    } else {
      addTo(expenseByCategory, category, amount);
      addTo(walletOut, wallet, amount);
      addTo(outflow, key2(wallet, category), amount);
    }
  }

  if (inflow.size === 0 && outflow.size === 0) return emptyResult();

  /* ---- pass 2: fold the long tails ------------------------------------- */

  const renameSource = foldTail(incomeBySource, maxIncomeSources, OTHER_INCOME_LABEL);
  const renameCategory = foldTail(expenseByCategory, maxExpenseCategories, OTHER_EXPENSE_LABEL);

  const foldedIn = new Map<string, number>();
  for (const [k, amount] of inflow) {
    const [source, wallet] = unkey2(k);
    addTo(foldedIn, key2(renameSource.get(source) ?? source, wallet), amount);
  }

  const foldedOut = new Map<string, number>();
  for (const [k, amount] of outflow) {
    const [wallet, category] = unkey2(k);
    addTo(foldedOut, key2(wallet, renameCategory.get(category) ?? category), amount);
  }

  /* ---- pass 3: balance every wallet ------------------------------------ */

  let openingBalance = 0;
  let leftOver = 0;

  for (const wallet of new Set([...walletIn.keys(), ...walletOut.keys()])) {
    const gap = round((walletIn.get(wallet) ?? 0) - (walletOut.get(wallet) ?? 0));

    if (gap < -EPSILON) {
      // Spent more than it took in — the difference was already sitting there.
      addTo(foldedIn, key2(OPENING_BALANCE_LABEL, wallet), -gap);
      openingBalance += -gap;
    } else if (gap > EPSILON) {
      // Took in more than it spent — the difference is still there.
      addTo(foldedOut, key2(wallet, LEFT_OVER_LABEL), gap);
      leftOver += gap;
    }
  }

  /* ---- pass 4: order the columns, then index them ---------------------- */

  const stageTotal = new Map<string, number>();
  for (const [k, amount] of foldedIn) {
    const [source, wallet] = unkey2(k);
    addTo(stageTotal, key2('income', source), amount);
    addTo(stageTotal, key2('wallet', wallet), amount);
  }
  for (const [k, amount] of foldedOut) {
    const [, category] = unkey2(k);
    addTo(stageTotal, key2('expense', category), amount);
  }

  function orderedNames(stage: FlowStage): string[] {
    return [...stageTotal.entries()]
      .filter(([k]) => k.startsWith(stage + SEP))
      .map(([k, total]) => ({ name: unkey2(k)[1], total }))
      .sort((a, b) => {
        const aSink = SINK_LABELS.has(a.name) ? 1 : 0;
        const bSink = SINK_LABELS.has(b.name) ? 1 : 0;
        if (aSink !== bSink) return aSink - bSink;
        return b.total - a.total || a.name.localeCompare(b.name);
      })
      .map((entry) => entry.name);
  }

  const nodes: FlowNode[] = [];
  const indexOf = new Map<string, number>();

  for (const stage of ['income', 'wallet', 'expense'] as const) {
    for (const name of orderedNames(stage)) {
      indexOf.set(key2(stage, name), nodes.length);
      nodes.push({
        name,
        stage,
        total: round(stageTotal.get(key2(stage, name)) ?? 0),
        synthetic: name === OPENING_BALANCE_LABEL || name === LEFT_OVER_LABEL,
      });
    }
  }

  const links: FlowLink[] = [];

  for (const [k, amount] of foldedIn) {
    const [source, wallet] = unkey2(k);
    const from = indexOf.get(key2('income', source));
    const to = indexOf.get(key2('wallet', wallet));
    if (from === undefined || to === undefined || amount < EPSILON) continue;
    links.push({ source: from, target: to, value: round(amount) });
  }

  for (const [k, amount] of foldedOut) {
    const [wallet, category] = unkey2(k);
    const from = indexOf.get(key2('wallet', wallet));
    const to = indexOf.get(key2('expense', category));
    if (from === undefined || to === undefined || amount < EPSILON) continue;
    links.push({ source: from, target: to, value: round(amount) });
  }

  if (!links.length) return emptyResult();

  const income = round(sum(incomeBySource));
  const expense = round(sum(expenseByCategory));

  return {
    nodes,
    links,
    hasData: true,
    totals: {
      income,
      expense,
      net: round(income - expense),
      openingBalance: round(openingBalance),
      leftOver: round(leftOver),
    },
    skipped: { transfers, orphaned },
  };
}

/** Flat rows for the table view — exactly the numbers the chart draws. */
export function flowRows(flow: CashFlow): { from: string; to: string; value: number; share: number }[] {
  const denominator = flow.links.reduce((total, link) => total + link.value, 0) || 1;
  return flow.links
    .map((link) => ({
      from: flow.nodes[link.source]?.name ?? '',
      to: flow.nodes[link.target]?.name ?? '',
      value: link.value,
      share: link.value / denominator,
    }))
    .sort((a, b) => b.value - a.value);
}
