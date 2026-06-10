import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { ExitSignalToast } from "@/components/ExitSignalToast";
import { RegimeIndicator } from "@/components/RegimeIndicator";
import { RiskStatus } from "@/components/RiskStatus";
import { AutoTraderPanel } from "@/components/AutoTraderPanel";
import { LlmActivityFeed } from "@/components/LlmActivityFeed";
import { Plus, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartOverlayPanel } from "@/components/ChartOverlayPanel";
import type { OverlayToggles } from "@/components/ChartOverlayPanel";
import { CandleIntensityPanel } from "@/components/CandleIntensityPanel";
import type { IntensityMode } from "@/lib/chart/candle-intensity";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { AlertConfigPanel } from "@/components/AlertConfigPanel";
import type { IndicatorConfig } from "@/components/IndicatorPanel";
import { MiniChart } from "@/components/MiniChart";
import type { KlineData } from "@/components/MiniChart";
import { OrderBook } from "@/components/OrderBook";
import { RecentTrades } from "@/components/RecentTrades";
import { TickerStrip } from "@/components/TickerStrip";
import { checkIndicatorAlerts, checkSMCAlerts, ALERT_DEFAULTS } from "@/lib/chart/alert-engine";
import type { AlertConfig, AlertEvent } from "@/lib/chart/alert-engine";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { getPriceDecimals } from "@/utils/precision";

const Dashboard = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("janus_selected_symbol") || "BTCUSDT";
    }
    return "BTCUSDT";
  });
  const [interval, setInterval] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("janus_selected_interval") || "1m";
    }
    return "1m";
  });
  const [side, setSide] = useState<"buy" | "sell">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("janus_selected_side");
      if (stored === "buy" || stored === "sell") return stored;
    }
    return "buy";
  });
  const [leverage, setLeverage] = useState(1);
  const [orderSize, setOrderSize] = useState("");
  const [strategyType, setStrategyType] = useState<"scalping" | "intraday" | "swing">("intraday");
  const [sidebarTab, setSidebarTab] = useState<"trade" | "auto" | "market">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("janus_dashboard_sidebar_tab");
      if (saved === "trade" || saved === "auto" || saved === "market") return saved;
    }
    return "trade";
  });

  useEffect(() => {
    localStorage.setItem("janus_dashboard_sidebar_tab", sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    localStorage.setItem("janus_selected_symbol", selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    localStorage.setItem("janus_selected_interval", interval);
  }, [interval]);

  useEffect(() => {
    localStorage.setItem("janus_selected_side", side);
  }, [side]);

  const [klines, setKlines] = useState<KlineData[]>([]);
  const [ticker, setTicker] = useState<any>(null);
  const [bestBid, setBestBid] = useState<number | null>(null);
  const [bestAsk, setBestAsk] = useState<number | null>(null);
  const [orderBook, setOrderBook] = useState<{ bids: [number, number][]; asks: [number, number][] } | null>(null);

  useEffect(() => {
    setBestBid(null);
    setBestAsk(null);
    setOrderBook(null);
  }, [selectedSymbol]);

  // Track which symbol+interval the current klines state belongs to
  const klineKeyRef = useRef(`${selectedSymbol}:${interval}`);

  const { data: initialKlines } = trpc.market.klines.useQuery(
    { symbol: selectedSymbol, interval, limit: 500 },
    {
      staleTime: 0,           // always fetch fresh when key changes
      refetchInterval: interval === "1m" ? false : 30_000,
      refetchOnWindowFocus: false,
    }
  );

  const { data: initialTicker } = trpc.market.ticker24h.useQuery(
    { symbol: selectedSymbol },
    { staleTime: Infinity }
  );

  // Reset alert tracking on symbol/interval change
  useEffect(() => {
    prevPaDataRef.current   = null;
    prevKlinesLenRef.current = 0;
  }, [selectedSymbol, interval]);

  // Step 1: Clear klines immediately when symbol or interval changes — prevents
  // stale data from the previous query key from briefly rendering on the chart.
  useEffect(() => {
    const newKey = `${selectedSymbol}:${interval}`;
    if (klineKeyRef.current !== newKey) {
      klineKeyRef.current = newKey;
      setKlines([]);
      setLiquidityEvents([]);
    }
  }, [selectedSymbol, interval]);

  // Step 2: Set klines only when fresh data matching the current key arrives.
  useEffect(() => {
    if (initialKlines && initialKlines.length > 0) {
      setKlines(initialKlines);
    }
  }, [initialKlines]);

  const utils = trpc.useUtils();

  // Lazy load older candles when user scrolls left past the start of loaded data
  const handleLoadMore = useCallback(async (beforeTime: number) => {
    try {
      const older = await utils.market.klines.fetch({
        symbol: selectedSymbol,
        interval,
        limit: 500,
        endTime: beforeTime - 1,  // fetch candles strictly before oldest loaded candle
      });
      if (older && older.length > 0) {
        setKlines((prev) => {
          // Deduplicate: skip candles already in state
          const existingTimes = new Set(prev.map((k) => k.openTime));
          const fresh = older.filter((k) => !existingTimes.has(k.openTime));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
      }
    } catch (err) {
      console.warn("[chart] lazy load failed:", err);
    }
  }, [selectedSymbol, interval, utils]);

  // ─── SMC / Price Action overlay ───
  const [indicatorCfg, setIndicatorCfg] = useState<IndicatorConfig | null>(null);
  const prevPaDataRef = useRef<any>(null);
  const prevKlinesLenRef = useRef(0);

  // ─── Chart alert engine — drives toasts from AlertConfigPanel toggles ───
  const [alertCfg, setAlertCfg] = useState<AlertConfig>(() => {
    try {
      const s = localStorage.getItem("janus_alert_cfg");
      return s ? { ...ALERT_DEFAULTS, ...JSON.parse(s) } : ALERT_DEFAULTS;
    } catch { return ALERT_DEFAULTS; }
  });
  const alertCfgRef = useRef(alertCfg);
  useEffect(() => { alertCfgRef.current = alertCfg; }, [alertCfg]);

  // Dedup recently-shown events (guards React re-renders / re-subscribes)
  const alertDedupRef = useRef<Set<string>>(new Set());
  const emitAlerts = useCallback((events: AlertEvent[]) => {
    for (const ev of events) {
      const key = `${ev.type}:${ev.direction}:${ev.timestamp}`;
      if (alertDedupRef.current.has(key)) continue;
      alertDedupRef.current.add(key);
      if (alertDedupRef.current.size > 300) {
        const oldest = alertDedupRef.current.values().next().value;
        if (oldest) alertDedupRef.current.delete(oldest);
      }
      const fn = ev.direction === "bullish" ? toast.success
        : ev.direction === "bearish" ? toast.error : toast.info;
      fn(`${ev.emoji} ${ev.symbol} · ${ev.message}`, { duration: 6000 });
    }
  }, []);

  // The backend analysis loop emits + Telegrams these transitions for ALL symbols
  // (EMA cross, SuperTrend flip, RSI, KNN flip/rejection/regime, BOS, CHoCH) and they
  // surface globally via systemAlertStream (Layout.tsx) — the bot's source of truth.
  // To avoid duplicate/divergent toasts, the chart only fires the indicators the
  // backend does NOT emit: BB Breakout, VWAP Cross, OB Touch, FVG Fill, Liq Sweep.
  const frontendOnly = useCallback((cfg: AlertConfig): AlertConfig => {
    const FRONTEND_KEYS = new Set<keyof AlertConfig>([
      "bbBreakout", "vwapCross", "obTouch", "fvgFill", "liqSweep",
    ]);
    const masked = { ...cfg };
    (Object.keys(masked) as (keyof AlertConfig)[]).forEach((k) => {
      if (!FRONTEND_KEYS.has(k)) masked[k] = false;
    });
    return masked;
  }, []);

  // Reset per-symbol alert tracking on symbol/interval switch
  const lastClosedOpenTimeRef = useRef<number | null>(null);
  useEffect(() => {
    lastClosedOpenTimeRef.current = null;
  }, [selectedSymbol, interval]);

  // Chart-local indicator alerts — fire once per CLOSED candle (not on live ticks)
  useEffect(() => {
    if (!indicatorCfg || klines.length < 4) return;
    const closedOpenTime = klines[klines.length - 2].openTime; // last closed candle
    if (lastClosedOpenTimeRef.current === null) {
      lastClosedOpenTimeRef.current = closedOpenTime; // prime — no burst on load
      return;
    }
    if (closedOpenTime <= lastClosedOpenTimeRef.current) return; // no new close yet
    lastClosedOpenTimeRef.current = closedOpenTime;
    // slice off the forming candle so detectors evaluate the just-closed one
    emitAlerts(checkIndicatorAlerts(klines.slice(0, -1), frontendOnly(alertCfgRef.current), indicatorCfg, selectedSymbol));
  }, [klines, indicatorCfg, selectedSymbol, emitAlerts, frontendOnly]);

  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(() => {
    try {
      const saved = localStorage.getItem("janus_chart_overlays");
      return saved ? JSON.parse(saved) : { swings: true, orderBlocks: true, fvg: true, structure: true, liquidity: true, displacement: false, premiumDiscount: false, obv: false, sweepMarkers: true };
    } catch { return { swings: true, orderBlocks: true, fvg: true, structure: true, liquidity: true, displacement: false, premiumDiscount: false, obv: false, sweepMarkers: true }; }
  });

  const [intensityMode, setIntensityMode] = useState<IntensityMode>("off");

  const [liquidityEvents, setLiquidityEvents] = useState<any[]>([]);
  const handleLiquidityEvent = useCallback((event: any) => {
    setLiquidityEvents((prev) => [event, ...prev].slice(0, 50));
  }, []);

  const { data: paData } = trpc.market.priceAction.useQuery(
    { symbol: selectedSymbol, interval, limit: 200 },
    { staleTime: 30_000, refetchInterval: 60_000, enabled: klines.length > 0 }
  );

  useEffect(() => {
    if (initialTicker && !Array.isArray(initialTicker)) {
      setTicker(initialTicker);
    }
  }, [initialTicker, selectedSymbol]);

  const klineCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    klineCallbackRef.current = (data: any) => {
      if (interval !== "1m") return;
      const kline = data as KlineData;
      setKlines((prev) => {
        if (prev.length === 0) return [kline];
        const last = prev[prev.length - 1];
        if (last.openTime === kline.openTime) {
          return [...prev.slice(0, -1), kline];
        } else if (kline.openTime > last.openTime) {
          return [...prev, kline].slice(-2000);
        }
        return prev;
      });
    };
  }, [interval]);

  const symbolInput = useMemo(() => ({ symbol: selectedSymbol }), [selectedSymbol]);

  const klineStreamOpts = useRef({
    onData: (data: any) => klineCallbackRef.current(data),
  });

  trpc.market.klineStream.useSubscription(
    symbolInput,
    klineStreamOpts.current
  );

  const formingCandleRef = useRef<{ openTime: number; high: number; low: number; close: number } | null>(null);

  const tickerCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    tickerCallbackRef.current = (data: any) => {
      setTicker((prev: any) => (prev ? { ...prev, ...data } : data));

      // Auto-rollover candle based on real-time ticks for all timeframes
      const price = parseFloat(data.lastPrice);
      if (!isNaN(price) && price > 0) {
        setKlines((prev) => {
          if (prev.length === 0) return prev;

          const match = interval.match(/^(\d+)([smhd])$/);
          let intervalMs = 60000;
          if (match) {
            const val = parseInt(match[1], 10);
            const unit = match[2];
            if (unit === 'm') intervalMs = val * 60000;
            else if (unit === 'h') intervalMs = val * 3600000;
            else if (unit === 'd') intervalMs = val * 86400000;
            else if (unit === 's') intervalMs = val * 1000;
          }

          const currentTime = data.eventTime || Date.now();
          const currentPeriodStart = Math.floor(currentTime / intervalMs) * intervalMs;

          const last = prev[prev.length - 1];

          // Accumulate highest high and lowest low of the currently forming candle
          if (!formingCandleRef.current || formingCandleRef.current.openTime !== last.openTime) {
            formingCandleRef.current = {
              openTime: last.openTime,
              high: Math.max(parseFloat(last.high), price),
              low: Math.min(parseFloat(last.low), price),
              close: price,
            };
          } else {
            formingCandleRef.current.high = Math.max(formingCandleRef.current.high, price);
            formingCandleRef.current.low = Math.min(formingCandleRef.current.low, price);
            formingCandleRef.current.close = price;
          }

          // If we crossed into a new timeframe period, finalize the old candle and manually inject a new one
          if (currentPeriodStart > last.openTime) {
            const finalizedOldKline: KlineData = {
              ...last,
              high: String(formingCandleRef.current.high),
              low: String(formingCandleRef.current.low),
              close: String(formingCandleRef.current.close),
            };

            const newKline: KlineData = {
              openTime: currentPeriodStart,
              open: String(price),
              high: String(price),
              low: String(price),
              close: String(price),
              volume: "0",
            };

            formingCandleRef.current = {
              openTime: currentPeriodStart,
              high: price,
              low: price,
              close: price,
            };

            return [...prev.slice(0, -1), finalizedOldKline, newKline].slice(-2000);
          }
          return prev;
        });
      }
    };
  }, [interval]);

  const tickerStreamOpts = useRef({
    onData: (data: any) => tickerCallbackRef.current(data),
  });

  trpc.market.tickerStream.useSubscription(
    symbolInput,
    tickerStreamOpts.current
  );

  const depthCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    depthCallbackRef.current = (data: any) => {
      if (data.bids && data.bids.length > 0) {
        setBestBid(parseFloat(data.bids[0][0]));
      }
      if (data.asks && data.asks.length > 0) {
        setBestAsk(parseFloat(data.asks[0][0]));
      }

      if (interval === "1m") {
        setOrderBook({
          bids: data.bids ? data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])]) : [],
          asks: data.asks ? data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])]) : []
        });
      }
    };
  }, [interval]);

  const depthStreamOpts = useRef({
    onData: (data: any) => depthCallbackRef.current(data),
  });

  trpc.market.orderBookStream.useSubscription(
    symbolInput,
    depthStreamOpts.current
  );

  // ─── CVD tick-level data from backend ───
  const { data: cvdHistoryData } = trpc.market.cvdHistory.useQuery(
    symbolInput,
    { staleTime: 0, refetchOnWindowFocus: false }
  );

  const [cvdBars, setCvdBars] = useState<{ ts: number; delta: number; cumulative: number }[]>([]);

  useEffect(() => {
    setCvdBars([]); // reset on symbol change
  }, [selectedSymbol]);

  useEffect(() => {
    if (cvdHistoryData?.points && cvdHistoryData.points.length > 0) {
      setCvdBars(cvdHistoryData.points);
    }
  }, [cvdHistoryData]);

  const cvdOnDataRef = useRef<(tick: any) => void>(() => {});
  useEffect(() => {
    cvdOnDataRef.current = (tick) => {
      setCvdBars((prev) => [...prev, tick].slice(-5000));
    };
  }, []);

  const cvdStreamOpts = useRef({
    onData: (tick: any) => cvdOnDataRef.current(tick),
  });

  trpc.market.cvdStream.useSubscription(
    symbolInput,
    cvdStreamOpts.current
  );

  // Fetch portfolio for open positions
  const [portfolio, setPortfolio] = useState<any>(null);
  const { data: initialPortfolio } = trpc.trading.portfolio.useQuery(
    undefined,
    { refetchInterval: 8000 }
  );
  useEffect(() => {
    if (initialPortfolio) {
      setPortfolio(initialPortfolio);
    }
  }, [initialPortfolio]);

  const portfolioCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    portfolioCallbackRef.current = (data: any) => {
      setPortfolio(data);
    };
  }, []);

  const portfolioStreamOpts = useRef({
    onData: (data: any) => portfolioCallbackRef.current(data),
  });

  trpc.trading.portfolioStream.useSubscription(
    undefined,
    portfolioStreamOpts.current
  );

  const openPositions = portfolio?.positions || [];
  // Show ALL open positions for this symbol — both paper and live
  const symbolPositions = openPositions.filter(
    (p: any) => p.symbol === selectedSymbol
  );

  const { data: openOrders } = trpc.trading.openOrders.useQuery(
    { symbol: selectedSymbol },
    { refetchInterval: 10_000, staleTime: 5_000 }
  );
  const { data: paperOrders } = trpc.trading.paperOrders.useQuery(
    { symbol: selectedSymbol },
    { refetchInterval: 10_000, staleTime: 5_000 }
  );
  const symbolOrders = [
    ...(openOrders ?? []).map((o: any) => ({ ...o, isPaper: false })),
    ...(paperOrders ?? []).map((o: any) => ({ ...o, isPaper: true })),
  ].filter(
    (o: any) => o.symbol === selectedSymbol && o.price > 0
  );

  const { data: instrInfo } = trpc.trading.instrumentInfo.useQuery(
    { symbol: selectedSymbol },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );

  const { data: conversion } = trpc.trading.currencyConversion.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const usdtInrRate = conversion?.conversion_price ?? 89.0;

  // Sync leverage to current position leverage when instrument changes
  useEffect(() => {
    if (instrInfo?.currentLeverage) setLeverage(instrInfo.currentLeverage);
  }, [instrInfo?.currentLeverage]);

  const createPosition = trpc.trading.createPosition.useMutation();

  const { data: breakevenMap } = trpc.trading.feeBreakevenMap.useQuery(
    { takerFeeRate: 0.0005 },
    { refetchInterval: 10_000 }
  );

  const tickerData = ticker && !Array.isArray(ticker) && !("error" in ticker) ? ticker : null;
  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const priceChange = tickerData ? parseFloat(tickerData.priceChangePercent) : 0;

  // Track previous PA data ref for chart overlay diffing + fire SMC alerts on change
  useEffect(() => {
    if (paData) {
      const prev = prevPaDataRef.current;
      if (prev) {
        const cp = klines.length > 0 ? parseFloat(klines[klines.length - 1].close) : lastPrice;
        // OB Touch / FVG Fill / Liq Sweep only — BOS/CHoCH come from backend systemAlertStream
        emitAlerts(checkSMCAlerts(paData, prev, cp, selectedSymbol, frontendOnly(alertCfgRef.current)));
      }
    }
    prevPaDataRef.current = paData ?? prevPaDataRef.current;
  }, [paData]);

  const maxLeverage = instrInfo?.maxLeverage ?? 10;
  const availableBalance = instrInfo?.availableUsdtEquivalent ?? 0;
  const marginCurrency = instrInfo?.marginCurrency ?? "USDT";
  const minQty = instrInfo?.minQuantity ?? 0.001;
  const minNotional = instrInfo?.minNotional ?? 5.5;
  const qtyStep = instrInfo?.step ?? 0.001;
  const qtyPrecision = instrInfo?.targetPrecision ?? 4;

  const handlePlaceOrder = useCallback(() => {
    if (!orderSize || !lastPrice) return;
    const size = parseFloat(orderSize);
    if (isNaN(size) || size <= 0) return;

    createPosition.mutate(
      {
        symbol: selectedSymbol,
        side: side === "buy" ? "long" : "short",
        entryPrice: String(lastPrice),
        currentPrice: String(lastPrice),
        size: String(size),
        leverage,
        margin: String((lastPrice * size) / leverage),
        strategyType,
      },
      {
        onSuccess: (data) => {
          utils.trading.positions.invalidate();
          utils.trading.portfolio.invalidate();
          setOrderSize("");
          if ((data as any)?.exchangeOrderId) {
            toast.success(`Order placed — ${side === "buy" ? "LONG" : "SHORT"} ${selectedSymbol}`, {
              description: `Size: ${size} · Leverage: ${leverage}x · ID: ${(data as any).exchangeOrderId.slice(0, 8)}…`,
            });
          } else {
            toast.warning(`Simulated — order not sent to exchange`, {
              description: `PLACE_ORDERS=false. Position recorded locally for ${side === "buy" ? "LONG" : "SHORT"} ${selectedSymbol}.`,
            });
          }
        },
        onError: (err) => {
          toast.error(`Order failed`, { description: err.message });
        },
      }
    );
  }, [orderSize, lastPrice, side, leverage, selectedSymbol, strategyType, createPosition, utils]);

  const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];

  return (
    <div className="flex flex-col h-full">
      <ExitSignalToast userId={1} />
      <TickerStrip activeSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Chart + Order Book */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chart Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#27272a]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{selectedSymbol}</span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    priceChange >= 0 ? "text-j-up" : "text-j-down"
                  )}
                >
                  <AnimatedNumber value={lastPrice} decimals={getPriceDecimals(selectedSymbol)} duration={150} />
                </span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    priceChange >= 0 ? "text-j-up" : "text-j-down"
                  )}
                >
                  {priceChange >= 0 ? "+" : ""}
                  {priceChange.toFixed(2)}%
                </span>
              </div>
              <div className="h-4 w-px bg-[#27272a]" />
              <div className="flex items-center gap-1">
                {intervals.map((int) => (
                  <button
                    key={int}
                    onClick={() => setInterval(int)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] transition-colors",
                      interval === int
                        ? "bg-j-up/10 text-j-up"
                        : "text-[#71717a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {int}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RegimeIndicator symbol={selectedSymbol} />
              <ChartOverlayPanel onChange={setOverlayToggles} />
              <CandleIntensityPanel onChange={setIntensityMode} />
              <IndicatorPanel onChange={setIndicatorCfg} />
              <AlertConfigPanel onChange={setAlertCfg} />
              <div className="h-3 w-px bg-[#27272a]" />
              <span className="text-[10px] text-[#71717a]">
                H: {tickerData ? parseFloat(tickerData.highPrice).toFixed(2) : "--"}
              </span>
              <span className="text-[10px] text-[#71717a]">
                L: {tickerData ? parseFloat(tickerData.lowPrice).toFixed(2) : "--"}
              </span>
              <span className="text-[10px] text-[#71717a]">
                V: {tickerData ? (parseFloat(tickerData.volume) / 1e6).toFixed(2) : "--"}M
              </span>
            </div>
          </div>

          {/* Chart Area */}
          <div className="flex-1 bg-[#09090b] border-b border-[#27272a] overflow-hidden">
            {klines && klines.length > 0 ? (
              <MiniChart
                data={klines as KlineData[]}
                positions={symbolPositions}
                openOrders={symbolOrders}
                lastPrice={lastPrice}
                symbol={selectedSymbol}
                interval={interval}
                onLoadMore={handleLoadMore}
                overlayData={paData ?? null}
                overlayToggles={overlayToggles}
                indicatorCfg={indicatorCfg}
                bidPrice={bestBid ?? undefined}
                askPrice={bestAsk ?? undefined}
                cvdBars={cvdBars}
                liquidityEvents={liquidityEvents}
                orderBook={orderBook ?? undefined}
                intensityMode={intensityMode}
              />
            ) : initialKlines === null || initialKlines === undefined ? (
              <div className="flex items-center justify-center h-full text-[#71717a] text-sm">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading {interval} candles…
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[#71717a] text-sm">
                <RefreshCw size={16} className="opacity-40" />
                <span>No {interval} data — WS accumulating 1m candles</span>
                <span className="text-[10px] text-[#3f3f46]">Switch to 1m for live data</span>
              </div>
            )}
          </div>

        </div>

        {/* Right Panel - Trading + Order Book + Trades */}
        <div className="w-80 flex-shrink-0 border-l border-[#27272a] bg-[#09090b] flex flex-col overflow-hidden">
          {/* Symbol Selector */}
          <div className="px-3 py-2 border-b border-[#27272a]">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none focus:border-j-up"
            >
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="SOLUSDT">SOLUSDT</option>
              <option value="BNBUSDT">BNBUSDT</option>
              <option value="XRPUSDT">XRPUSDT</option>
              <option value="ADAUSDT">ADAUSDT</option>
              <option value="DOGEUSDT">DOGEUSDT</option>
              <option value="AVAXUSDT">AVAXUSDT</option>
            </select>
          </div>

          <RiskStatus userId={1} />

          {/* Sidebar Tabs */}
          <div className="flex border-b border-[#27272a] bg-[#09090b] text-[10px] font-semibold">
            {(["trade", "auto", "market"] as const).map((tab) => {
              const isActive = sidebarTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={cn(
                    "flex-1 py-2 text-center border-b-2 transition-all uppercase tracking-wider",
                    isActive
                      ? "text-j-up border-j-up bg-j-up/5"
                      : "text-[#71717a] border-transparent hover:text-[#f4f4f5] hover:bg-[#18181b]/50"
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Tab Contents */}
          <div className={cn("flex-1 overflow-y-auto scrollbar-thin flex flex-col", sidebarTab !== "trade" && "hidden")}>
            {/* Buy/Sell Tabs */}
            <div className="flex border-b border-[#27272a]">
              <button
                onClick={() => setSide("buy")}
                className={cn(
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  side === "buy"
                    ? "bg-j-up/10 text-j-up border-b-2 border-j-up"
                    : "text-[#71717a] hover:text-[#f4f4f5]"
                )}
              >
                <Plus size={12} className="inline mr-1" />
                Buy / Long
              </button>
              <button
                onClick={() => setSide("sell")}
                className={cn(
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  side === "sell"
                    ? "bg-j-down/10 text-j-down border-b-2 border-j-down"
                    : "text-[#71717a] hover:text-[#f4f4f5]"
                )}
              >
                <Minus size={12} className="inline mr-1" />
                Sell / Short
              </button>
            </div>

            {/* Available Balance */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#71717a]">Available ({marginCurrency})</span>
                <span className="text-[10px] text-[#f4f4f5] tabular-nums font-medium">
                  {marginCurrency === "INR"
                    ? `₹${(instrInfo?.availableInr ?? 0).toFixed(2)}`
                    : `$${availableBalance.toFixed(2)}`}
                </span>
              </div>
              {marginCurrency === "INR" && (
                <div className="text-[9px] text-[#52525b] text-right tabular-nums">
                  ≈ ${availableBalance.toFixed(2)} USDT
                </div>
              )}
            </div>

            {/* Strategy Type */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#71717a]">Strategy</span>
                <span className="text-[10px] text-[#52525b]">fee exit threshold</span>
              </div>
              <div className="flex gap-1">
                {(["scalping", "intraday", "swing"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStrategyType(s)}
                    className={cn(
                      "flex-1 py-1 rounded text-[9px] transition-colors capitalize",
                      strategyType === s
                        ? "bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/30"
                        : "bg-[#18181b] text-[#71717a] border border-[#27272a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Leverage */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#71717a]">
                  Leverage
                  <span className="text-[#52525b] ml-1">(max {maxLeverage}x)</span>
                </span>
                <span className="text-xs text-j-up font-medium">{leverage}x</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 5, 10].filter((l) => l <= maxLeverage).concat(
                  maxLeverage > 10 ? [Math.min(25, maxLeverage)] : []
                ).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLeverage(l)}
                    className={cn(
                      "flex-1 py-1 rounded text-[9px] transition-colors min-w-[28px]",
                      leverage === l
                        ? "bg-j-up/10 text-j-up border border-j-up/30"
                        : "bg-[#18181b] text-[#71717a] border border-[#27272a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {l}x
                  </button>
                ))}
              </div>
            </div>

            {/* Order Size */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#71717a]">
                  Size ({selectedSymbol.replace("USDT", "")})
                </span>
                <span className="text-[10px] text-[#71717a] tabular-nums">
                  min {minQty} · step {qtyStep}
                </span>
              </div>
              <input
                type="number"
                value={orderSize}
                onChange={(e) => setOrderSize(e.target.value)}
                placeholder={`0.${"0".repeat(qtyPrecision)}`}
                step={qtyStep}
                min={minQty}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-j-up tabular-nums"
              />
              {/* % of available balance */}
              <div className="flex gap-1 mt-1">
                {[25, 50, 75, 100].map((pct) => {
                  const notional = availableBalance * leverage * (pct / 100);
                  const qty = lastPrice > 0 ? notional / lastPrice : 0;
                  return (
                    <button
                      key={pct}
                      onClick={() => setOrderSize(qty > 0 ? qty.toFixed(qtyPrecision) : "")}
                      className="flex-1 py-0.5 rounded text-[9px] bg-[#18181b] text-[#71717a] border border-[#27272a] hover:text-[#f4f4f5] transition-colors"
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Order Summary */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              {(() => {
                const size = parseFloat(orderSize) || 0;
                const notional = size * lastPrice;
                const rawMargin = leverage > 0 ? notional / leverage : 0;
                const rawFee = notional * 0.0005;
                const margin = marginCurrency === "INR" ? rawMargin * usdtInrRate : rawMargin;
                const fee = marginCurrency === "INR" ? rawFee * usdtInrRate : rawFee;
                const belowMin = size > 0 && (size < minQty || notional < minNotional);
                return (
                  <>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#71717a]">Margin Required</span>
                      <span className="text-[#f4f4f5] tabular-nums">
                        {margin > 0 ? `${margin.toFixed(2)} ${marginCurrency}` : "--"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#71717a]">Est. Fee ×2 (entry+exit)</span>
                      <span className="text-[#71717a] tabular-nums">
                        {fee > 0 ? (fee * 2).toFixed(4) : "--"} {marginCurrency}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#71717a]">Est. Liquidation</span>
                      <span className="text-[#f59e0b] tabular-nums">
                        {lastPrice > 0 && leverage > 0 && size > 0
                          ? `$${(side === "buy" ? lastPrice * (1 - 1 / leverage) : lastPrice * (1 + 1 / leverage)).toFixed(2)}`
                          : "--"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#71717a]">Min move to profit</span>
                      <span className="text-[#a855f7] tabular-nums font-medium">
                        {strategyType === "scalping" ? "≥0.10%" : strategyType === "intraday" ? "≥0.10%" : "≥0.10%"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#71717a]">Notional</span>
                      <span className="text-[#f4f4f5] tabular-nums">
                        {notional > 0 ? `$${notional.toFixed(2)}` : "--"}
                      </span>
                    </div>
                    {belowMin && (
                      <div className="text-[9px] text-j-down mt-1">
                        Min qty {minQty} · min notional ${minNotional}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Place Order Button */}
            <div className="px-3 py-3 border-b border-[#27272a]">
              {(() => {
                const size = parseFloat(orderSize) || 0;
                const notional = size * lastPrice;
                const margin = leverage > 0 ? notional / leverage : 0;
                const invalid = !orderSize || size < minQty || notional < minNotional || margin > availableBalance;
                return (
                  <button
                    onClick={handlePlaceOrder}
                    disabled={invalid || createPosition.isPending}
                    className={cn(
                      "w-full py-2.5 rounded-lg text-xs font-semibold transition-all",
                      side === "buy"
                        ? "bg-j-up hover:bg-j-up text-white"
                        : "bg-j-down hover:bg-j-down text-white",
                      (invalid || createPosition.isPending) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {createPosition.isPending ? (
                      <RefreshCw size={14} className="inline animate-spin mr-1" />
                    ) : (
                      <>{side === "buy" ? <Plus size={14} className="inline mr-1" /> : <Minus size={14} className="inline mr-1" />}</>
                    )}
                    {side === "buy" ? "Buy / Long" : "Sell / Short"} {selectedSymbol}
                  </button>
                );
              })()}
            </div>

            {/* Fee Breakeven Map */}
            {breakevenMap && breakevenMap.length > 0 && (
              <div className="px-3 py-2 flex-1 min-h-[150px]">
                <div className="text-[9px] text-[#52525b] uppercase tracking-wide mb-1.5 flex justify-between">
                  <span>Min move to profit (0.10% = 2× fee)</span>
                  <span className="text-[#a855f7]">entry + exit</span>
                </div>
                <div className="space-y-0.5">
                  {breakevenMap.map((entry) => (
                    <div
                      key={entry.symbol}
                      className={cn(
                        "flex items-center justify-between py-0.5 px-1 rounded text-[9px]",
                        entry.symbol === selectedSymbol
                          ? "bg-[#a855f7]/10"
                          : "hover:bg-[#18181b]"
                      )}
                    >
                      <span className={cn(
                        "font-medium tabular-nums",
                        entry.symbol === selectedSymbol ? "text-[#a855f7]" : "text-[#71717a]"
                      )}>
                        {entry.symbol.replace("USDT", "")}
                      </span>
                      <span className="text-[#52525b] tabular-nums">
                        ${entry.currentPrice > 0
                          ? entry.currentPrice >= 1000
                            ? entry.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })
                            : entry.currentPrice >= 1
                              ? entry.currentPrice.toFixed(2)
                              : entry.currentPrice.toFixed(4)
                          : "—"}
                      </span>
                      <span className={cn(
                        "tabular-nums font-semibold",
                        entry.symbol === selectedSymbol ? "text-[#a855f7]" : "text-[#71717a]"
                      )}>
                        {entry.minMoveAbs > 0
                          ? entry.minMoveAbs >= 1
                            ? `≥$${entry.minMoveAbs.toFixed(2)}`
                            : `≥$${entry.minMoveAbs.toFixed(4)}`
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={cn("flex-1 flex flex-col overflow-hidden", sidebarTab !== "auto" && "hidden")}>
            {/* AutoTrader Panel */}
            <div className="px-3 py-2 border-b border-[#27272a]">
              <AutoTraderPanel userId={1} />
            </div>
            {/* LLM Activity Feed */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-[#09090b]">
              <LlmActivityFeed />
            </div>
          </div>

          <div className={cn("flex-1 flex flex-col overflow-hidden", sidebarTab !== "market" && "hidden")}>
            {/* Order Book */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <OrderBook symbol={selectedSymbol} tickerData={tickerData} liquidityEvents={liquidityEvents} onLiquidityEvent={handleLiquidityEvent} />
            </div>
            {/* Recent Trades */}
            <div className="shrink-0 h-36 border-t border-[#27272a] flex flex-col overflow-hidden bg-[#09090b]">
              <RecentTrades symbol={selectedSymbol} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
