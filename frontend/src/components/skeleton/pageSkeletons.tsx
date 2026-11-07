import { useMobileV2 } from '../../lib/mobileLayout';
import { Sk, SkListRows, SkRegion, SkT } from './Sk';

/**
 * The loading regions of every other data page, each in that page's own
 * classes (its grid, its card, its row), so the gaps and columns are the
 * loaded page's. Every region remembers its height through SkRegion, keyed by
 * the page name given here. Row counts are a typical page's: the real number
 * is the user's, which the remembered height covers from the second visit.
 */

const widths = (i: number, base: number, step = 1.5) => `${base + (i % 3) * step}em`;

/* ---- Activity ---- */

function TxTileSk({ i }: { i: number }) {
  return (
    <li className="tx-tile">
      <div className="tx-tile-main">
        <Sk className="sk-avatar" w={36} h={36} r={999} />
        <span className="tx-body">
          <SkT className="tx-title" w={widths(i, 7)} />
          <SkT className="tx-meta" w={widths(i, 9, 1)} />
        </span>
        <span className="tx-trailing">
          <SkT w="4.5em" />
        </span>
      </div>
    </li>
  );
}

/** Activity's list: the desktop table, the phone tiles (grouped by day in the new layout). */
export function ActivitySkeleton({ desktop, mobileV2 }: { desktop: boolean; mobileV2: boolean }) {
  if (desktop) {
    return (
      <SkRegion page="activity" className="table-wrap">
        <table className="data tx-table">
          <thead>
            <tr>
              <th className="tx-sel-col" />
              {[4, 5, 4, 7, 5, 6].map((w, i) => (
                <th key={i}>
                  <SkT w={`${w}em`} />
                </th>
              ))}
              <th className="num" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                <td className="tx-sel-col" />
                <td>
                  <Sk className="sk-pill" w="5em" h={22} />
                </td>
                <td>
                  <SkT w="5em" />
                </td>
                <td>
                  <SkT w="5.5em" />
                </td>
                <td>
                  <SkT w={widths(i, 6)} />
                </td>
                <td className="text-muted">
                  <SkT w="6em" />
                </td>
                <td className="text-muted">
                  <SkT w={widths(i, 7, 2)} />
                </td>
                <td className="num" />
              </tr>
            ))}
          </tbody>
        </table>
      </SkRegion>
    );
  }
  if (mobileV2) {
    return (
      <SkRegion page="activity" className="tx-groups">
        {[3, 4].map((rows, group) => (
          <section key={group} className="tx-group">
            <h3 className="tx-group-head">
              <span className="tx-day-head">
                <SkT className="tx-day-label" w="6em" />
                <SkT className="tx-day-sum" w="5em" />
              </span>
            </h3>
            <ul className="tx-list">
              {Array.from({ length: rows }, (_, i) => (
                <TxTileSk key={i} i={i + group} />
              ))}
            </ul>
          </section>
        ))}
      </SkRegion>
    );
  }
  return (
    <SkRegion page="activity" as="ul" className="tx-list">
      {Array.from({ length: 7 }, (_, i) => (
        <TxTileSk key={i} i={i} />
      ))}
    </SkRegion>
  );
}

/* ---- Wallets and Cards ---- */

function WalletCardSk({ v2 }: { v2: boolean }) {
  if (v2) {
    return (
      <article className="wallet-card wallet-card--v2">
        <div className="wallet-bankcard">
          <header className="wallet-bankcard-top">
            <Sk className="avatar sk-avatar" />
            <div className="wallet-bankcard-id">
              <SkT className="wallet-card-name" w="7em" />
              <SkT className="wallet-bankcard-sub" w="5em" />
            </div>
          </header>
          <div className="wallet-bankcard-balance">
            <SkT className="wallet-bankcard-label" w="4em" />
            <SkT className="wallet-bankcard-value" w="6em" />
          </div>
        </div>
        <dl className="wallet-rows">
          {[0, 1].map((i) => (
            <div key={i} className="cluster cluster--between">
              <SkT w="5em" />
              <SkT w="4em" />
            </div>
          ))}
        </dl>
      </article>
    );
  }
  return (
    <article className="wallet-card">
      <header className="wallet-card-head">
        <Sk className="avatar sk-avatar" />
        <div className="stack stack--tight" style={{ gap: 2 }}>
          <SkT className="wallet-card-name" w="7em" />
          <SkT className="list-item-sub" w="5em" />
        </div>
      </header>
      <div className="wallet-card-figures">
        {[0, 1].map((i) => (
          <div key={i} className="metric">
            <SkT className="section-label" w="4em" />
            <SkT className="metric-value" w="5.5em" />
          </div>
        ))}
      </div>
      <footer className="wallet-card-foot">
        <SkT className="section-label" w="8em" />
      </footer>
    </article>
  );
}

/** Wallets: a group header over its grid of wallet cards (bank cards in the new phone layout). */
export function WalletsSkeleton({ groups = [2, 1] }: { groups?: number[] }) {
  const mobileV2 = useMobileV2();
  return (
    <SkRegion page="wallets" className="stack">
      {groups.map((cards, g) => (
        <section key={g} className="wallet-group">
          <header className="wallet-group-head">
            <div className="stack" style={{ gap: 2 }}>
              <SkT as="h2" className="wallet-group-title" w="6em" />
              <SkT className="list-item-sub" w="10em" />
            </div>
            <div className="wallet-group-total">
              <SkT className="section-label" w="3em" />
              <SkT className="metric-value" w="5em" />
            </div>
          </header>
          <div className="wallet-grid">
            {Array.from({ length: cards }, (_, i) => (
              <WalletCardSk key={i} v2={mobileV2} />
            ))}
          </div>
        </section>
      ))}
    </SkRegion>
  );
}

/** Cards: the credit cards' grid. */
export function CardsSkeleton() {
  const mobileV2 = useMobileV2();
  return (
    <SkRegion page="cards" className="wallet-grid">
      {[0, 1].map((i) => (
        <WalletCardSk key={i} v2={mobileV2} />
      ))}
    </SkRegion>
  );
}

/* ---- Budgets ---- */

export function BudgetsSkeleton() {
  return (
    <SkRegion page="budgets" className="list">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="budget-item">
          <div className="budget-head">
            <SkT className="budget-name" w={widths(i, 6)} />
            <SkT className="budget-numbers" w="9em" />
          </div>
          <Sk className="sk-bar-h" />
          <div className="budget-foot">
            <SkT w="6em" />
            <SkT w="5em" />
          </div>
        </div>
      ))}
    </SkRegion>
  );
}

/* ---- Debt ---- */

export function DebtSkeleton() {
  return (
    <SkRegion page="debt" className="debt-list">
      {[0, 1].map((i) => (
        <article key={i} className="debt-card">
          <header className="debt-card-head">
            <div className="debt-card-identity">
              <Sk className="debt-card-mark sk-avatar" w={40} h={40} />
              <div>
                <SkT as="h2" className="debt-card-title" w={widths(i, 7)} />
                <SkT as="p" className="debt-card-terms" w="11em" />
              </div>
            </div>
            <span className="debt-card-balance">
              <SkT className="section-label" w="4em" />
              <SkT w="6em" />
            </span>
          </header>
          <div className="debt-card-progress">
            <Sk className="sk-bar-h" />
          </div>
          <dl className="debt-card-figures">
            {[0, 1, 2].map((j) => (
              <div key={j}>
                <SkT as="dt" w="4em" />
                <SkT as="dd" w="5em" />
              </div>
            ))}
          </dl>
        </article>
      ))}
    </SkRegion>
  );
}

/* ---- Shared ---- */

export function SharedSkeleton() {
  return (
    <SkRegion page="shared" className="split-grid">
      {[0, 1].map((i) => (
        <article key={i} className="split-card">
          <header className="split-card-head">
            <div className="stack">
              <SkT className="split-card-title" w={widths(i, 7)} />
              <SkT className="list-item-sub" w="8em" />
            </div>
          </header>
          <div className="split-card-figures">
            {[0, 1, 2].map((j) => (
              <div key={j} className="metric">
                <SkT className="section-label" w="4em" />
                <SkT className="metric-value" w="5em" />
              </div>
            ))}
          </div>
          <div className="split-progress">
            <Sk className="sk-bar-h" />
          </div>
          <div className="split-people">
            {[0, 1, 2].map((j) => (
              <Sk key={j} className="sk-pill" w="6em" h={28} />
            ))}
          </div>
        </article>
      ))}
    </SkRegion>
  );
}

/* ---- Recurring ---- */

export function RecurringSkeleton() {
  return (
    <SkRegion page="recurring" className="timeline">
      {[2, 2].map((rows, g) => (
        <section key={g} className="timeline-group">
          <header className="timeline-head">
            <span className="timeline-dot" />
            <SkT className="timeline-title" w="6em" />
          </header>
          <div className="timeline-items">
            {Array.from({ length: rows }, (_, i) => (
              <article key={i} className="sub-card">
                <span className="sub-rail" />
                <div className="sub-main">
                  <div className="sub-title-row">
                    <SkT as="h3" className="sub-name" w={widths(i + g, 7)} />
                  </div>
                  <SkT className="sub-meta" w="10em" />
                </div>
                <div className="sub-side">
                  <SkT className="sub-amount" w="5em" />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </SkRegion>
  );
}

/* ---- Goals ---- */

export function GoalsSkeleton() {
  return (
    <SkRegion page="goals" className="goals-skeleton">
      <section className="alloc">
        <div className="alloc-figures">
          {[0, 1, 2].map((i) => (
            <div key={i} className="alloc-figure">
              <SkT className="section-label" w="6em" />
              <SkT className="metric-value" w="6em" />
              <SkT className="alloc-hint" w="8em" />
            </div>
          ))}
        </div>
        <Sk className="sk-bar-h" />
      </section>
      <div className="goal-grid goal-grid--skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="goal-card">
            <SkT className="metric-value" w={widths(i, 6)} />
            <Sk className="sk-bar-h" />
            <SkT w="6em" />
            <Sk className="sk-btn" w="8em" />
          </div>
        ))}
      </div>
    </SkRegion>
  );
}

/* ---- Notes ---- */

export function NotesListSkeleton() {
  return (
    <SkRegion page="notes" as="ul" className="note-list">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="note-row">
          <div className="note-row-main">
            <div className="note-row-head">
              <SkT className="note-row-title" w={widths(i, 7)} />
            </div>
            <SkT className="note-row-preview" w={widths(i, 14, 3)} />
            <div className="note-row-meta">
              <SkT className="note-row-time" w="5em" />
            </div>
          </div>
        </li>
      ))}
    </SkRegion>
  );
}

/** One note (or a lazily loaded editor): a title and paragraph lines. */
export function NoteBodySkeleton({ page = 'note', remember = true }: { page?: string; remember?: boolean }) {
  return (
    <SkRegion page={page} className="stack" remember={remember}>
      <SkT as="h2" className="card-title" w="12em" />
      {[100, 96, 88, 100, 64, 92].map((w, i) => (
        <SkT key={i} as="p" w={`${w}%`} />
      ))}
    </SkRegion>
  );
}

/* ---- Investments ---- */

/** Investments while its positions load: the summary figures and the holdings. */
export function InvestmentsSkeleton() {
  return (
    <SkRegion page="investments" className="stack">
      <section className="card">
        <div className="hero-metrics">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="metric">
              <SkT className="section-label" w="5em" />
              <SkT className="metric-value" w="6em" />
              <SkT className="metric-hint" w="5em" />
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <header className="card-head">
          <div>
            <SkT as="h2" className="card-title" w="8em" />
          </div>
        </header>
        <SkListRows rows={5} />
      </section>
    </SkRegion>
  );
}

/** A plain list region (Investments' watchlist, Widgets, a quick view). */
export function ListRegionSkeleton({
  page,
  rows = 4,
  className,
  remember = true,
}: {
  page: string;
  rows?: number;
  className?: string;
  remember?: boolean;
}) {
  return (
    <SkRegion page={page} className={className} remember={remember}>
      <SkListRows rows={rows} />
    </SkRegion>
  );
}

/* ---- Settings ---- */

/** The workbook card's fields while the backend answers. */
export function SettingsHealthSkeleton() {
  return (
    <SkRegion page="settings" id="workbook" className="form-grid">
      {[0, 1].map((i) => (
        <div key={i} className="field">
          <SkT className="field-label" w="6em" />
          {/* The input's own frame, so it takes the input's height. */}
          <span className="control">
            <SkT w={widths(i, 8, 3)} />
          </span>
        </div>
      ))}
      <SkT as="p" className="span-2 text-muted" w="22em" />
      <div className="span-2 form-actions">
        <Sk className="sk-btn" w="9em" h={36} />
      </div>
    </SkRegion>
  );
}

/* ---- Deep analytics ---- */

/** The explorer's frame while its code loads: header, settings side, stage. */
export function DeepFrameSkeleton({ page = 'deep' }: { page?: string }) {
  return (
    <SkRegion page={page} className="xp-page">
      <header className="xp-page-head">
        <span className="xp-back">
          <SkT w="9em" />
        </span>
        <div className="xp-title-block">
          <Sk className="xp-mark" />
          <div>
            <SkT as="h1" w="9em" />
            <SkT as="p" w="12em" />
          </div>
        </div>
      </header>
      <div className="xp-layout">
        <div className="xp-side">
          <Sk className="sk-btn" w="100%" h={44} />
        </div>
        <section className="xp-main">
          <div className="xp-stage">
            <DeepStageBody />
          </div>
        </section>
      </div>
    </SkRegion>
  );
}

function DeepStageBody() {
  return (
    <div className="sk-chart" style={{ height: 320 }}>
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="sk-chart-col">
          <Sk className="sk-chart-bar" h={`${30 + ((i * 29) % 60)}%`} />
        </span>
      ))}
    </div>
  );
}

/** The explorer's stage while a source loads. */
export function DeepStageSkeleton() {
  return (
    <SkRegion page="deep" id="stage">
      <DeepStageBody />
    </SkRegion>
  );
}

/* ---- Widgets ---- */

/** The Widgets page while its code loads: its page head over a card. */
export function WidgetsFrameSkeleton() {
  return (
    <SkRegion page="widgets-page" className="stack widgets-page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <SkT className="section-label" w="5em" />
          <SkT as="h1" className="page-title" w="7em" />
          <SkT as="p" className="page-lede" w="18em" />
        </div>
      </div>
      <section className="card">
        <header className="card-head">
          <div>
            <SkT as="h2" className="card-title" w="8em" />
          </div>
        </header>
        <SkListRows rows={3} />
      </section>
    </SkRegion>
  );
}
