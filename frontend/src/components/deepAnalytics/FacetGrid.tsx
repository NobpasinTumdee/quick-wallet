import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Series } from '../../lib/explorerData';
import { ChartDomains, FacetShape, MAX_FACETS } from '../../lib/explorerChartMath';
import { ExplorerChart } from './ExplorerChart';

/**
 * Small multiples — one chart per Page By value, JMP's Page / Tableau's
 * trellis.
 *
 * ---------------------------------------------------------------------------
 * ONE COORDINATE SYSTEM
 * ---------------------------------------------------------------------------
 * Every panel receives the *same* `domains` object and shapes built from the
 * same frame: identical Y range, identical X range or band list, identical
 * series and colours. That is what lets the eye compare panels by position
 * alone — the whole reason to facet instead of filtering one at a time. A
 * panel whose data is small draws small; it is never stretched to fill.
 *
 * ---------------------------------------------------------------------------
 * THE GRID
 * ---------------------------------------------------------------------------
 * One column on a phone, two on a tablet, three on a desktop — and never more
 * columns than panels, so two panels do not sit in a three-wide grid with a
 * hole. Plain media queries in deepAnalytics.css; the project has no utility
 * framework and one component does not justify adding one.
 */
export function FacetGrid({
  facets,
  faceted,
  domains,
  facetLabel,
  colorOf,
  locale,
  xLabel,
  yLabel,
  bandLabel,
  seriesLabel,
}: {
  facets: FacetShape[];
  faceted: boolean;
  domains: ChartDomains;
  facetLabel: (key: string) => string;
  colorOf: (series: Series) => string;
  locale: string;
  xLabel: string;
  yLabel: string;
  bandLabel: (key: string) => string[];
  seriesLabel: (key: string) => string;
}) {
  const { t } = useTranslation();
  const chartProps = { domains, colorOf, locale, xLabel, yLabel, bandLabel, seriesLabel };

  if (!faceted) {
    const only = facets[0];
    return only ? <ExplorerChart shape={only.shape} {...chartProps} /> : null;
  }

  const columns = Math.min(3, facets.length);

  return (
    <ul className={`xp-facets xp-facets--${columns}`} aria-label={t('explorer.facetGrid', { count: facets.length })}>
      {facets.map((facet) => {
        const title = facet.key === null ? '' : facetLabel(facet.key);
        return (
          <li key={facet.key ?? ''} className="xp-facet">
            <header className="xp-facet-head">
              <h3 title={title}>{title}</h3>
              <span>{t('explorer.rowCount', { count: facet.rowCount })}</span>
            </header>
            <ExplorerChart shape={facet.shape} compact {...chartProps} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Shown instead of the grid when Page By would make more panels than can be
 * read. Says how many it would have been, what the limit is, and the two ways
 * out — never draws a subset silently, which would read as "these are all".
 */
export function TooManyFacets({ count, column }: { count: number; column: string }) {
  const { t } = useTranslation();
  return (
    <div className="xp-message xp-facet-limit" role="status">
      <Icon icon={LayoutGrid} />
      <p>
        <strong>{t('explorer.problemTooManyFacets')}</strong>
      </p>
      <p>{t('explorer.tooManyFacetsDetail', { panels: count, max: MAX_FACETS, column })}</p>
    </div>
  );
}
