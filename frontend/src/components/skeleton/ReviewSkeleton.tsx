import { Sk, SkCard, SkHead, SkRegion, SkT } from './Sk';

/**
 * The month review while it loads, in the page's own classes (its header,
 * its grid, its cards), so nothing moves when the numbers land. The header
 * is drawn by the page itself once its chunk is in; before that (the
 * Suspense fallback) it is drawn here too.
 */
export function ReviewSkeleton({ head = true }: { head?: boolean }) {
  return (
    <div className="mr">
      {head && (
        <header className="page-head mr-head">
          <div className="mr-title-row">
            <SkT as="h1" className="page-title" w="8em" />
          </div>
          <div className="mr-actions">
            <Sk className="sk-btn" w={92} />
          </div>
        </header>
      )}
      <SkRegion page="mr" className="mr-grid">
        <SkCard className="mr-span mr-callout" head={<SkHead title="6em" subtitle={false} />}>
          <ul className="mr-highlights">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i}>
                <SkT w={`${18 + (i % 3) * 4}em`} />
              </li>
            ))}
          </ul>
        </SkCard>
        <SkCard className="mr-span" head={<SkHead title="9em" subtitle={false} />}>
          <div className="mr-totals mr-totals--sk">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mr-total">
                <SkT className="mr-total-label" w="5em" />
                <SkT className="mr-total-value" w="6em" />
                <SkT className="mr-total-sub" w="8em" />
                <SkT className="mr-total-sub" w="9em" />
              </div>
            ))}
          </div>
        </SkCard>
        {[5, 3, 3, 5, 2].map((rows, card) => (
          <SkCard key={card} head={<SkHead title="8em" subtitle={card < 2 ? "6em" : false} />}>
            <ul className="mr-rows">
              {Array.from({ length: rows }, (_, i) => (
                <li key={i} className="mr-row">
                  <SkT className="mr-row-name" w={`${6 + (i % 3) * 1.5}em`} />
                  <SkT className="mr-row-value" w="4.5em" />
                </li>
              ))}
            </ul>
          </SkCard>
        ))}
        <SkCard head={<SkHead title="7em" subtitle={false} />}>
          <div className="mr-tiles">
            {[0, 1].map((i) => (
              <div key={i} className="metric">
                <SkT className="stat-label" w="8em" />
                <SkT className="metric-value" w="5em" />
                <SkT className="mr-quiet" w="9em" />
              </div>
            ))}
          </div>
        </SkCard>
      </SkRegion>
    </div>
  );
}
