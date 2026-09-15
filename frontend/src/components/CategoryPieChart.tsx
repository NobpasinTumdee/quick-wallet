import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CategorySlice, categoryComposition } from '../lib/analyticsMath';
import { donutArcs } from '../lib/donut';
import { cx } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Transaction } from '../types';

/**
 * Expenses by category, as a donut.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GROUPING IS NOT DONE HERE
 * ---------------------------------------------------------------------------
 * `categoryComposition` in `analyticsMath` already ranks categories, computes
 * each share, and folds the tail into "Other". The treemap on this same screen
 * reads it. A second grouping here would be a second definition of what counts
 * as an expense and what "Other" contains, and the two would drift the first
 * time one of them learned about a new transaction type.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE HUE AND NOT EIGHT
 * ---------------------------------------------------------------------------
 * The same argument the treemap makes, and it applies harder to a donut. A
 * categorical palette has to stay distinguishable under colour-vision
 * deficiency; that is checkable for one fixed set of eight hues, and not
 * checkable at all for eight hues multiplied by thirteen user-switchable themes
 * and a free-form accent. So colour encodes rank — strongest for the largest
 * slice, fading down — which is monotone by construction and correct in every
 * theme.
 *
 * Identity is carried by the legend and by the hover readout, never by colour
 * alone. That is the part that makes the ramp sufficient rather than a
 * compromise: nothing on this chart requires telling slice five from slice six
 * by looking at them.
 *
 * ---------------------------------------------------------------------------
 * WHY A DONUT AND NOT A PIE
 * ---------------------------------------------------------------------------
 * The hole earns its place: it holds the total, which is the number every
 * percentage on the ring is a percentage *of*. A pie has nowhere to put that
 * except a caption the eye has to travel to.
 */

/* The SVG's own units. The viewBox scales to the container. */
const SIZE = 220;
const OUTER = 100;
const INNER = 64;
/* Just enough to separate neighbouring slices without reading as a gap. */
const PAD_ANGLE = 1.2;

export function CategoryPieChart({
  transactions,
  money,
  /** Shown in the hole under the total. */
  rangeLabel,
}: {
  transactions: Transaction[];
  money: MoneyFormatter;
  rangeLabel: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<number | null>(null);

  /* The same label the treemap passes, so the two charts on this screen do not
     disagree about what the tail bucket is called. */
  const otherLabel = t('analytics.categoriesOther');
  const { slices, total } = useMemo(
    () => categoryComposition(transactions, 7, otherLabel),
    [transactions, otherLabel],
  );

  const arcs = useMemo(
    () =>
      donutArcs(
        slices.map((slice) => slice.total),
        {
          cx: SIZE / 2,
          cy: SIZE / 2,
          outerRadius: OUTER,
          innerRadius: INNER,
          padAngle: PAD_ANGLE,
        },
      ),
    [slices],
  );

  if (slices.length === 0) {
    return (
      <div className="pie pie--empty">
        <p>{t('pie.empty')}</p>
        <p className="pie-hint">{t('pie.emptyHint')}</p>
      </div>
    );
  }

  const active = hovered === null ? null : (slices[hovered] ?? null);

  /* Rank → alpha. The largest slice takes the accent at full strength and the
     ramp never falls below 0.28, past which a slice stops reading as filled at
     all against the glass behind it. */
  const weightOf = (index: number) =>
    slices.length === 1 ? 1 : 1 - (index / (slices.length - 1)) * 0.72;

  return (
    <div className="pie">
      <div className="pie-figure">
        <svg
          className="pie-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={t('pie.ariaLabel', { count: slices.length, amount: money(total) })}
        >
          {arcs.map((arc, index) => (
            <path
              key={slices[index].category}
              className={cx(
                'pie-slice',
                slices[index].isOther && 'is-other',
                hovered !== null && hovered !== index && 'is-dimmed',
                hovered === index && 'is-active',
              )}
              d={arc.path}
              style={{ '--pie-weight': weightOf(index) } as React.CSSProperties}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {/* The hole. Shows the hovered slice when there is one and the total
            otherwise, so the centre always answers the question the ring is
            currently posing rather than sitting inert. */}
        <div className="pie-centre" aria-hidden="true">
          {active ? (
            <>
              <span className="pie-centre-share">{Math.round(active.share)}%</span>
              <span className="pie-centre-label">{active.category}</span>
              <span className="pie-centre-total">{money(active.total)}</span>
            </>
          ) : (
            <>
              <span className="pie-centre-total-strong">{money(total)}</span>
              <span className="pie-centre-label">{rangeLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* The legend is the real interface: it carries identity, it is
          keyboard-reachable, and it is where the exact figures live. Hovering
          either it or the ring highlights both. */}
      <ul className="pie-legend">
        {slices.map((slice, index) => (
          <li key={slice.category}>
            <button
              type="button"
              className={cx(
                'pie-legend-item',
                hovered !== null && hovered !== index && 'is-dimmed',
                hovered === index && 'is-active',
              )}
              style={{ '--pie-weight': weightOf(index) } as React.CSSProperties}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
            >
              <span className="pie-legend-swatch" aria-hidden="true" />
              <span className="pie-legend-name">{slice.category}</span>
              <span className="pie-legend-share">{formatShare(slice)}</span>
              <span className="pie-legend-amount">{money(slice.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A share, rounded for reading but never to a misleading zero.
 *
 * A category at 0.4% is not 0% — it is small, and saying 0% next to a non-zero
 * amount reads as a bug. Anything under half a percent shows as "<1%".
 */
function formatShare(slice: CategorySlice): string {
  if (slice.share > 0 && slice.share < 0.5) return '<1%';
  return `${Math.round(slice.share)}%`;
}
