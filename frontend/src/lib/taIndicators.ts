import { TranslationKey } from '../locales';

/**
 * Which indicators exist, where they are drawn, and what they are tuned by.
 *
 * ---------------------------------------------------------------------------
 * WHY A REGISTRY AND NOT TEN BRANCHES IN THE COMPONENT
 * ---------------------------------------------------------------------------
 * Every one of these has to appear in four places: the control bar, the
 * parameter editor, the series that gets created, and the series that gets
 * destroyed when it is switched off. Ten `if` branches across four places is
 * forty chances for one of them to disagree — usually the teardown, which is
 * how a chart ends up with an orphaned pane after a toggle.
 *
 * Declared once here, the component iterates. Adding an eleventh indicator is
 * an entry in this table plus one `case` in the series builder.
 *
 * ---------------------------------------------------------------------------
 * OVERLAY vs PANE
 * ---------------------------------------------------------------------------
 * An overlay shares the price axis because it *is* a price — a moving average
 * sits among the candles it averages. An oscillator does not: RSI is 0–100 and
 * MACD swings around zero, and forcing either onto a price scale flattens the
 * candles into a line. So oscillators each get their own pane below.
 */

export type IndicatorId =
  | 'sma'
  | 'ema'
  | 'bollinger'
  | 'vwap'
  | 'ichimoku'
  | 'rsi'
  | 'macd'
  | 'stochastic'
  | 'atr'
  | 'adx';

export type IndicatorPlacement = 'overlay' | 'pane';

export interface IndicatorParam {
  key: string;
  labelKey: TranslationKey;
  min: number;
  max: number;
  default: number;
}

export interface IndicatorSpec {
  id: IndicatorId;
  labelKey: TranslationKey;
  /** The short tag on the chip — "RSI", "BB". Not translated: these are the
      names traders use in every language, and a localised "ดัชนี" would be
      harder for a Thai reader following a TradingView tutorial. */
  tag: string;
  placement: IndicatorPlacement;
  params: IndicatorParam[];
  /** Needs volume, which not every provider sends. */
  needsVolume?: boolean;
}

const period = (defaultValue: number, min = 2, max = 250): IndicatorParam => ({
  key: 'period',
  labelKey: 'ta.paramPeriod',
  min,
  max,
  default: defaultValue,
});

export const INDICATORS: readonly IndicatorSpec[] = [
  { id: 'sma', labelKey: 'ta.sma', tag: 'MA', placement: 'overlay', params: [period(20)] },
  { id: 'ema', labelKey: 'ta.ema', tag: 'EMA', placement: 'overlay', params: [period(50)] },
  {
    id: 'bollinger',
    labelKey: 'ta.bollinger',
    tag: 'BB',
    placement: 'overlay',
    params: [
      period(20),
      /* Two deviations is Bollinger's own default and covers ~95% of closes;
         the range stops short of values that would put the bands off-screen. */
      { key: 'multiplier', labelKey: 'ta.paramDeviations', min: 1, max: 4, default: 2 },
    ],
  },
  {
    id: 'vwap',
    labelKey: 'ta.vwap',
    tag: 'VWAP',
    placement: 'overlay',
    params: [period(20)],
    needsVolume: true,
  },
  {
    id: 'ichimoku',
    labelKey: 'ta.ichimoku',
    tag: 'Ichimoku',
    placement: 'overlay',
    /* The 9/26/52 are Hosoda's original constants, chosen for a six-day
       trading week. They are editable because people do change them, but the
       defaults are the ones every other chart draws. */
    params: [
      { key: 'conversion', labelKey: 'ta.paramConversion', min: 2, max: 60, default: 9 },
      { key: 'base', labelKey: 'ta.paramBase', min: 2, max: 120, default: 26 },
      { key: 'spanB', labelKey: 'ta.paramSpanB', min: 2, max: 240, default: 52 },
    ],
  },

  { id: 'rsi', labelKey: 'ta.rsi', tag: 'RSI', placement: 'pane', params: [period(14)] },
  {
    id: 'macd',
    labelKey: 'ta.macd',
    tag: 'MACD',
    placement: 'pane',
    params: [
      { key: 'fast', labelKey: 'ta.paramFast', min: 2, max: 100, default: 12 },
      { key: 'slow', labelKey: 'ta.paramSlow', min: 3, max: 200, default: 26 },
      { key: 'signal', labelKey: 'ta.paramSignal', min: 2, max: 100, default: 9 },
    ],
  },
  {
    id: 'stochastic',
    labelKey: 'ta.stochastic',
    tag: 'Stoch',
    placement: 'pane',
    params: [
      { key: 'k', labelKey: 'ta.paramK', min: 2, max: 100, default: 14 },
      { key: 'd', labelKey: 'ta.paramD', min: 1, max: 50, default: 3 },
    ],
  },
  { id: 'atr', labelKey: 'ta.atr', tag: 'ATR', placement: 'pane', params: [period(14)] },
  { id: 'adx', labelKey: 'ta.adx', tag: 'ADX', placement: 'pane', params: [period(14)] },
] as const;

export function indicatorSpec(id: IndicatorId): IndicatorSpec {
  return INDICATORS.find((spec) => spec.id === id) ?? INDICATORS[0];
}

/** `{ sma: { period: 20 }, macd: { fast: 12, … } }` — every default, flattened. */
export type IndicatorParams = Record<string, Record<string, number>>;

export function defaultParams(): IndicatorParams {
  const out: IndicatorParams = {};
  for (const spec of INDICATORS) {
    out[spec.id] = {};
    for (const param of spec.params) out[spec.id][param.key] = param.default;
  }
  return out;
}

/**
 * A parameter the user typed, made safe.
 *
 * Clamped rather than rejected: someone dragging a number field to 400 means
 * "as long as possible", and an indicator that silently refuses to redraw is
 * worse than one that quietly stops at 250. NaN and empty fall back to the
 * default, because a half-typed field should not blank the chart.
 */
export function clampParam(spec: IndicatorSpec, key: string, value: number): number {
  const param = spec.params.find((entry) => entry.key === key);
  if (!param) return value;
  if (!Number.isFinite(value)) return param.default;
  return Math.min(param.max, Math.max(param.min, Math.round(value)));
}

/**
 * MACD's slow EMA must be slower than its fast one, or the line is the
 * negative of itself and the histogram reads backwards. Enforced here rather
 * than in the maths, which should compute what it is asked for.
 */
export function coherentParams(id: IndicatorId, params: Record<string, number>): Record<string, number> {
  if (id !== 'macd') return params;
  const fast = params.fast ?? 12;
  const slow = params.slow ?? 26;
  return slow <= fast ? { ...params, slow: fast + 1 } : params;
}

/** How many bars an indicator needs before it can draw anything at all. */
export function warmupBars(id: IndicatorId, params: Record<string, number>): number {
  switch (id) {
    case 'macd':
      return (params.slow ?? 26) + (params.signal ?? 9);
    case 'ichimoku':
      return params.spanB ?? 52;
    case 'adx':
      /* Two Wilder passes: one for DX, one for the average of it. */
      return (params.period ?? 14) * 2 + 1;
    case 'stochastic':
      return (params.k ?? 14) + (params.d ?? 3);
    default:
      return (params.period ?? 14) + 1;
  }
}
