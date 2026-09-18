import { useMemo } from 'react';

import { ChartSpec, RawDataset } from '../lib/explorerData';
import { ChartBuild, buildChart } from '../lib/explorerChartMath';

/**
 * The drawable chart for the current state — every panel, and the one
 * coordinate system they all share.
 *
 * A thin memo over `buildChart`, which is pure and tested on its own. The
 * inputs are all referentially stable between unrelated renders (the filtered
 * dataset is the same object while no filter changes, the colour set is
 * memoised on the stored map), so hovering a chart or opening the settings
 * panel never re-partitions the table.
 *
 * Null until there is a dataset and a spec to build from.
 */
export function useChartMath(
  dataset: RawDataset | null,
  filtered: RawDataset | null,
  spec: ChartSpec | null,
  customColored: ReadonlySet<string>,
): ChartBuild | null {
  return useMemo(
    () => (dataset && filtered && spec ? buildChart(dataset, filtered, spec, customColored) : null),
    [dataset, filtered, spec, customColored],
  );
}
