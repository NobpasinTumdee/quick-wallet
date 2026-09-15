/**
 * Annular-sector geometry for a donut chart.
 *
 * Pure, and separate from the component, because arc maths is the part that is
 * actually easy to get wrong — the large-arc flag, the sweep direction, the
 * wrap past 12 o'clock — and none of it is checkable by looking at a rendered
 * chart, where a wrong flag produces a shape that is merely *plausible*.
 */

export interface Arc {
  /** An SVG path for the filled sector. */
  path: string;
  /** Mid-angle point on the ring, for a callout or label. */
  centroid: { x: number; y: number };
  startAngle: number;
  endAngle: number;
}

export interface DonutOptions {
  /** Centre. */
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  /**
   * Gap between slices, in degrees. Trimmed off each end of every arc, so a
   * ring of many small slices does not become one continuous band.
   */
  padAngle?: number;
  /** Where the first slice starts. -90 puts it at twelve o'clock. */
  startAngle?: number;
}

/**
 * Polar to cartesian, with 0° at twelve o'clock and angles running clockwise.
 *
 * SVG's y-axis grows downward, so the usual `sin` for y already produces
 * clockwise motion without negating anything — the thing that catches people
 * out is expecting it to run the other way and "fixing" it into a mirror.
 */
export function pointOnCircle(
  cx: number,
  cy: number,
  radius: number,
  degrees: number,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

/**
 * One annular sector as a closed path.
 *
 * Outer arc clockwise, straight line inward, inner arc anticlockwise back, and
 * close. The `largeArcFlag` is the one non-obvious part: it has to be set once
 * the sector spans more than 180°, or the renderer draws the *minor* arc and
 * the slice comes out as its own complement — a 70% slice rendered as 30%,
 * which looks like a legitimate chart of different data.
 */
export function annularSector(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;

  /* A full ring has no start and end to join, and expressing it as one arc of
     360° is degenerate — the two endpoints coincide and most renderers draw
     nothing at all. Two half-arcs are the standard way round it. */
  if (sweep >= 359.999) {
    const o1 = pointOnCircle(cx, cy, outerRadius, 0);
    const o2 = pointOnCircle(cx, cy, outerRadius, 180);
    const i1 = pointOnCircle(cx, cy, innerRadius, 0);
    const i2 = pointOnCircle(cx, cy, innerRadius, 180);
    return [
      `M ${o1.x} ${o1.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${o2.x} ${o2.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${o1.x} ${o1.y}`,
      `M ${i1.x} ${i1.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${i2.x} ${i2.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${i1.x} ${i1.y}`,
      'Z',
    ].join(' ');
  }

  const largeArc = sweep > 180 ? 1 : 0;

  const outerStart = pointOnCircle(cx, cy, outerRadius, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerRadius, endAngle);
  const innerEnd = pointOnCircle(cx, cy, innerRadius, endAngle);
  const innerStart = pointOnCircle(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

/**
 * Lay out a donut from a list of values.
 *
 * Angles come from each value's share of the total, so the ring always closes:
 * accumulating `share` percentages instead would leave a hairline gap wherever
 * the rounding did not quite reach 100.
 */
export function donutArcs(values: number[], options: DonutOptions): Arc[] {
  const { cx, cy, outerRadius, innerRadius } = options;
  const padAngle = options.padAngle ?? 0;
  const start = options.startAngle ?? -90;

  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return [];

  const arcs: Arc[] = [];
  let cursor = start;

  for (const value of values) {
    const sweep = (Math.max(0, value) / total) * 360;
    const from = cursor;
    const to = cursor + sweep;
    cursor = to;

    if (sweep <= 0) continue;

    /* The gap is only taken where there is room for it. On a sliver thinner
       than the padding, trimming both ends would invert the arc and render a
       sector going the wrong way round the circle. */
    const pad = sweep > padAngle * 2 ? padAngle : 0;
    const paddedFrom = from + pad;
    const paddedTo = to - pad;

    arcs.push({
      path: annularSector(cx, cy, outerRadius, innerRadius, paddedFrom, paddedTo),
      centroid: pointOnCircle(cx, cy, (outerRadius + innerRadius) / 2, (from + to) / 2),
      startAngle: from,
      endAngle: to,
    });
  }

  return arcs;
}
