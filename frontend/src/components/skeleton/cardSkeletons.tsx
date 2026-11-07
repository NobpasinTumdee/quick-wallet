import type { ReactNode } from 'react';

import { cx } from '../../lib/format';
import { CHART_HEIGHT, HISTORY_MONTHS, MONTH_WIDTH, TALL_CHART_HEIGHT } from '../../lib/incomeChartGeometry';
import type { AnalyticsCardId, CatalogCardId, HomeCardId } from '../../lib/layout/cardCatalog';
import { Sk, SkCard, SkFrame, SkHead, SkListRows, SkT } from './Sk';

/**
 * One skeleton per catalog card, in the same frame, width class and header
 * as the loaded card. Typed over every catalog id, so a new card does not
 * compile without one. The bodies of the Analytics cards are exported on
 * their own too: those cards draw their real header straight away and wait
 * only for their own rows.
 */

export interface CardSkeletonProps {
  /** The layout's size class (empty on phones and in a placed grid). */
  sizeClass: string;
  /** Its height when it last loaded here, where the layout does not fix it. */
  minHeight?: number;
  /** The new phone layout (some cards draw differently there). */
  mobileV2?: boolean;
  /** Drawn tall (a flow layout's tall row). */
  tall?: boolean;
}

/* ---- Bodies ---- */

function BudgetRows({ rows }: { rows: number }) {
  return (
    <div className="stack stack--loose">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="stack stack--tight">
          <div className="cluster cluster--between">
            <SkT w={`${6 + (i % 3)}em`} />
            <SkT w="9em" />
          </div>
          <Sk className="sk-bar-h" />
          <div className="cluster cluster--between">
            <SkT w="5em" className="text-xs" />
            <SkT w="6em" className="text-xs" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShareRows({ rows }: { rows: number }) {
  return (
    <div className="stack stack--tight">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="share-row">
          <SkT w={`${55 + ((i * 13) % 35)}%`} />
          <span className="share-track sk-track">
            <Sk className="sk-fill" w={`${85 - i * 14}%`} />
          </span>
          <SkT w="5em" />
        </div>
      ))}
    </div>
  );
}

/** Bars over an axis: Income vs spending, the savings rate. */
export function SkBars({ count = 12, height = 220, pairs = false }: { count?: number; height?: number; pairs?: boolean }) {
  return (
    <div className="sk-chart" style={{ height }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="sk-chart-col">
          <Sk className="sk-chart-bar" h={`${38 + ((i * 29) % 52)}%`} />
          {pairs && <Sk className="sk-chart-bar" h={`${26 + ((i * 41) % 48)}%`} />}
        </span>
      ))}
    </div>
  );
}

/**
 * Income vs Spending in the chart's own classes: two stat groups of three,
 * the plot at the chart's height and width (so it scrolls, with its
 * scrollbar, exactly when the chart will), and the legend line.
 */
function SkCashflowBody({ tall }: { tall: boolean }) {
  return (
    <div className="ischart">
      <div className="ischart-stats">
        {[0, 1].map((group) => (
          <div key={group} className="ischart-stat-group">
            <SkT as="div" className="ischart-stat-series" w="4.5em" />
            <div className="ischart-stat-row">
              {[0, 1, 2].map((i) => (
                <div key={i} className="ischart-stat">
                  <SkT className="ischart-stat-label" w="4.5em" />
                  <SkT className="ischart-stat-value" w="4em" />
                  <SkT className="ischart-stat-meta" w="5em" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="ischart-scroll">
        <div style={{ minWidth: HISTORY_MONTHS * MONTH_WIDTH }}>
          <SkBars count={HISTORY_MONTHS} height={tall ? TALL_CHART_HEIGHT : CHART_HEIGHT} pairs />
        </div>
      </div>
      <div className="ischart-foot">
        <SkT className="ischart-legend-item" w="4em" />
        <SkT className="ischart-legend-item" w="4.5em" />
        <SkT className="ischart-foot-note" w="25em" />
      </div>
    </div>
  );
}

/** The category pills under a chart (Expense breakdown, the box plot). */
function SkChips({ widths }: { widths: number[] }) {
  return (
    <div className="category-chips">
      {widths.map((w, i) => (
        <Sk key={i} className="sk-chip" w={w} />
      ))}
    </div>
  );
}

/** Columns of boxes over an axis (Spending distribution). */
export function SkBoxPlotBody() {
  return (
    <div className="sk-chart sk-boxplot" style={{ height: 260 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="sk-chart-col">
          <Sk className="sk-box" h={`${30 + ((i * 23) % 40)}%`} style={{ marginBottom: `${10 + ((i * 17) % 25)}%` }} />
        </span>
      ))}
    </div>
  );
}

/** Tiles of a treemap. */
export function SkTreemapBody() {
  return (
    <div className="sk-tree">
      <Sk className="sk-tile" style={{ gridArea: 'a' }} />
      <Sk className="sk-tile" style={{ gridArea: 'b' }} />
      <Sk className="sk-tile" style={{ gridArea: 'c' }} />
      <Sk className="sk-tile" style={{ gridArea: 'd' }} />
      <Sk className="sk-tile" style={{ gridArea: 'e' }} />
    </div>
  );
}

/** Three columns of nodes (the cash-flow diagram). */
export function SkSankeyBody() {
  return (
    <div className="sk-sankey">
      {[3, 4, 5].map((nodes, column) => (
        <span key={column} className="sk-sankey-col">
          {Array.from({ length: nodes }, (_, i) => (
            <Sk key={i} className="sk-node" h={`${100 / nodes - 6}%`} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** A table: a head row and rows of cells (Top payees). */
export function SkTableBody({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sk-table">
      <div className="sk-table-row is-head">
        <SkT w="4em" className="text-xs" />
        <SkT w="3em" className="text-xs" />
        <SkT w="4em" className="text-xs" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-table-row">
          <span className="stack stack--tight">
            <SkT w={`${6 + (i % 3)}em`} />
            <SkT w="7em" className="text-xs" />
          </span>
          <SkT w="2em" />
          <SkT w="5em" />
        </div>
      ))}
    </div>
  );
}

/** A rising series over an axis (savings rate, projection), as slim columns so the sweep follows the shape. */
export function SkLineChartBody({ height = 240 }: { height?: number }) {
  return (
    <div className="sk-chart" style={{ height }}>
      {Array.from({ length: 24 }, (_, i) => (
        <span key={i} className="sk-chart-col">
          <Sk className="sk-chart-bar" h={`${22 + i * 2.6 + ((i * 37) % 9)}%`} />
        </span>
      ))}
    </div>
  );
}

/* ---- Cards ---- */

type Skeleton = (props: CardSkeletonProps) => ReactNode;

const HOME_SKELETONS: Record<HomeCardId, Skeleton> = {
  budgets: ({ sizeClass, minHeight }) => (
    <SkCard className={cx('bento-item--wide', sizeClass)} minHeight={minHeight} head={<SkHead title="8em" subtitle="6em" action={64} />}>
      <BudgetRows rows={4} />
    </SkCard>
  ),
  wallets: ({ sizeClass, minHeight }) => (
    <SkCard
      className={cx('bento-item--narrow', sizeClass)}
      minHeight={minHeight}
      padded={false}
      head={<SkHead title="5em" subtitle={false} action={64} />}
    >
      <div className="list-group-label">
        <SkT className="section-label" w="5em" />
        <SkT className="section-label" w="4em" />
      </div>
      <SkListRows rows={3} />
    </SkCard>
  ),
  cashflow: ({ sizeClass, minHeight, tall }) => (
    <SkCard
      className={cx('bento-item--full', sizeClass)}
      minHeight={minHeight}
      head={<SkHead title="10em" subtitle="14em" segmented={132} />}
    >
      <SkCashflowBody tall={Boolean(tall)} />
    </SkCard>
  ),
  breakdown: ({ sizeClass, minHeight }) => (
    <SkCard className={cx('bento-item--half', sizeClass)} minHeight={minHeight} head={<SkHead title="7em" subtitle="6em" />}>
      <ShareRows rows={5} />
    </SkCard>
  ),
  recent: ({ sizeClass, minHeight }) => (
    <SkCard
      className={cx('bento-item--half', sizeClass)}
      minHeight={minHeight}
      padded={false}
      head={<SkHead title="8em" subtitle={false} action={56} />}
    >
      <SkListRows rows={5} />
    </SkCard>
  ),
  inbox: ({ sizeClass, minHeight }) => (
    <SkFrame as="section" className={cx('inbox-widget', sizeClass)} minHeight={minHeight}>
      <header className="inbox-head">
        <SkT as="h2" w="5em" />
        <SkT as="p" className="inbox-summary" w="7em" />
      </header>
    </SkFrame>
  ),
  analytics: ({ sizeClass, minHeight }) => (
    <SkFrame className={cx('card bento-item--full analytics-cta', sizeClass)} minHeight={minHeight}>
      <Sk className="analytics-cta-mark" />
      <span className="analytics-cta-body">
        <SkT className="analytics-cta-title" w="6em" />
        <SkT className="analytics-cta-sub" w="11em" />
      </span>
    </SkFrame>
  ),
};

/** The body each Analytics card shows while its own rows load. */
export const ANALYTICS_SKELETON_BODIES: Record<AnalyticsCardId, () => ReactNode> = {
  /* The empty state's room (196px), which a short list of bills also takes. */
  bills: () => (
    <div className="stack" style={{ height: 196, justifyContent: 'center' }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="cluster cluster--between">
          <SkT w={`${7 + (i % 3)}em`} />
          <SkT w="4em" />
        </div>
      ))}
    </div>
  ),
  /* In each chart's own containers (their CSS sets the sizes and gaps). */
  savingsRate: () => (
    <div className="arate">
      <div className="arate-head">
        {/* Top-aligned: a block without text would sit on the meta's baseline. */}
        <span className="arate-figure" style={{ alignSelf: 'flex-start' }}>
          <Sk w="3.5em" h={46} />
        </span>
        <SkT className="arate-meta" w="12em" />
      </div>
      <SkLineChartBody height={180} />
    </div>
  ),
  categoryPie: () => (
    <>
      <div className="pie">
        <div className="pie-figure">
          <Sk className="sk-donut" w={240} h={240} style={{ maxWidth: '100%' }} />
        </div>
        <div className="pie-legend">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="sk-legend-row">
              <SkT w={`${5 + (i % 3)}em`} />
              <SkT w="3.5em" />
            </div>
          ))}
        </div>
      </div>
      <SkChips widths={[136, 152, 150, 128]} />
    </>
  ),
  categoryTree: () => (
    <div className="atree">
      <SkTreemapBody />
    </div>
  ),
  spendHeatmap: () => (
    <div className="heat">
      <div className="heat-weekdays">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <SkT key={i} className="sk-centre" w="1.6em" />
        ))}
      </div>
      <div className="heat-grid">
        {Array.from({ length: 35 }, (_, i) => (
          <Sk key={i} className="sk-cell" />
        ))}
      </div>
      <div className="heat-legend">
        <SkT w="9em" />
      </div>
    </div>
  ),
  categoryBoxplot: () => (
    <>
      <div className="boxplot">
        <div className="boxplot-scroll">
          <SkBoxPlotBody />
        </div>
        <div className="boxplot-readout">
          <SkT className="boxplot-readout-idle" w="16em" />
        </div>
        <SkT as="p" className="boxplot-caption" w="20em" />
      </div>
      <SkChips widths={[120, 136, 128]} />
    </>
  ),
  payees: () => <SkTableBody rows={5} />,
  sankey: () => (
    <div className="sankey-wrap">
      <SkSankeyBody />
      <div className="sankey-legend">
        <SkT className="sankey-legend-item" w="5em" />
        <SkT className="sankey-legend-item" w="5em" />
        <SkT className="sankey-legend-item" w="6em" />
        <SkT className="sankey-legend-note" w="10em" />
      </div>
      <SkT as="p" className="sankey-footnote" w="18em" />
    </div>
  ),
  projection: () => (
    <div className="proj">
      <div className="proj-headline">
        <Sk w={145} h={56} />
        <Sk w={204} h={58} />
      </div>
      <div className="proj-plot">
        <Sk h={220} style={{ width: '100%' }} />
      </div>
      <div className="proj-controls">
        <Sk h={35} />
        <Sk h={35} />
        <Sk w={95} h={33} />
      </div>
      <p className="proj-note">
        <Sk w={15} h={15} r={4} />
        <span style={{ flex: 1 }}>
          <SkT w="100%" />
          <SkT w="55%" />
        </span>
      </p>
    </div>
  ),
};

/** Width class, header and padding of each Analytics card, as AnalyticsCards draws it. */
const ANALYTICS_FRAMES: Record<
  AnalyticsCardId,
  { base: string; title: string; subtitle: string | false; action?: number; segmented?: number; picker?: boolean; padded?: boolean }
> = {
  bills: { base: 'bento-item--full', title: '8em', subtitle: '16em', segmented: 251 },
  savingsRate: { base: 'bento-item', title: '7em', subtitle: '15em' },
  categoryPie: { base: 'bento-item--half', title: '9em', subtitle: '13em', picker: true },
  categoryTree: { base: 'bento-item--half', title: '8em', subtitle: '14em' },
  spendHeatmap: { base: 'bento-item--half', title: '8em', subtitle: '6em' },
  categoryBoxplot: { base: 'bento-item--full', title: '10em', subtitle: '16em', picker: true },
  payees: { base: 'bento-item--half', title: '6em', subtitle: '13em', padded: false },
  sankey: { base: 'bento-item--full', title: '11em', subtitle: '10em', action: 72 },
  projection: { base: 'bento-item--full', title: '10em', subtitle: '16em' },
};

function analyticsSkeleton(id: AnalyticsCardId): Skeleton {
  const frame = ANALYTICS_FRAMES[id];
  const Body = ANALYTICS_SKELETON_BODIES[id];
  return ({ sizeClass, minHeight }) => (
    <SkCard
      className={cx(frame.base, id === 'sankey' && 'sankey-placeholder', sizeClass)}
      minHeight={minHeight}
      padded={frame.padded !== false}
      head={<SkHead title={frame.title} subtitle={frame.subtitle} action={frame.action} picker={frame.picker} segmented={frame.segmented} />}
    >
      {frame.padded === false ? <div className="card-body">{Body()}</div> : Body()}
    </SkCard>
  );
}

export const CARD_SKELETONS: Record<CatalogCardId, Skeleton> = {
  ...HOME_SKELETONS,
  bills: analyticsSkeleton('bills'),
  savingsRate: analyticsSkeleton('savingsRate'),
  categoryPie: analyticsSkeleton('categoryPie'),
  categoryTree: analyticsSkeleton('categoryTree'),
  spendHeatmap: analyticsSkeleton('spendHeatmap'),
  categoryBoxplot: analyticsSkeleton('categoryBoxplot'),
  payees: analyticsSkeleton('payees'),
  sankey: analyticsSkeleton('sankey'),
  projection: analyticsSkeleton('projection'),
};

/** A card's skeleton, for a board's loading pass. */
export function renderCardSkeleton(id: CatalogCardId, props: CardSkeletonProps): ReactNode {
  return CARD_SKELETONS[id](props);
}

/* ---- Home's hero ---- */

/**
 * The hero as the loaded one draws it: label row with its two buttons, the
 * figure, the dots, the badge line, the tax button; in the new phone layout
 * the greeting and the quick-add row too, and the metrics (Classic and
 * desktop: inside the hero; New: at the top of the sheet).
 */
export function HomeHeroSkeleton({
  mobileV2,
  quickAdd,
  minHeight,
}: {
  mobileV2: boolean;
  quickAdd: boolean;
  minHeight?: number;
}) {
  return (
    <SkFrame as="section" className={cx('hero', mobileV2 && 'home-hero')} minHeight={minHeight}>
      {mobileV2 && <SkT as="p" className="home-greeting" w="9em" />}
      <div className="hero-primary">
        <div className="balance-carousel">
          <div className="hero-label-row">
            <SkT className="section-label" w="13em" />
            {/* The real refresh button hangs out of this row without growing it. */}
            <span className="cluster" style={{ gap: 4 }}>
              <Sk className="sk-btn sk-btn--icon" style={{ marginBlock: -8 }} />
            </span>
          </div>
          <div className="balance-track sk-static">
            <div className="balance-panel">
              {/* Icon and words, as the real line; the note keeps the
                  room of the tallest panel, which sets the track's height. */}
              <span className="balance-context">
                <Sk w={15} h={15} r={4} />
                <SkT w="7em" />
              </span>
              <span className="hero-figure">
                <SkT className="hero-value" w="7.5em" />
              </span>
              <SkT className="balance-note" w="6em" />
            </div>
          </div>
          <div className="balance-dots">
            {[0, 1, 2].map((i) => (
              <span key={i} className="balance-dot">
                <span />
              </span>
            ))}
          </div>
          <div className="hero-meta">
            <Sk className="sk-pill" w="9em" h={25} />
            <SkT w="5em" />
          </div>
          <Sk className="tax-cta sk-taxcta" />
        </div>
      </div>
      {mobileV2 && quickAdd && (
        <div className="home-actions">
          {[0, 1, 2].map((i) => (
            <Sk key={i} className="home-action" />
          ))}
        </div>
      )}
      {!mobileV2 && <HomeMetricsSkeleton bare />}
    </SkFrame>
  );
}

/** The metric grid: five cells of label, figure, hint. `bare` when inside another skeleton frame. */
export function HomeMetricsSkeleton({ bare = false, minHeight }: { bare?: boolean; minHeight?: number }) {
  const cells = (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="metric">
          <SkT className="section-label" w="5.5em" />
          <SkT className="metric-value" w="5em" />
          <SkT className="metric-hint" w="6.5em" />
        </div>
      ))}
    </>
  );
  if (bare) return <div className="hero-metrics">{cells}</div>;
  return (
    <SkFrame className="hero-metrics" minHeight={minHeight}>
      {cells}
    </SkFrame>
  );
}
