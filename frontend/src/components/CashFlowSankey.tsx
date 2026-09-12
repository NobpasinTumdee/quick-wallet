/**
 * Cash-flow Sankey — where the month's money came from and where it went.
 *
 * Colour encodes the *stage* of the flow (in / held / out), not the identity of
 * each category. That is deliberate: with eight or more spending categories a
 * per-category palette becomes a rainbow that fails colourblind separation, and
 * a Sankey already names every node inline, so hue would be re-encoding a label
 * that is right there. Three semantic colours — the app's own `--positive`,
 * `--accent` and `--negative` — read instantly and inherit every theme.
 *
 * Nothing here hard-codes a colour. Nodes, ribbons and gradient stops are
 * styled from CSS classes in app.css so all thirteen themes drive the chart.
 *
 * The tooltip enhances, it never gates: the "Table" toggle shows every number
 * without hovering, which is also the keyboard- and screen-reader path.
 */

import { ArrowRight, Table2, Waypoints } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  Sankey,
  type SankeyLinkProps,
  type SankeyNodeProps,
  Tooltip,
} from 'recharts';

import { cx } from '../lib/format';
import {
  CashFlow,
  FlowNode,
  FlowStage,
  LEFT_OVER_LABEL,
  OPENING_BALANCE_LABEL,
  buildCashFlow,
  flowRows,
} from '../lib/sankey';
import { MoneyFormatter, useMoneyFormatter } from '../state/SettingsContext';
import { Transaction, WalletBalance } from '../types';
import { Icon } from './Icon';
import { Card, EmptyState, Segmented } from './ui';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Below this the outside label gutters have to shrink or names get clipped. */
const NARROW = 560;

/** A label needs roughly this much node height before it fits without crowding. */
const MIN_LABEL_HEIGHT = 11;
/** Only nodes at least this tall get their amount printed under the name. */
const MIN_VALUE_HEIGHT = 30;

function layoutFor(width: number, columnHeight: number) {
  const narrow = width > 0 && width < NARROW;
  return {
    narrow,
    // Gutters for the outside labels on the first and last columns.
    left: narrow ? 74 : 124,
    right: narrow ? 78 : 136,
    nodeWidth: narrow ? 9 : 13,
    nodePadding: narrow ? 11 : 17,
    // Tall enough for the busiest column; the card grows rather than scrolling.
    height: Math.max(300, Math.min(640, columnHeight * (narrow ? 40 : 48))),
    maxChars: narrow ? 11 : 18,
  };
}

/**
 * The colour a node contributes to a ribbon.
 *
 * Stage alone is not enough: "Left over" sits in the expense column because
 * that is where the layout puts it, but it is money that was NOT spent, so
 * ending its ribbon in --negative would read as spending. Synthetic nodes take
 * a neutral tone instead.
 */
type Tone = FlowStage | 'neutral';

const toneOf = (node: { stage?: FlowStage; synthetic?: boolean } | undefined): Tone =>
  node?.synthetic ? 'neutral' : (node?.stage ?? 'wallet');

/** Only these four pairs can occur, given links only run income -> wallet -> expense. */
const TONE_PAIRS: [Tone, Tone][] = [
  ['income', 'wallet'],
  ['neutral', 'wallet'],
  ['wallet', 'expense'],
  ['wallet', 'neutral'],
];

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Recharts types a node payload as its own `SankeyNode`, which knows nothing
 * about the fields we put on it. They do survive — `getNodesTree` spreads the
 * original entry — so this is the one place the wider shape is asserted, and
 * every read below is still defensive about it.
 */
type LaidOutNode = FlowNode & { value?: number };

/**
 * Node = a thin rounded bar plus an outside label.
 *
 * Labels sit in the margin gutters — left of the income column, right of the
 * expense column — so they never cross a ribbon. The middle column has no
 * gutter, so its labels get a surface-coloured halo (`paint-order: stroke`)
 * and sit over the ribbons legibly.
 *
 * A node shorter than the text is left unlabelled rather than clipped; the
 * tooltip and the table view still carry it.
 */
function renderNode(
  props: SankeyNodeProps,
  layout: ReturnType<typeof layoutFor>,
  money: MoneyFormatter,
) {
  const { x, y, width, height } = props;
  const payload = props.payload as unknown as LaidOutNode;
  const stage: FlowStage = payload?.stage ?? 'wallet';
  const total = payload?.value ?? payload?.total ?? 0;

  const labelLeft = stage === 'expense';
  const labelX = labelLeft ? x + width + 9 : x - 9;
  const anchor = labelLeft ? 'start' : 'end';
  const showLabel = height >= MIN_LABEL_HEIGHT;
  const showValue = height >= MIN_VALUE_HEIGHT;
  const midY = y + height / 2;

  return (
    <g className={cx('sankey-node', `sankey-node--${stage}`, payload?.synthetic && 'is-synthetic')}>
      <rect x={x} y={y} width={width} height={Math.max(1, height)} rx={Math.min(4, width / 2)} />
      {showLabel && (
        <text
          className="sankey-node-label"
          x={stage === 'wallet' ? x + width + 9 : labelX}
          y={showValue ? midY - 5 : midY}
          textAnchor={stage === 'wallet' ? 'start' : anchor}
          dominantBaseline="middle"
        >
          {truncate(payload?.name ?? '', layout.maxChars)}
        </text>
      )}
      {showValue && (
        <text
          className="sankey-node-value"
          x={stage === 'wallet' ? x + width + 9 : labelX}
          y={midY + 9}
          textAnchor={stage === 'wallet' ? 'start' : anchor}
          dominantBaseline="middle"
        >
          {money(total, { compact: true })}
        </text>
      )}
    </g>
  );
}

/** Same assertion on the link side — here source/target ARE resolved nodes. */
type LaidOutLink = { source?: LaidOutNode; target?: LaidOutNode; value?: number };

/**
 * Ribbon = a stroked cubic curve, its width the amount.
 *
 * The stroke is a gradient between the two stage colours, so direction is
 * legible without an arrowhead: green fading into blue is money arriving, blue
 * into red is money leaving.
 */
function renderLink(props: SankeyLinkProps, gradientId: (from: Tone, to: Tone) => string) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth } = props;
  const payload = props.payload as unknown as LaidOutLink;

  const from = toneOf(payload?.source);
  const to = toneOf(payload?.target);
  const synthetic = from === 'neutral' || to === 'neutral';

  return (
    <path
      className={cx('sankey-link', synthetic && 'is-synthetic')}
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      stroke={`url(#${gradientId(from, to)})`}
      strokeWidth={Math.max(1, linkWidth)}
      strokeLinecap="butt"
      fill="none"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

/** What we care about, whatever depth Recharts happens to nest it at. */
interface HoveredItem {
  stage?: FlowStage;
  name?: string;
  value?: number;
  source?: number | FlowNode;
  target?: number | FlowNode;
  payload?: HoveredItem;
}

/**
 * Recharts wraps the Sankey item in `{ payload, name, value }` and then the
 * Tooltip wraps that again, so the node/link object sits one or two `payload`
 * hops down depending on version. Rather than pin a depth, walk down until the
 * object actually looks like a node (has `stage`) or a link (has `source`).
 */
function unwrapHovered(entry: HoveredItem | undefined): HoveredItem | undefined {
  let current = entry;
  for (let hop = 0; hop < 4 && current; hop += 1) {
    if (current.stage !== undefined || current.source !== undefined) return current;
    current = current.payload;
  }
  return entry;
}

/**
 * Recharts' Sankey tooltip hands back the *raw* link, whose `source`/`target`
 * are still indices — unlike the link renderer, which gets them resolved. So
 * the names are looked up here against the same nodes array the chart was given.
 */
function FlowTooltip({
  active,
  payload,
  nodes,
  money,
  grandTotal,
}: {
  active?: boolean;
  payload?: HoveredItem[];
  nodes: FlowNode[];
  money: MoneyFormatter;
  grandTotal: number;
}) {
  const entry = active ? unwrapHovered(payload?.[0]) : undefined;
  if (!entry) return null;

  const resolve = (ref: number | FlowNode | undefined): FlowNode | undefined =>
    typeof ref === 'number' ? nodes[ref] : ref;

  const source = resolve(entry.source);
  const target = resolve(entry.target);
  const isLink = Boolean(source && target);

  const value = Number(entry.value ?? payload?.[0]?.value ?? 0);
  const share = grandTotal > 0 ? (value / grandTotal) * 100 : 0;

  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-value">{money(value)}</div>

      {isLink ? (
        <div className="chart-tip-flow">
          <span className={`chart-tip-key chart-tip-key--${source?.stage}`} aria-hidden="true" />
          <span className="chart-tip-name">{source?.name}</span>
          <Icon icon={ArrowRight} size="sm" />
          <span className={`chart-tip-key chart-tip-key--${target?.stage}`} aria-hidden="true" />
          <span className="chart-tip-name">{target?.name}</span>
        </div>
      ) : (
        <div className="chart-tip-flow">
          <span className={`chart-tip-key chart-tip-key--${entry.stage}`} aria-hidden="true" />
          <span className="chart-tip-name">{entry.name}</span>
          <span className="chart-tip-muted">
            {entry.stage === 'income' ? 'in' : entry.stage === 'expense' ? 'out' : 'through'}
          </span>
        </div>
      )}

      <div className="chart-tip-muted">{share.toFixed(1)}% of all movement</div>

      {(source?.name === OPENING_BALANCE_LABEL || entry.name === OPENING_BALANCE_LABEL) && (
        <div className="chart-tip-note">Spending funded by money already in the wallet.</div>
      )}
      {(target?.name === LEFT_OVER_LABEL || entry.name === LEFT_OVER_LABEL) && (
        <div className="chart-tip-note">Received this month and not spent.</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

const STAGE_LABEL: Record<FlowStage, string> = {
  income: 'Income',
  wallet: 'Wallets',
  expense: 'Spending',
};

export function CashFlowSankey({
  transactions,
  wallets,
  period,
  loading = false,
  stale = false,
  className,
}: {
  transactions: Transaction[];
  wallets: WalletBalance[];
  period: string;
  /** Nothing cached yet — render the frame, not a spinner that shifts layout. */
  loading?: boolean;
  /** Refetching over data already on screen: dim, never re-skeleton. */
  stale?: boolean;
  className?: string;
}) {
  const money = useMoneyFormatter();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const uid = useId().replace(/:/g, '');

  /* The chart's own width drives the label gutters and node sizing, which a CSS
     media query cannot do — the card is narrower than the viewport. */
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([box]) => setWidth(box.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const flow: CashFlow = useMemo(
    () => buildCashFlow(transactions, wallets, { period }),
    [transactions, wallets, period],
  );

  const tallestColumn = useMemo(() => {
    const perStage = new Map<FlowStage, number>();
    for (const node of flow.nodes) perStage.set(node.stage, (perStage.get(node.stage) ?? 0) + 1);
    return Math.max(3, ...perStage.values());
  }, [flow.nodes]);

  const layout = layoutFor(width, tallestColumn);
  const grandTotal = useMemo(() => flow.links.reduce((s, l) => s + l.value, 0), [flow.links]);
  const rows = useMemo(() => flowRows(flow), [flow]);

  const gradientId = (from: Tone, to: Tone) => `${uid}-${from}-${to}`;

  const subtitle = flow.hasData
    ? `${money(flow.totals.income, { compact: true })} in · ${money(flow.totals.expense, { compact: true })} out`
    : 'Nothing recorded yet';

  return (
    <Card
      className={className}
      title="Where the money moved"
      subtitle={subtitle}
      actions={
        <Segmented<'chart' | 'table'>
          value={view}
          ariaLabel="Cash flow view"
          onChange={setView}
          options={[
            { value: 'chart', label: <Icon icon={Waypoints} size="sm" label="Diagram" /> },
            { value: 'table', label: <Icon icon={Table2} size="sm" label="Table" /> },
          ]}
        />
      }
    >
      {!flow.hasData ? (
        <EmptyState
          icon={<Icon icon={Waypoints} size="xl" />}
          title={loading ? 'Loading this month…' : 'No cash flow to trace yet'}
          description={
            loading
              ? undefined
              : flow.skipped.transfers > 0
                ? `This month has only transfers between your own wallets (${flow.skipped.transfers}). Record some income or spending to see the flow.`
                : 'Record income and expenses and this traces every baht from source to category.'
          }
        />
      ) : (
        <div ref={wrapRef} className={cx('sankey-wrap', stale && 'is-stale')}>
          {/* Gradients live in their own zero-size svg so the ids resolve for
              the chart without fighting Recharts over its <Surface> children.

              gradientUnits="userSpaceOnUse" is load-bearing, not a preference.
              The default (objectBoundingBox) resolves against each path's own
              box, and a ribbon between two nodes at the same height is a
              perfectly horizontal line whose box has zero height — SVG skips
              painting such a gradient entirely, so the ribbon vanishes. Pinning
              the ramp to chart coordinates paints every ribbon, and has the
              happy side effect of one continuous left-to-right ramp across the
              whole diagram rather than a separate one per ribbon. */}
          <svg className="sankey-defs" aria-hidden="true" focusable="false">
            <defs>
              {TONE_PAIRS.map(([from, to]) => (
                <linearGradient
                  key={`${from}-${to}`}
                  id={gradientId(from, to)}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  y1={0}
                  x2={Math.max(1, width)}
                  y2={0}
                >
                  <stop offset="0%" className={`sankey-stop--${from}`} />
                  <stop offset="100%" className={`sankey-stop--${to}`} />
                </linearGradient>
              ))}
            </defs>
          </svg>

          {view === 'chart' ? (
            <>
              <ResponsiveContainer width="100%" height={layout.height}>
                <Sankey
                  data={{ nodes: flow.nodes, links: flow.links }}
                  nodeWidth={layout.nodeWidth}
                  nodePadding={layout.nodePadding}
                  linkCurvature={0.5}
                  margin={{ top: 10, right: layout.right, bottom: 10, left: layout.left }}
                  node={(props: SankeyNodeProps) => renderNode(props, layout, money)}
                  link={(props: SankeyLinkProps) => renderLink(props, gradientId)}
                  title="Cash flow"
                  desc={`Money traced from income sources through wallets to spending categories for ${period}.`}
                >
                  <Tooltip
                    isAnimationActive={false}
                    content={
                      <FlowTooltip nodes={flow.nodes} money={money} grandTotal={grandTotal} />
                    }
                  />
                </Sankey>
              </ResponsiveContainer>

              <div className="sankey-legend">
                {(['income', 'wallet', 'expense'] as const).map((stage) => (
                  <span key={stage} className="sankey-legend-item">
                    <span className={`chart-tip-key chart-tip-key--${stage}`} aria-hidden="true" />
                    {STAGE_LABEL[stage]}
                  </span>
                ))}
                <span className="sankey-legend-note">
                  {flow.skipped.transfers > 0 &&
                    `${flow.skipped.transfers} transfer${flow.skipped.transfers === 1 ? '' : 's'} excluded · `}
                  hover a ribbon for the amount
                </span>
              </div>
            </>
          ) : (
            <div className="table-scroll">
              <table className="flow-table">
                <caption className="sr-only">
                  Every cash flow for {period}, largest first.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col" className="is-numeric">Amount</th>
                    <th scope="col" className="is-numeric">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.from}-${row.to}`}>
                      <td>{row.from}</td>
                      <td>{row.to}</td>
                      <td className="is-numeric">{money(row.value)}</td>
                      <td className="is-numeric text-muted">{(row.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(flow.totals.openingBalance > 0 || flow.totals.leftOver > 0 || flow.skipped.orphaned > 0) && (
            <p className="sankey-footnote">
              {flow.totals.openingBalance > 0 && (
                <>
                  <strong>{money(flow.totals.openingBalance)}</strong> of spending came from money already
                  in your wallets.{' '}
                </>
              )}
              {flow.totals.leftOver > 0 && (
                <>
                  <strong>{money(flow.totals.leftOver)}</strong> arrived and was not spent.{' '}
                </>
              )}
              {flow.skipped.orphaned > 0 && (
                <>
                  {flow.skipped.orphaned} row{flow.skipped.orphaned === 1 ? '' : 's'} reference a wallet that
                  no longer exists.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
