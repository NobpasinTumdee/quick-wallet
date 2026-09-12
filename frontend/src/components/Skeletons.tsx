import { cx } from '../lib/format';

/**
 * Skeletons that mirror the real layout.
 *
 * The point isn't "show something while loading" — it's that the page must not
 * move when the data lands. Each block below occupies the same grid slot and
 * roughly the same height as the component it stands in for, so the Apps Script
 * cold start reads as a fade-in rather than a re-layout.
 */

export function SkeletonLine({
  width = '100%',
  height = 12,
  className,
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={cx('sk', className)}
      style={{ width, height, borderRadius: height > 20 ? 'var(--radius-sm)' : 'var(--radius-xs)' }}
    />
  );
}

/** Hero + bento, matching DashboardPage's structure exactly. */
export function DashboardSkeleton() {
  return (
    <>
      <section className="hero sk-hero" aria-hidden="true">
        <div className="hero-primary">
          <SkeletonLine width={140} height={10} />
          <SkeletonLine width="72%" height={48} className="sk-strong" />
          <div className="cluster" style={{ marginTop: 4 }}>
            <SkeletonLine width={130} height={22} />
            <SkeletonLine width={180} height={12} />
          </div>
        </div>

        <div className="hero-metrics">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="metric">
              <SkeletonLine width={62} height={9} />
              <SkeletonLine width="70%" height={18} className="sk-strong" />
              <SkeletonLine width={54} height={9} />
            </div>
          ))}
        </div>
      </section>

      <div className="bento" aria-hidden="true">
        <div className="card bento-item--wide sk-card">
          <SkeletonCardHead />
          <div className="card-body stack stack--loose">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="stack stack--tight">
                <div className="cluster cluster--between">
                  <SkeletonLine width={110} height={14} />
                  <SkeletonLine width={130} height={12} />
                </div>
                <SkeletonLine height={6} />
                <div className="cluster cluster--between">
                  <SkeletonLine width={80} height={9} />
                  <SkeletonLine width={70} height={9} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card bento-item--narrow sk-card">
          <SkeletonCardHead />
          <div className="card-body stack stack--loose">
            {[0, 1, 2].map((i) => (
              <div key={i} className="cluster" style={{ flexWrap: 'nowrap' }}>
                <SkeletonLine width={40} height={40} className="sk-avatar" />
                <div className="stack stack--tight" style={{ flex: 1 }}>
                  <SkeletonLine width="55%" height={13} />
                  <SkeletonLine width="75%" height={9} />
                </div>
                <SkeletonLine width={72} height={14} />
              </div>
            ))}
          </div>
        </div>

        <div className="card bento-item--half sk-card">
          <SkeletonCardHead />
          <div className="card-body">
            <div className="sk-chart">
              {[46, 62, 38, 78, 55, 88].map((height, i) => (
                <span key={i} className="sk sk-bar" style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="card bento-item--half sk-card">
          <SkeletonCardHead />
          <div className="card-body stack">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="share-row">
                <SkeletonLine width="70%" height={12} />
                <SkeletonLine height={6} />
                <SkeletonLine width={64} height={12} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SkeletonCardHead() {
  return (
    <div className="card-head">
      <div className="stack stack--tight">
        <SkeletonLine width={120} height={14} />
        <SkeletonLine width={80} height={10} />
      </div>
      <SkeletonLine width={72} height={28} />
    </div>
  );
}

/** Rows for list- and table-shaped pages. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-item">
          <SkeletonLine width={40} height={40} className="sk-avatar" />
          <div className="stack stack--tight" style={{ flex: 1 }}>
            <SkeletonLine width={`${45 + ((i * 13) % 30)}%`} height={13} />
            <SkeletonLine width={`${30 + ((i * 17) % 25)}%`} height={9} />
          </div>
          <SkeletonLine width={80} height={14} />
        </div>
      ))}
    </div>
  );
}

/** Card grid used by the Wallets page. */
export function WalletGridSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="wallet-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="wallet-card sk-card">
          <div className="cluster" style={{ flexWrap: 'nowrap' }}>
            <SkeletonLine width={40} height={40} className="sk-avatar" />
            <div className="stack stack--tight" style={{ flex: 1 }}>
              <SkeletonLine width="60%" height={15} />
              <SkeletonLine width="40%" height={9} />
            </div>
          </div>
          <div className="wallet-card-figures">
            {[0, 1].map((j) => (
              <div key={j} className="metric">
                <SkeletonLine width={54} height={9} />
                <SkeletonLine width="80%" height={17} className="sk-strong" />
              </div>
            ))}
          </div>
          <div className="wallet-card-foot">
            <SkeletonLine width={100} height={9} />
          </div>
        </div>
      ))}
    </div>
  );
}
