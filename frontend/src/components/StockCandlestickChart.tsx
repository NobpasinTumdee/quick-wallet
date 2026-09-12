/**
 * Daily candlesticks, rendered by TradingView's lightweight-charts.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLOURS ARE READ, NOT PASSED
 * ---------------------------------------------------------------------------
 * lightweight-charts paints to a <canvas>, and canvas has no idea what
 * `var(--positive)` means — CSS custom properties only resolve for CSS
 * properties on DOM nodes. So the theme cannot simply be handed to the library.
 *
 * Instead a throwaway probe element is given `color: var(--token)` and its
 * *computed* colour read back, which the browser has already resolved to a
 * concrete `rgb()`. That also survives tokens defined with `color-mix()`, which
 * a naive `getPropertyValue('--token')` would hand back unresolved.
 *
 * Because the value is a snapshot rather than a live binding, a MutationObserver
 * watches <html> for the theme swap (`data-theme`, plus the inline `--accent`
 * SettingsContext writes) and re-applies the palette. Switch from Nord to
 * Cyberpunk and the candles follow.
 */

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  createChart,
} from 'lightweight-charts';
import { CloudOff, Hourglass, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cx } from '../lib/format';
import { Candle } from '../services/candleApi';
import { Icon } from './Icon';
import { Button } from './ui';

/** Fixed heights so the skeleton never reshuffles between renders. */
const SKELETON_BARS = [38, 55, 44, 68, 52, 74, 61, 83, 70, 58, 76, 64, 88, 72, 60, 79, 66, 54, 71, 48];

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
}

const TOKENS: Record<keyof ChartPalette, string> = {
  text: '--text-muted',
  grid: '--border',
  border: '--border',
  up: '--positive',
  down: '--negative',
  crosshair: '--text-faint',
};

/**
 * Resolves each token to a concrete colour by letting the browser do it.
 * The probe is display:none but still in the tree, which is enough for
 * getComputedStyle to resolve inherited custom properties.
 */
function readPalette(host: HTMLElement): ChartPalette {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);

  const read = (token: string): string => {
    probe.style.color = '';
    probe.style.color = `var(${token})`;
    const resolved = getComputedStyle(probe).color;
    return resolved || '#888888';
  };

  try {
    return {
      text: read(TOKENS.text),
      grid: read(TOKENS.grid),
      border: read(TOKENS.border),
      up: read(TOKENS.up),
      down: read(TOKENS.down),
      crosshair: read(TOKENS.crosshair),
    };
  } finally {
    probe.remove();
  }
}

function applyPalette(chart: IChartApi, series: ISeriesApi<'Candlestick'>, palette: ChartPalette): void {
  chart.applyOptions({
    layout: {
      // Transparent, so the card's glass surface shows through rather than the
      // chart punching an opaque rectangle into it.
      background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
      textColor: palette.text,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    rightPriceScale: { borderColor: palette.border },
    timeScale: { borderColor: palette.border },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: palette.crosshair, labelBackgroundColor: palette.up },
      horzLine: { color: palette.crosshair, labelBackgroundColor: palette.up },
    },
  });

  series.applyOptions({
    upColor: palette.up,
    downColor: palette.down,
    wickUpColor: palette.up,
    wickDownColor: palette.down,
    borderUpColor: palette.up,
    borderDownColor: palette.down,
    borderVisible: false,
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/** The bar under the pointer, or the latest one when the pointer is away. */
export interface ChartReadout {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** close - open for that bar. */
  change: number;
}

export function StockCandlestickChart({
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
  /** Fires on crosshair move so the header can show O/H/L/C without a tooltip. */
  onReadout?: (readout: ChartReadout | null) => void;
  /** Nothing to draw yet — shows the skeleton over the (empty) canvas. */
  loading?: boolean;
  /** Refetching over bars already drawn — dim them, never re-skeleton. */
  refreshing?: boolean;
  error?: { kind: string; message: string; hint: string } | null;
  /** Seconds left on the rate-limit cooldown, for the live countdown. */
  cooldown?: number;
  onRetry?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [ready, setReady] = useState(false);

  // Kept in a ref so the crosshair subscription never needs re-binding.
  const readoutRef = useRef(onReadout);
  readoutRef.current = onReadout;

  /* ---- create once, destroy on unmount ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      autoSize: false, // the ResizeObserver below owns sizing
      handleScale: { axisPressedMouseMove: false },
      localization: {
        // Two decimals reads as money; the library's default drops trailing zeros.
        priceFormatter: (price: number) => price.toFixed(2),
      },
      timeScale: { fixLeftEdge: true, fixRightEdge: true, borderVisible: true },
      rightPriceScale: { borderVisible: true, scaleMargins: { top: 0.12, bottom: 0.12 } },
    });

    const series = chart.addSeries(CandlestickSeries, { borderVisible: false });

    chartRef.current = chart;
    seriesRef.current = series;
    setReady(true);

    const unsubscribe = chart.subscribeCrosshairMove((param) => {
      const report = readoutRef.current;
      if (!report) return;

      const point = param.seriesData.get(series) as
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
      // `remove()` tears down the canvas, its listeners and the internal
      // ResizeObserver. Without it every symbol switch leaks a chart.
      chart.unsubscribeCrosshairMove(unsubscribe as never);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setReady(false);
    };
    // `height` deliberately excluded: it is applied by the resize effect below
    // rather than rebuilding the whole chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- data ---- */
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !ready) return;

    series.setData(candles);
    chart.timeScale().fitContent();
    readoutRef.current?.(null);
  }, [candles, ready]);

  /* ---- responsive ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ready || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0) chartRef.current?.applyOptions({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready, height]);

  /* ---- theme ---- */
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!container || !chart || !series || !ready) return undefined;

    const sync = () => applyPalette(chart, series, readPalette(container));
    sync();

    // SettingsContext swaps `data-theme` and rewrites the inline `--accent`
    // on <html>; either means the resolved colours are now stale.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });
    return () => observer.disconnect();
  }, [ready]);

  const limited = error?.kind === 'rate-limit';

  return (
    <div className="candle-frame" style={{ height }}>
      {/* The canvas stays mounted under every overlay. Unmounting it would
          destroy and rebuild the chart on each state flip, which throws away
          the zoom position and costs a full re-render. */}
      <div
        ref={containerRef}
        className={cx('candle-canvas', (refreshing || error) && 'is-dimmed')}
        style={{ height }}
      />

      {loading && (
        <div className="candle-skeleton" aria-hidden="true">
          {/* Bars of varied height read as a price series rather than a
              loading bar, so the shape of what is coming is already legible. */}
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
                  ? `Rate limit reached. Retrying in ${cooldown}s…`
                  : 'Rate limit reached (8/min). Please wait a moment.'
                : error.message}
            </strong>

            <p className="candle-overlay-hint">{error.hint}</p>

            {onRetry && (
              <Button size="sm" onClick={onRetry} disabled={limited && cooldown > 0}>
                <Icon icon={RefreshCw} size="sm" />
                {limited && cooldown > 0 ? `Wait ${cooldown}s` : 'Try again'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
