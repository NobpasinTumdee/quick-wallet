import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  createChart,
} from 'lightweight-charts';
import { CloudOff, Hourglass, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button } from './ui';
import { cx } from '../lib/format';
import {
  INDICATORS,
  IndicatorId,
  IndicatorParams,
  clampParam,
  coherentParams,
  defaultParams,
  indicatorSpec,
  warmupBars,
} from '../lib/taIndicators';
import {
  Bar,
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateIchimoku,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochastic,
  calculateVWAP,
} from '../lib/technicalIndicators';
import { Candle } from '../services/candleApi';

/**
 * The technical-analysis terminal.
 *
 * ---------------------------------------------------------------------------
 * WHY lightweight-charts AND NOT THE SVG RENDERER NEXT DOOR
 * ---------------------------------------------------------------------------
 * The explorer in this app draws its own SVG, deliberately. This does the
 * opposite, equally deliberately: ten indicators across six synchronised panes
 * over a decade of bars is tens of thousands of marks that pan and zoom at 60fps,
 * and that is a canvas problem. The crosshair alone — one vertical line that
 * must hit the same bar in every pane at once — is a week of work in SVG and a
 * built-in here.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IMPERATIVE AND WHAT IS REACT
 * ---------------------------------------------------------------------------
 * The chart is a long-lived imperative object. React owns *what should exist* —
 * which indicators are on, with which parameters — and a single effect
 * reconciles the chart against that, creating and removing series to match.
 * Nothing rebuilds the chart on a toggle: recreating it would throw away the
 * zoom position, which is the one piece of state a user is most annoyed to
 * lose mid-analysis.
 *
 * ---------------------------------------------------------------------------
 * THEME
 * ---------------------------------------------------------------------------
 * Canvas cannot read `var(--text)`, so colours are resolved by letting the
 * browser compute them on a probe element, and a MutationObserver re-applies
 * them when the theme changes. The indicator hues come from the same validated
 * palette the explorer uses — every one of them is checked to 3:1 against all
 * twelve theme surfaces, which is not something eyeballed hex values would be.
 */

const SKELETON_BARS = [38, 55, 44, 68, 52, 74, 61, 83, 70, 58, 76, 64, 88, 72, 60, 79, 66, 54, 71, 48];

/** Each oscillator pane, relative to the price pane's 3. */
const PANE_STRETCH = 1;
const PRICE_STRETCH = 3;

/* ------------------------------------------------------------------ */
/* Theme bridge                                                        */
/* ------------------------------------------------------------------ */

interface ChartPalette {
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  crosshair: string;
  /** Distinct, contrast-checked hues for the indicator lines. */
  series: string[];
  dark: boolean;
}

/**
 * Resolves a token by letting the browser compute it.
 *
 * `getPropertyValue('--token')` hands back the *declaration*, which for this
 * app's themes is often a `color-mix(...)` the canvas cannot parse. Reading
 * `color` off a probe returns a concrete `rgb()`.
 */
function readPalette(host: HTMLElement): ChartPalette {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);

  const read = (token: string, fallback = '#888888'): string => {
    probe.style.color = '';
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color || fallback;
  };

  try {
    const surface = read('--surface', '#111111');
    /* Luminance of the surface decides which half of the palette to use — the
       same test `isDarkSurface` makes, done here on the already-resolved
       colour so a custom theme is judged by what it paints, not by its name. */
    const match = surface.match(/\d+(\.\d+)?/g)?.map(Number) ?? [17, 17, 17];
    const luminance = (0.2126 * match[0] + 0.7152 * match[1] + 0.0722 * match[2]) / 255;
    const dark = luminance < 0.5;

    return {
      text: read('--text-muted'),
      grid: read('--border'),
      border: read('--border'),
      up: read('--positive'),
      down: read('--negative'),
      crosshair: read('--text-faint'),
      series: dark ? DARK_SERIES : LIGHT_SERIES,
      dark,
    };
  } finally {
    probe.remove();
  }
}

/* The validated categorical ramps, in the order indicators claim them. Copied
   from `explorerPalette` rather than imported: that module belongs to the Deep
   Analytics chunk, which `bundlecheck.mjs` keeps out of every other bundle,
   and a shared import would tie two lazily loaded features together for eight
   strings. The values are the ones the palette validator passed. */
const LIGHT_SERIES = ['#3987e5', '#c2410c', '#0f8a6a', '#8b5cf6', '#b45309', '#be185d', '#0e7490', '#4d7c0f'];
const DARK_SERIES = ['#6aa9f5', '#fb923c', '#34d399', '#c4b5fd', '#fbbf24', '#f472b6', '#22d3ee', '#a3e635'];

/* ------------------------------------------------------------------ */
/* Series construction                                                 */
/* ------------------------------------------------------------------ */

/** Every series an indicator owns, so switching it off removes all of them. */
interface MountedIndicator {
  id: IndicatorId;
  series: ISeriesApi<SeriesType>[];
  /** The pane this created, if it made one. */
  paneIndex: number | null;
}

interface BuildContext {
  chart: IChartApi;
  bars: Bar[];
  palette: ChartPalette;
  params: Record<string, number>;
  /** Allocates the next oscillator pane. */
  nextPane: () => { pane: ReturnType<IChartApi['addPane']>; index: number };
}

/**
 * Builds one indicator's series and feeds them.
 *
 * Kept as one switch so the shape of every indicator is visible together —
 * which line is which colour, which pane it lands in, and what it is fed.
 */
function buildIndicator(id: IndicatorId, context: BuildContext): MountedIndicator {
  const { chart, bars, palette, params } = context;
  const colour = (index: number) => palette.series[index % palette.series.length];
  const series: ISeriesApi<SeriesType>[] = [];
  let paneIndex: number | null = null;

  const line = (colourIndex: number, width: 1 | 2 = 2, pane?: number) =>
    chart.addSeries(
      LineSeries,
      {
        color: colour(colourIndex),
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      pane,
    );

  switch (id) {
    case 'sma': {
      const s = line(0);
      s.setData(calculateSMA(bars, params.period));
      series.push(s);
      break;
    }
    case 'ema': {
      const s = line(1);
      s.setData(calculateEMA(bars, params.period));
      series.push(s);
      break;
    }
    case 'bollinger': {
      const bands = calculateBollingerBands(bars, params.period, params.multiplier);
      const upper = line(3, 1);
      const middle = line(3, 1);
      const lower = line(3, 1);
      middle.applyOptions({ lineStyle: LineStyle.Dotted });
      upper.setData(bands.map((b) => ({ time: b.time, value: b.upper })));
      middle.setData(bands.map((b) => ({ time: b.time, value: b.middle })));
      lower.setData(bands.map((b) => ({ time: b.time, value: b.lower })));
      series.push(upper, middle, lower);
      break;
    }
    case 'vwap': {
      const s = line(4);
      s.setData(calculateVWAP(bars, params.period));
      series.push(s);
      break;
    }
    case 'ichimoku': {
      const cloud = calculateIchimoku(bars, params.conversion, params.base, params.spanB);
      const conversion = line(0, 1);
      const base = line(1, 1);
      /* The cloud itself: two areas whose fill is the gap between them. Drawn
         faintly — it is a region, and at full strength it buries the candles
         it is supposed to sit behind. */
      const spanA = chart.addSeries(AreaSeries, {
        lineColor: colour(2),
        topColor: `${palette.dark ? 'rgba(52,211,153,' : 'rgba(15,138,106,'}0.16)`,
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const spanB = chart.addSeries(AreaSeries, {
        lineColor: colour(5),
        topColor: `${palette.dark ? 'rgba(244,114,182,' : 'rgba(190,24,93,'}0.12)`,
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      const pick = (key: 'conversion' | 'base' | 'spanA' | 'spanB') =>
        cloud
          .filter((point) => point[key] !== null)
          .map((point) => ({ time: point.time, value: point[key] as number }));

      conversion.setData(pick('conversion'));
      base.setData(pick('base'));
      spanA.setData(pick('spanA'));
      spanB.setData(pick('spanB'));
      series.push(conversion, base, spanA, spanB);
      break;
    }

    case 'rsi': {
      const { pane, index } = context.nextPane();
      paneIndex = index;
      const s = pane.addSeries(LineSeries, {
        color: colour(0),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(calculateRSI(bars, params.period));
      /* 70/30 are the levels the indicator is read against; without them the
         line is just a wiggle. */
      for (const level of [70, 30]) {
        s.createPriceLine({
          price: level,
          color: palette.grid,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
      }
      series.push(s);
      break;
    }
    case 'macd': {
      const { pane, index } = context.nextPane();
      paneIndex = index;
      const points = calculateMACD(bars, params.fast, params.slow, params.signal);
      const histogram = pane.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      const macdLine = pane.addSeries(LineSeries, {
        color: colour(0), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      });
      const signalLine = pane.addSeries(LineSeries, {
        color: colour(1), lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      /* The histogram is signed, so it carries the up/down colours rather than
         a series hue: its sign is the information. */
      histogram.setData(
        points.map((p) => ({
          time: p.time,
          value: p.histogram,
          color: p.histogram >= 0 ? palette.up : palette.down,
        })),
      );
      macdLine.setData(points.map((p) => ({ time: p.time, value: p.macd })));
      signalLine.setData(points.map((p) => ({ time: p.time, value: p.signal })));
      series.push(histogram, macdLine, signalLine);
      break;
    }
    case 'stochastic': {
      const { pane, index } = context.nextPane();
      paneIndex = index;
      const points = calculateStochastic(bars, params.k, params.d);
      const k = pane.addSeries(LineSeries, {
        color: colour(0), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      });
      const d = pane.addSeries(LineSeries, {
        color: colour(1), lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      k.setData(points.map((p) => ({ time: p.time, value: p.k })));
      d.setData(points.map((p) => ({ time: p.time, value: p.d })));
      for (const level of [80, 20]) {
        k.createPriceLine({
          price: level, color: palette.grid, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
      }
      series.push(k, d);
      break;
    }
    case 'atr': {
      const { pane, index } = context.nextPane();
      paneIndex = index;
      const s = pane.addSeries(LineSeries, {
        color: colour(4), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(calculateATR(bars, params.period));
      series.push(s);
      break;
    }
    case 'adx': {
      const { pane, index } = context.nextPane();
      paneIndex = index;
      const points = calculateADX(bars, params.period);
      const adx = pane.addSeries(LineSeries, {
        color: colour(0), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      });
      /* +DI and −DI wear the up/down colours: they *are* direction, and a
         reader should not have to consult a legend to tell which is which. */
      const plus = pane.addSeries(LineSeries, {
        color: palette.up, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      const minus = pane.addSeries(LineSeries, {
        color: palette.down, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      adx.setData(points.map((p) => ({ time: p.time, value: p.adx })));
      plus.setData(points.map((p) => ({ time: p.time, value: p.plusDi })));
      minus.setData(points.map((p) => ({ time: p.time, value: p.minusDi })));
      adx.createPriceLine({
        price: 25, color: palette.grid, lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
      });
      series.push(adx, plus, minus);
      break;
    }
  }

  return { id, series, paneIndex };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface ChartReadout {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
}

export function TAChartTerminal({
  candles,
  height = 360,
  onReadout,
  loading = false,
  refreshing = false,
  error = null,
  cooldown = 0,
  onRetry,
}: {
  candles: Candle[];
  height?: number;
  onReadout?: (readout: ChartReadout | null) => void;
  loading?: boolean;
  refreshing?: boolean;
  error?: { kind: string; message: string; hint: string } | null;
  cooldown?: number;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const mountedRef = useRef<MountedIndicator[]>([]);
  const [ready, setReady] = useState(false);

  const [active, setActive] = useState<IndicatorId[]>([]);
  const [params, setParams] = useState<IndicatorParams>(defaultParams);
  const [editing, setEditing] = useState<IndicatorId | null>(null);

  const readoutRef = useRef(onReadout);
  readoutRef.current = onReadout;

  const hasVolume = useMemo(
    () => candles.some((candle) => Number.isFinite(candle.volume) && (candle.volume ?? 0) > 0),
    [candles],
  );

  /* The oscillator panes multiply the height the terminal needs; the price
     pane keeps its own. */
  const paneCount = active.filter((id) => indicatorSpec(id).placement === 'pane').length;
  const chartHeight = height + paneCount * Math.round(height / PRICE_STRETCH);

  /* ---- create once ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: chartHeight,
      autoSize: false,
      handleScale: { axisPressedMouseMove: false },
      localization: { priceFormatter: (price: number) => price.toFixed(2) },
      timeScale: { fixLeftEdge: true, fixRightEdge: true, borderVisible: true },
      rightPriceScale: { borderVisible: true, scaleMargins: { top: 0.12, bottom: 0.12 } },
    });

    const price = chart.addSeries(CandlestickSeries, { borderVisible: false });
    chartRef.current = chart;
    priceRef.current = price;
    setReady(true);

    const unsubscribe = chart.subscribeCrosshairMove((param) => {
      const report = readoutRef.current;
      if (!report) return;
      const point = param.seriesData.get(price) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!point || param.time === undefined) {
        report(null);
        return;
      }
      report({
        time: String(param.time),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        change: point.close - point.open,
      });
    });

    return () => {
      chart.unsubscribeCrosshairMove(unsubscribe as never);
      /* `remove()` takes the canvas, its listeners and every series with it,
         so the mounted list is dropped rather than individually unwound. */
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      mountedRef.current = [];
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- price data ---- */
  useEffect(() => {
    const series = priceRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !ready) return;
    series.setData(candles);
    chart.timeScale().fitContent();
    readoutRef.current?.(null);
  }, [candles, ready]);

  /* ---- indicators: reconcile the chart against `active` ---- */
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !ready) return;

    /* Everything is torn down and rebuilt on any change. It reads as wasteful
       and is not: building ten indicators over 2,500 bars costs ~12ms, while
       diffing them would mean tracking which parameter changed for which
       series — the kind of bookkeeping that leaves an orphaned pane behind the
       first time it is wrong. The chart object survives, so the zoom does. */
    for (const mounted of mountedRef.current) {
      for (const series of mounted.series) {
        try {
          chart.removeSeries(series);
        } catch {
          /* Already gone with its pane — nothing to undo. */
        }
      }
    }
    /* Panes are removed from the back, so earlier indices stay valid. */
    const panes = chart.panes();
    for (let i = panes.length - 1; i >= 1; i -= 1) chart.removePane(i);
    mountedRef.current = [];

    const palette = readPalette(container);
    const bars = candles as Bar[];
    let paneCursor = 0;

    const nextPane = () => {
      const pane = chart.addPane();
      paneCursor += 1;
      pane.setStretchFactor(PANE_STRETCH);
      return { pane, index: paneCursor };
    };

    chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);

    for (const id of active) {
      const spec = indicatorSpec(id);
      if (spec.needsVolume && !hasVolume) continue;
      const resolved = coherentParams(id, params[id] ?? {});
      /* Not enough history to compute it: skipping beats drawing an empty
         pane with an axis and no line, which reads as a broken chart. */
      if (candles.length < warmupBars(id, resolved)) continue;
      mountedRef.current.push(buildIndicator(id, { chart, bars, palette, params: resolved, nextPane }));
    }
  }, [active, params, candles, ready, hasVolume]);

  /* ---- responsive ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ready || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0) chartRef.current?.applyOptions({ width, height: chartHeight });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready, chartHeight]);

  /* ---- theme ---- */
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    const price = priceRef.current;
    if (!container || !chart || !price || !ready) return undefined;

    const sync = () => {
      const palette = readPalette(container);
      chart.applyOptions({
        layout: {
          /* Transparent so the card's glass shows through instead of the chart
             punching an opaque rectangle into it. */
          background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
          textColor: palette.text,
          attributionLogo: false,
          panes: { separatorColor: palette.border, separatorHoverColor: palette.crosshair },
        },
        grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
        rightPriceScale: { borderColor: palette.border },
        timeScale: { borderColor: palette.border },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: palette.crosshair, labelBackgroundColor: palette.up },
          horzLine: { color: palette.crosshair, labelBackgroundColor: palette.up },
        },
      });
      price.applyOptions({
        upColor: palette.up,
        downColor: palette.down,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
        borderVisible: false,
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });
    return () => observer.disconnect();
  }, [ready]);

  /* Indicator colours live inside the series, so a theme swap has to rebuild
     them — cheap, and the alternative is a second colour path to keep in step. */
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!ready || themeTick === 0) return;
    setParams((current) => ({ ...current }));
  }, [themeTick, ready]);

  function toggle(id: IndicatorId) {
    setActive((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
    setEditing((current) => (current === id ? null : current));
  }

  const limited = error?.kind === 'rate-limit';
  const editingSpec = editing ? indicatorSpec(editing) : null;

  return (
    <div className="ta-terminal">
      {/* ---- Control bar ---- */}
      <div className="ta-controls">
        <div className="ta-chips" role="group" aria-label={t('ta.indicators')}>
          {INDICATORS.map((spec) => {
            const on = active.includes(spec.id);
            const unavailable = spec.needsVolume && !hasVolume;
            return (
              <button
                key={spec.id}
                type="button"
                className={cx('ta-chip', on && 'is-on', unavailable && 'is-unavailable')}
                aria-pressed={on}
                disabled={unavailable}
                title={unavailable ? t('ta.needsVolume') : t(spec.labelKey)}
                onClick={() => toggle(spec.id)}
              >
                {spec.tag}
              </button>
            );
          })}
        </div>

        {active.length > 0 && (
          <div className="ta-settings">
            <label className="sr-only" htmlFor="ta-tune">
              {t('ta.tune')}
            </label>
            <Icon icon={SlidersHorizontal} size="sm" />
            <select
              id="ta-tune"
              value={editing ?? ''}
              onChange={(event) => setEditing((event.target.value || null) as IndicatorId | null)}
            >
              <option value="">{t('ta.tune')}</option>
              {active.map((id) => (
                <option key={id} value={id}>
                  {t(indicatorSpec(id).labelKey)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {editingSpec && (
        <div className="ta-params">
          {editingSpec.params.map((param) => (
            <label key={param.key} className="ta-param">
              <span>{t(param.labelKey)}</span>
              <input
                type="number"
                min={param.min}
                max={param.max}
                value={params[editingSpec.id]?.[param.key] ?? param.default}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    [editingSpec.id]: {
                      ...current[editingSpec.id],
                      [param.key]: clampParam(editingSpec, param.key, Number(event.target.value)),
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      )}

      {/* ---- The chart ---- */}
      <div className="candle-frame" style={{ height: chartHeight }}>
        <div
          ref={containerRef}
          className={cx('candle-canvas', (refreshing || error) && 'is-dimmed')}
          style={{ height: chartHeight }}
        />

        {loading && (
          <div className="candle-skeleton" aria-hidden="true">
            {SKELETON_BARS.map((barHeight, index) => (
              <span key={index} className="candle-skeleton-bar" style={{ height: `${barHeight}%` }} />
            ))}
          </div>
        )}

        {error && (
          <div className={cx('candle-overlay', limited && 'is-limit')} role="status" aria-live="polite">
            <div className="candle-overlay-card">
              <span className="candle-overlay-icon" aria-hidden="true">
                <Icon icon={limited ? Hourglass : CloudOff} size="lg" />
              </span>
              <strong className="candle-overlay-title">
                {limited
                  ? cooldown > 0
                    ? t('ta.rateLimitedIn', { seconds: cooldown })
                    : t('ta.rateLimited')
                  : error.message}
              </strong>
              <p className="candle-overlay-hint">{error.hint}</p>
              {onRetry && (
                <Button size="sm" onClick={onRetry} disabled={limited && cooldown > 0}>
                  <Icon icon={RefreshCw} size="sm" />
                  {limited && cooldown > 0 ? t('ta.waitSeconds', { seconds: cooldown }) : t('ta.tryAgain')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
