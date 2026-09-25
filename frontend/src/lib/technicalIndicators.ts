/**
 * The indicator maths, as pure functions over an array of bars.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HAND-WRITTEN AND NOT A LIBRARY
 * ---------------------------------------------------------------------------
 * Every indicator here is a handful of loops. The npm options weigh 40–200kB,
 * arrive with their own array conventions, and disagree about the two things
 * that actually matter — how the first value is seeded and which smoothing is
 * used — so wiring one up correctly means reading its source anyway. These are
 * written against the standard definitions, with the seeding stated in each
 * doc comment, and tested against known values.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF EVERY RESULT
 * ---------------------------------------------------------------------------
 * Indicators are undefined for their first `period - 1` bars, and this module
 * never invents a value to fill that gap: the output arrays are *shorter* than
 * the input and carry the `time` of the bar each value belongs to. That is
 * also exactly what lightweight-charts wants, so nothing has to be realigned
 * before it is drawn. A chart that pretended a 200-day average existed on day
 * three would be drawing a line nobody could act on.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE
 * ---------------------------------------------------------------------------
 * Single pass wherever the definition allows: rolling sums for the averages,
 * Wilder's recurrence for RSI/ATR/ADX, and a monotonic deque for the rolling
 * max/min that Stochastic, Ichimoku and Donchian-style windows need — that one
 * turns an O(n·period) scan into O(n) with a lookback of any size.
 *
 * The one deliberate exception is Bollinger's standard deviation, which is
 * computed per window. See the note there: it is the numerically safe choice.
 */

/** One bar. `volume` is optional — not every provider sends it. */
export interface Bar {
  /** `YYYY-MM-DD`, passed straight through to the chart. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** A single plotted value at a point in time. */
export interface LinePoint {
  time: string;
  value: number;
}

export interface BandPoint {
  time: string;
  upper: number;
  middle: number;
  lower: number;
}

export interface MacdPoint {
  time: string;
  macd: number;
  signal: number;
  histogram: number;
}

export interface StochasticPoint {
  time: string;
  k: number;
  d: number;
}

export interface AdxPoint {
  time: string;
  adx: number;
  plusDi: number;
  minusDi: number;
}

export interface IchimokuPoint {
  time: string;
  conversion: number | null;
  base: number | null;
  spanA: number | null;
  spanB: number | null;
  lagging: number | null;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const closes = (bars: Bar[]): number[] => bars.map((bar) => bar.close);

/**
 * Rolling max and min over `period`, in one pass.
 *
 * A monotonic deque: indices are kept in decreasing (or increasing) order of
 * value, so the front is always the extreme of the current window. Each index
 * is pushed and popped at most once, which is what makes a 52-period Ichimoku
 * span cost the same per bar as a 9-period one.
 *
 * Returns an array aligned to `values`, with `null` until the window fills.
 */
function rollingExtreme(values: number[], period: number, want: 'max' | 'min'): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;

  /* Holds indices, not values, so stale ones can be dropped off the front as
     the window slides past them. */
  const deque: number[] = [];
  const beats = (a: number, b: number) => (want === 'max' ? a >= b : a <= b);

  for (let i = 0; i < values.length; i += 1) {
    while (deque.length && deque[0] <= i - period) deque.shift();
    while (deque.length && beats(values[i], values[deque[deque.length - 1]])) deque.pop();
    deque.push(i);
    if (i >= period - 1) out[i] = values[deque[0]];
  }

  return out;
}

/**
 * Wilder's smoothing: `next = (previous * (n - 1) + value) / n`.
 *
 * The recurrence behind RSI, ATR and ADX, and the usual source of disagreement
 * between implementations — it is *not* an EMA of period n (it behaves like one
 * of period 2n-1). Seeded with the simple average of the first `period`
 * values, which is what Wilder specified and what every charting package does.
 */
function wilderSmooth(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;

  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let previous = sum / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (previous * (period - 1) + values[i]) / period;
    out[i] = previous;
  }

  return out;
}

/** Simple moving average of a raw number series, aligned, nulls until full. */
function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

/**
 * Exponential moving average of a raw number series.
 *
 * Seeded with the SMA of the first `period` values rather than with the first
 * value alone. Both are in the wild; the SMA seed is what TradingView and
 * Stockcharts use, so a line drawn here matches the one a user is comparing it
 * against.
 */
function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let previous = sum / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }

  return out;
}

/** Drops the leading nulls and pairs each value with its bar's time. */
function attach(bars: Bar[], values: (number | null)[]): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== null && Number.isFinite(value)) out.push({ time: bars[i].time, value });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Overlays                                                           */
/* ------------------------------------------------------------------ */

/** Simple moving average of the close. */
export function calculateSMA(bars: Bar[], period = 20): LinePoint[] {
  return attach(bars, smaSeries(closes(bars), period));
}

/** Exponential moving average of the close. SMA-seeded — see `emaSeries`. */
export function calculateEMA(bars: Bar[], period = 20): LinePoint[] {
  return attach(bars, emaSeries(closes(bars), period));
}

/**
 * Bollinger Bands: an SMA with a band `multiplier` standard deviations either
 * side.
 *
 * The deviation is the *population* one (divide by n, not n-1), which is what
 * Bollinger defined and what charting software draws.
 *
 * Computed per window rather than from a rolling sum of squares. That is
 * O(n·period) instead of O(n), and it is the right trade: the rolling form
 * subtracts two large, nearly equal numbers, and on a series like a share price
 * — where values are large and their variance is small — the cancellation can
 * produce a tiny *negative* variance whose square root is NaN. A silent NaN in
 * the middle of a band is far more expensive than twenty extra multiplications
 * per bar.
 */
export function calculateBollingerBands(bars: Bar[], period = 20, multiplier = 2): BandPoint[] {
  const values = closes(bars);
  const middle = smaSeries(values, period);
  const out: BandPoint[] = [];

  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null) continue;

    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const delta = values[j] - mean;
      sumSquares += delta * delta;
    }
    const deviation = Math.sqrt(sumSquares / period);

    out.push({
      time: bars[i].time,
      upper: mean + deviation * multiplier,
      middle: mean,
      lower: mean - deviation * multiplier,
    });
  }

  return out;
}

/**
 * Volume-weighted average price over a rolling window.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 * The VWAP a trader means resets every session and is computed from intraday
 * bars. This app fetches *daily* bars, so that figure is not available here and
 * no amount of arithmetic will conjure it. What this computes is the rolling
 * volume-weighted average of the typical price over `period` days — a real and
 * useful line, and a different one. The UI labels it "VWAP (20d)" for exactly
 * that reason: a chart that showed a rolling average under the name every desk
 * reserves for the session figure would be lying to the one audience that
 * knows the difference.
 *
 * Returns an empty array when the bars carry no volume, rather than falling
 * back to an unweighted average wearing a volume-weighted name.
 */
export function calculateVWAP(bars: Bar[], period = 20): LinePoint[] {
  const usable = bars.some((bar) => Number.isFinite(bar.volume) && (bar.volume ?? 0) > 0);
  if (!usable || period <= 0) return [];

  const out: LinePoint[] = [];
  let volumeSum = 0;
  let priceVolumeSum = 0;
  const pv: number[] = [];
  const vol: number[] = [];

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const volume = Number.isFinite(bar.volume) ? (bar.volume as number) : 0;
    const typical = (bar.high + bar.low + bar.close) / 3;

    pv.push(typical * volume);
    vol.push(volume);
    priceVolumeSum += typical * volume;
    volumeSum += volume;

    if (i >= period) {
      priceVolumeSum -= pv[i - period];
      volumeSum -= vol[i - period];
    }

    /* A window of entirely zero volume — a holiday stretch, or a provider
       gap — has no weighted average to give. Skipped rather than divided. */
    if (i >= period - 1 && volumeSum > 0) {
      out.push({ time: bar.time, value: priceVolumeSum / volumeSum });
    }
  }

  return out;
}

/**
 * Ichimoku Kinko Hyo.
 *
 *   conversion (Tenkan)  midpoint of the last 9 bars' high/low
 *   base       (Kijun)   midpoint of the last 26
 *   span A     (Senkou A) (conversion + base) / 2, plotted 26 bars *ahead*
 *   span B     (Senkou B) midpoint of the last 52, plotted 26 bars ahead
 *   lagging    (Chikou)  the close, plotted 26 bars *behind*
 *
 * The displacement is the whole point of the indicator and the thing naive
 * implementations drop: the cloud is a forecast, drawn in front of price, and
 * a span plotted at its own bar is not Ichimoku. Because the future bars do
 * not exist yet, this returns `displacement` extra rows whose `time` is
 * projected forward by the bar spacing — see `projectTimes`.
 */
export function calculateIchimoku(
  bars: Bar[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanBPeriod = 52,
  displacement = 26,
): IchimokuPoint[] {
  if (bars.length === 0) return [];

  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);

  const midpoint = (period: number): (number | null)[] => {
    const max = rollingExtreme(highs, period, 'max');
    const min = rollingExtreme(lows, period, 'min');
    return max.map((high, i) => {
      const low = min[i];
      return high !== null && low !== null ? (high + low) / 2 : null;
    });
  };

  const conversion = midpoint(conversionPeriod);
  const base = midpoint(basePeriod);
  const spanB = midpoint(spanBPeriod);

  const spanA = conversion.map((value, i) => {
    const b = base[i];
    return value !== null && b !== null ? (value + b) / 2 : null;
  });

  /* The cloud extends `displacement` bars past the last real one. */
  const times = [...bars.map((bar) => bar.time), ...projectTimes(bars, displacement)];
  const out: IchimokuPoint[] = [];

  for (let i = 0; i < times.length; i += 1) {
    const source = i - displacement; // the bar this forward-plotted span came from
    const laggingSource = i + displacement; // the bar whose close is plotted back here

    out.push({
      time: times[i],
      conversion: i < bars.length ? conversion[i] : null,
      base: i < bars.length ? base[i] : null,
      spanA: source >= 0 && source < bars.length ? spanA[source] : null,
      spanB: source >= 0 && source < bars.length ? spanB[source] : null,
      lagging: laggingSource < bars.length ? bars[laggingSource].close : null,
    });
  }

  return out;
}

/**
 * `count` business days after the last bar, as `YYYY-MM-DD`.
 *
 * Weekends are skipped because the chart's time scale is built from trading
 * days: projecting onto a Saturday would either be dropped by the library or
 * open a gap the price series never has. Holidays are not modelled — the cloud
 * being one session out at the far edge is a cosmetic error, and the
 * alternative is shipping an exchange calendar.
 */
function projectTimes(bars: Bar[], count: number): string[] {
  const last = bars[bars.length - 1]?.time;
  if (!last || count <= 0) return [];

  const [y, m, d] = last.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const out: string[] = [];

  while (out.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push(cursor.toISOString().slice(0, 10));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Oscillators                                                        */
/* ------------------------------------------------------------------ */

/**
 * Relative Strength Index, with Wilder's smoothing.
 *
 * A period of flat or rising prices gives an average loss of zero, where the
 * textbook `100 - 100 / (1 + RS)` divides by nothing. That case is 100 by
 * definition and is returned as such rather than as NaN or Infinity.
 */
export function calculateRSI(bars: Bar[], period = 14): LinePoint[] {
  if (bars.length <= period) return [];

  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < bars.length; i += 1) {
    const change = bars[i].close - bars[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  /* The first row is the padding above, not a real change, so both series are
     smoothed from index 1 onwards. */
  const avgGain = wilderSmooth(gains.slice(1), period);
  const avgLoss = wilderSmooth(losses.slice(1), period);

  const out: LinePoint[] = [];
  for (let i = 0; i < avgGain.length; i += 1) {
    const gain = avgGain[i];
    const loss = avgLoss[i];
    if (gain === null || loss === null) continue;

    const value = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    out.push({ time: bars[i + 1].time, value });
  }

  return out;
}

/**
 * MACD: the gap between two EMAs, its own EMA, and the difference.
 *
 * The signal line is an EMA *of the MACD line*, which only begins once the
 * slow EMA does — so the histogram starts `slow + signal - 2` bars in, not at
 * the first bar the fast EMA exists.
 */
export function calculateMACD(
  bars: Bar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const values = closes(bars);
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);

  /* The MACD line, densely packed from the first bar where both EMAs exist,
     because the signal EMA has to be seeded on consecutive values. */
  const macdValues: number[] = [];
  const macdIndex: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const f = fast[i];
    const s = slow[i];
    if (f === null || s === null) continue;
    macdValues.push(f - s);
    macdIndex.push(i);
  }

  const signal = emaSeries(macdValues, signalPeriod);
  const out: MacdPoint[] = [];

  for (let i = 0; i < macdValues.length; i += 1) {
    const signalValue = signal[i];
    if (signalValue === null) continue;
    out.push({
      time: bars[macdIndex[i]].time,
      macd: macdValues[i],
      signal: signalValue,
      histogram: macdValues[i] - signalValue,
    });
  }

  return out;
}

/**
 * Stochastic oscillator.
 *
 * `%K` is where the close sits inside the last `kPeriod` bars' range, smoothed
 * over `smooth` bars (the "slow" stochastic, which is what everyone means);
 * `%D` is the average of that over `dPeriod`.
 *
 * A window whose high equals its low — a halted or untraded stock — has no
 * range to place the close in. That is reported as 50, the midpoint, rather
 * than as a division by zero: the close is neither at the top nor the bottom
 * of a range that does not exist.
 */
export function calculateStochastic(
  bars: Bar[],
  kPeriod = 14,
  dPeriod = 3,
  smooth = 3,
): StochasticPoint[] {
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const highest = rollingExtreme(highs, kPeriod, 'max');
  const lowest = rollingExtreme(lows, kPeriod, 'min');

  const rawK: number[] = [];
  const rawIndex: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const high = highest[i];
    const low = lowest[i];
    if (high === null || low === null) continue;
    const range = high - low;
    rawK.push(range === 0 ? 50 : ((bars[i].close - low) / range) * 100);
    rawIndex.push(i);
  }

  const slowK = smaSeries(rawK, smooth);
  const packedK: number[] = [];
  const packedIndex: number[] = [];
  for (let i = 0; i < slowK.length; i += 1) {
    const value = slowK[i];
    if (value === null) continue;
    packedK.push(value);
    packedIndex.push(rawIndex[i]);
  }

  const d = smaSeries(packedK, dPeriod);
  const out: StochasticPoint[] = [];
  for (let i = 0; i < packedK.length; i += 1) {
    const dValue = d[i];
    if (dValue === null) continue;
    out.push({ time: bars[packedIndex[i]].time, k: packedK[i], d: dValue });
  }

  return out;
}

/** True range: the widest of today's span and the two gaps against yesterday. */
function trueRanges(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const previousClose = bars[i - 1].close;
    out.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - previousClose),
        Math.abs(bars[i].low - previousClose),
      ),
    );
  }
  return out;
}

/** Average True Range — volatility in the instrument's own units. */
export function calculateATR(bars: Bar[], period = 14): LinePoint[] {
  if (bars.length <= period) return [];
  const smoothed = wilderSmooth(trueRanges(bars), period);

  const out: LinePoint[] = [];
  for (let i = 0; i < smoothed.length; i += 1) {
    const value = smoothed[i];
    /* +1: true ranges start at the second bar. */
    if (value !== null) out.push({ time: bars[i + 1].time, value });
  }
  return out;
}

/**
 * Average Directional Index, with +DI and −DI.
 *
 * ADX measures how *strong* a trend is, never which way it points — that is
 * what the two directional indicators either side of it are for, which is why
 * all three are returned together and drawn on one pane.
 *
 * Directional movement counts only when one side of the bar clearly exceeds
 * the other; an inside bar contributes nothing to either direction, and a bar
 * that is both up and down contributes only to the larger. Both are easy to
 * get subtly wrong, so they are spelled out rather than compressed.
 */
export function calculateADX(bars: Bar[], period = 14): AdxPoint[] {
  if (bars.length <= period * 2) return [];

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const tr = wilderSmooth(trueRanges(bars), period);
  const plus = wilderSmooth(plusDm, period);
  const minus = wilderSmooth(minusDm, period);

  /* DX first, then ADX as the Wilder average of it — the second smoothing is
     what makes ADX lag its own components, and is not optional. */
  const dx: number[] = [];
  const dxIndex: number[] = [];
  const di: { plus: number; minus: number }[] = [];

  for (let i = 0; i < tr.length; i += 1) {
    const range = tr[i];
    const up = plus[i];
    const down = minus[i];
    if (range === null || up === null || down === null || range === 0) continue;

    const plusDi = (up / range) * 100;
    const minusDi = (down / range) * 100;
    const sum = plusDi + minusDi;

    dx.push(sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100);
    dxIndex.push(i);
    di.push({ plus: plusDi, minus: minusDi });
  }

  const adx = wilderSmooth(dx, period);
  const out: AdxPoint[] = [];

  for (let i = 0; i < adx.length; i += 1) {
    const value = adx[i];
    if (value === null) continue;
    out.push({
      time: bars[dxIndex[i] + 1].time,
      adx: value,
      plusDi: di[i].plus,
      minusDi: di[i].minus,
    });
  }

  return out;
}
