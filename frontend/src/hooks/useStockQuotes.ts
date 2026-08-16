import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clearQuoteCache, fetchQuotes, hasLiveQuotes, providerName } from '../services/stockApi';
import { useSettings } from '../state/SettingsContext';
import { Investment, Quote } from '../types';
import { useFxRate } from './useFxRate';

export interface PositionValuation extends Investment {
  quote: Quote | null;
  /** Price in the market's own currency, e.g. 210.00 USD. */
  nativePrice: number;
  nativeCurrency: string;
  nativeValue: number;
  /** Multiplier applied to reach the bookkeeping currency. 1 when they match. */
  fxRate: number;
  converted: boolean;
  /** Price in the bookkeeping currency, e.g. 210.00 × 33.1 = 6,951 THB. */
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  /** The headline number: unrealised P&L as a % of cost basis. */
  unrealizedPnlPercent: number;
}

export interface PortfolioValuation {
  positions: PositionValuation[];
  totalCost: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
}

/**
 * Fetches a quote per distinct symbol and derives unrealised P&L against the
 * cost basis stored in the workbook.
 */
export function useStockQuotes(investments: Investment[], refreshMs = 60_000) {
  const { settings } = useSettings();
  const baseCurrency = (settings.currency || 'USD').toUpperCase();

  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mounted = useRef(true);

  const open = useMemo(() => investments.filter((i) => i.status === 'hold'), [investments]);

  // A stable key so the effect only re-runs when the symbol set really changes.
  const symbolKey = useMemo(
    () => [...new Set(open.map((i) => i.symbol.toUpperCase()))].sort().join(','),
    [open],
  );

  // Average cost per symbol makes simulated quotes plausible.
  const referencePrices = useRef<Record<string, number>>({});
  referencePrices.current = useMemo(() => {
    const totals: Record<string, { cost: number; qty: number }> = {};
    for (const inv of open) {
      const key = inv.symbol.toUpperCase();
      const entry = totals[key] ?? { cost: 0, qty: 0 };
      entry.cost += inv.quantity * inv.buyPrice;
      entry.qty += inv.quantity;
      totals[key] = entry;
    }
    return Object.fromEntries(
      Object.entries(totals).map(([symbol, t]) => [symbol, t.qty > 0 ? t.cost / t.qty : 0]),
    );
  }, [open]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const symbols = symbolKey ? symbolKey.split(',') : [];
      if (!symbols.length) {
        setQuotes({});
        setErrors({});
        return;
      }

      setLoading(true);
      try {
        const result = await fetchQuotes(
          symbols.map((symbol) => ({ symbol, referencePrice: referencePrices.current[symbol] ?? 0 })),
          signal,
        );
        if (!mounted.current) return;
        setQuotes(result.quotes);
        setErrors(result.errors);
        setLastUpdated(Date.now());
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (mounted.current) setErrors({ _: (err as Error).message });
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [symbolKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !symbolKey) return undefined;
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(timer);
  }, [load, refreshMs, symbolKey]);

  /* Resolve an FX rate for every currency the portfolio is actually quoted in.
     Usually that's just USD; the set is derived from the quotes themselves so a
     non-US listing is handled without special-casing. */
  const quoteCurrencies = useMemo(() => {
    const currencies = Object.values(quotes).map((q) => q.currency);
    // Assume the provider's default before the first quote lands, so the rate
    // is already warm by the time prices arrive.
    return currencies.length ? currencies : ['USD'];
  }, [quotes]);

  const fx = useFxRate(quoteCurrencies, baseCurrency);
  const { rateFor } = fx;

  /** Bypasses the cache — wired to the "Refresh prices" button. */
  const refresh = useCallback(async () => {
    clearQuoteCache();
    await Promise.all([load(), fx.refresh()]);
  }, [load, fx]);

  const valuation = useMemo<PortfolioValuation>(() => {
    const positions = open.map((inv) => {
      const quote = quotes[inv.symbol.toUpperCase()] ?? null;
      // /api/dashboard returns raw rows, /api/investments returns decorated ones —
      // recompute when the server-side value isn't there.
      const costBasis = inv.costBasis || inv.quantity * inv.buyPrice + (inv.fees || 0);

      /* ---- Currency normalisation -------------------------------------
         `costBasis` is in the bookkeeping currency (what the user typed).
         `quote.price` is in the market's currency (USD for US listings).
         Everything below the conversion is in the bookkeeping currency, so
         the two are finally comparable.                                   */
      const quoteCurrency = (quote?.currency || baseCurrency).toUpperCase();
      const fxRate = rateFor(quoteCurrency);
      const converted = quoteCurrency !== baseCurrency.toUpperCase();

      const nativePrice = quote?.price ?? 0;
      const marketPrice = nativePrice * fxRate;
      const marketValue = quote ? marketPrice * inv.quantity : costBasis;
      // Uses cost basis rather than (price − buyPrice) × qty so that fees are
      // included, matching how the server reports realised P&L.
      const unrealizedPnl = quote ? marketValue - costBasis : 0;

      return {
        ...inv,
        costBasis,
        avgCost: inv.avgCost || (inv.quantity > 0 ? costBasis / inv.quantity : 0),
        tagList: inv.tagList ?? (inv.tags ? inv.tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
        quote,
        /** Price as the exchange quotes it, for display beside the ticker. */
        nativePrice,
        nativeCurrency: quoteCurrency,
        nativeValue: nativePrice * inv.quantity,
        fxRate,
        /** True when this row needed an FX conversion to be comparable. */
        converted,
        marketPrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPercent: costBasis > 0 && quote ? (unrealizedPnl / costBasis) * 100 : 0,
      };
    });

    const totalCost = positions.reduce((s, p) => s + p.costBasis, 0);
    const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalPnl = totalValue - totalCost;

    return {
      positions,
      totalCost,
      totalValue,
      totalPnl,
      totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    };
  }, [open, quotes, rateFor, baseCurrency]);

  return {
    ...valuation,
    quotes,
    errors,
    loading,
    lastUpdated,
    refresh,
    isLive: hasLiveQuotes(),
    provider: providerName(),
    /** Bookkeeping currency every converted figure above is expressed in. */
    baseCurrency,
    fx,
  };
}
