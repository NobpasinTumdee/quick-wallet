import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';

import { CategorySlice, categoryComposition } from '../lib/analyticsMath';
import { formatPercent } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Transaction } from '../types';

/**
 * Expenses by category, as a treemap.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLOUR IS A SEQUENTIAL RAMP AND NOT A CATEGORICAL PALETTE
 * ---------------------------------------------------------------------------
 * The obvious treemap gives every category its own hue. That is a categorical
 * palette, and a categorical palette has to stay distinguishable under
 * colour-vision deficiency — which is checkable for a fixed set of eight, but
 * not for eight arbitrary hues multiplied by thirteen user-switchable themes
 * and a custom accent. It would be unverifiable by construction.
 *
 * So colour here encodes *magnitude*, the same thing the area encodes: one hue,
 * strongest for the largest tile, fading down the ranking. Monotone by
 * construction, safe in every theme, and the redundancy costs nothing because
 * identity is carried by the label inside each tile.
 *
 * The tail folds into "Other" rather than being dropped — `categoryComposition`
 * caps the list, and a breakdown whose parts do not sum to the total is not one.
 */

/* The index signature is Recharts' requirement, not ours: `TreemapDataType`
   is an open record, so a closed interface will not satisfy it. */
interface TileDatum extends CategorySlice {
  name: string;
  size: number;
  /** 1 for the largest slice, fading toward 0 — drives the fill alpha. */
  weight: number;
  [key: string]: unknown;
}

/** Recharts hands each tile its datum plus the rect it computed. */
interface TileProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: TileDatum;
  name?: string;
  weight?: number;
  isOther?: boolean;
  share?: number;
}

/**
 * One tile.
 *
 * Labels only appear where they fit. A treemap that writes text into a 20px
 * sliver produces overlapping glyphs and a clipped mess, so the small tiles
 * stay blank and rely on the tooltip.
 */
function Tile(props: TileProps) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  const weight = props.weight ?? props.payload?.weight ?? 0;
  const name = props.name ?? props.payload?.category ?? '';
  const share = props.share ?? props.payload?.share ?? 0;

  const roomForLabel = width > 62 && height > 34;
  const roomForShare = width > 62 && height > 52;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        className="atree-tile"
        style={{ '--weight': weight } as React.CSSProperties}
      />
      {roomForLabel && (
        <text x={x + 10} y={y + 22} className="atree-label">
          {name}
        </text>
      )}
      {roomForShare && (
        <text x={x + 10} y={y + 39} className="atree-share">
          {formatPercent(share, 0)}
        </text>
      )}
    </g>
  );
}

function TreeTip({
  active,
  payload,
  money,
}: {
  active?: boolean;
  payload?: { payload: TileDatum }[];
  money: MoneyFormatter;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  if (!slice?.category) return null;

  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-value">{money(slice.total)}</div>
      <div className="chart-tip-muted">
        {slice.category} · {formatPercent(slice.share, 1)}
      </div>
      <div className="chart-tip-flow">
        <span className="chart-tip-name">{t('analytics.merchantsColumnCount')}</span>
        <span className="ischart-tip-amount">{slice.count}</span>
      </div>
    </div>
  );
}

export function AnalyticsCategories({
  transactions,
  money,
}: {
  transactions: Transaction[];
  money: MoneyFormatter;
}) {
  const { t } = useTranslation();
  const { slices } = categoryComposition(transactions, 7, t('analytics.categoriesOther'));

  if (!slices.length) return null;

  /* Ranked weight rather than a share-proportional one. Share would make a
     dominant category (rent at 60%) the only visible tile and wash the rest to
     nothing; ranking keeps the ramp legible whatever the distribution. */
  const data: TileDatum[] = slices.map((slice, index) => ({
    ...slice,
    name: slice.category,
    size: slice.total,
    weight: slices.length > 1 ? 1 - index / (slices.length - 1) : 1,
  }));

  return (
    <div className="atree">
      <ResponsiveContainer width="100%" height={240}>
        <Treemap
          data={data}
          dataKey="size"
          /* Recharts animates tiles from zero on every re-render, which on a
             filter change reads as the card reloading. */
          isAnimationActive={false}
          content={<Tile />}
        >
          <Tooltip isAnimationActive={false} content={<TreeTip money={money} />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
