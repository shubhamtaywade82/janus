import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
} from "lightweight-charts";
import type { UTCTimestamp, SeriesMarker, Time, ISeriesApi } from "lightweight-charts";
import { Plus } from "lucide-react";

import { OrderBlockPrimitive } from "@/lib/chart/primitives/OrderBlockPrimitive";
import { FVGPrimitive } from "@/lib/chart/primitives/FVGPrimitive";
import { StructurePrimitive } from "@/lib/chart/primitives/StructurePrimitive";
import { SessionShadingPrimitive } from "@/lib/chart/primitives/SessionShadingPrimitive";
import { CrosshairTooltipPrimitive } from "@/lib/chart/primitives/CrosshairTooltipPrimitive";
import { LiquiditySweepPrimitive, type SweepMarker } from "@/lib/chart/primitives/LiquiditySweepPrimitive";
import { VolumeProfilePrimitive } from "@/lib/chart/primitives/VolumeProfilePrimitive";
import { OrderBookDepthPrimitive } from "@/lib/chart/primitives/OrderBookDepthPrimitive";

import type { OverlayToggles } from "@/components/ChartOverlayPanel";
import type { IndicatorConfig } from "@/components/IndicatorPanel";
import { EMA_COLORS, SMA_COLORS } from "@/components/IndicatorPanel";
import {
  calcEMA,
  calcSMA,
  calcBB,
  calcSuperTrend,
  calcRSI,
  calcVWAP,
  calcCVD,
  calcNW,
  calcMACD,
  calcStochRSI,
  calcPSAR,
  calcIchimoku,
  calcADX,
  calcZScore,
  calcVolumeProfile,
  calcKeltner,
  calcDonchian,
  calcTTMSqueeze,
} from "@/lib/chart/indicators";
import {
  detectMACDSignals,
  detectADXSignals,
  detectDirectionFlips,
  detectStochCross,
  detectZScoreSignals,
  detectIchimokuSignals,
  detectDonchianBreakout,
  detectNWBandTag,
  detectVWAPSignals,
  detectRSIDivergence,
  detectCVDDivergence,
} from "@/lib/chart/indicator-signals";
import type { PriceActionData } from "@/lib/chart/pa-types";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { formatPrice, getPriceDecimals } from "@/utils/precision";

// ─── Types ───
export interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

const resolveCSSColor = (varName: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!value) return fallback;
  if (value.startsWith("hsl") || value.startsWith("#") || value.startsWith("rgb")) return value;
  const formatted = value.includes(",") ? value : value.split(/\s+/).join(", ");
  return `hsl(${formatted})`;
};

export const MiniChart = ({ data, positions, lastPrice, symbol, interval, onLoadMore, overlayData, overlayToggles, indicatorCfg, bidPrice, askPrice, cvdBars, liquidityEvents, orderBook }: {
  data: KlineData[]; positions: any[]; lastPrice: number; symbol: string; interval: string;
  onLoadMore?: (beforeTime: number) => void;
  overlayData?: PriceActionData | null;
  overlayToggles?: OverlayToggles;
  indicatorCfg?: IndicatorConfig | null;
  bidPrice?: number;
  askPrice?: number;
  cvdBars?: { ts: number; delta: number; cumulative: number }[];
  liquidityEvents?: Array<{ id: string; type: string; priority: string; symbol: string; timestamp: number; message: string; data?: any }>;
  orderBook?: { bids: [number, number][]; asks: [number, number][] };
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hudData, setHudData] = useState<any>(null);
  const [chartInitialized, setChartInitialized] = useState(false);
  const [lastPriceY, setLastPriceY] = useState<number | null>(null);
  const [countdownStr, setCountdownStr] = useState<string>("");
  const [positionsY, setPositionsY] = useState<Record<number, { entryY: number | null; liqY: number | null }>>({});
  const [isScrolledBack, setIsScrolledBack] = useState(false);
  const priceLinesRef = useRef<any[]>([]);

  const [alertRules, setAlertRules] = useState<any[]>([]);
  const customAlertLinesRef = useRef<any[]>([]);
  const bidAskLinesRef = useRef<{ bidLine: any; askLine: any }>({ bidLine: null, askLine: null });
  const [hoveredCrosshair, setHoveredCrosshair] = useState<{ price: number; y: number } | null>(null);

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = chartContainerRef.current;
    const series = candlestickSeriesRef.current;
    if (!container || !series) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if within bounds of the plot area + price axis (exclude time axis at bottom, which is usually 26px)
    if (x < 0 || x > rect.width || y < 0 || y > rect.height - 26) {
      setHoveredCrosshair(null);
      return;
    }

    const price = series.coordinateToPrice(y);
    if (price) {
      setHoveredCrosshair({
        price: parseFloat(price.toFixed(getPriceDecimals(symbol))),
        y,
      });
    } else {
      setHoveredCrosshair(null);
    }
  };

  const handleContainerMouseLeave = () => {
    setHoveredCrosshair(null);
  };

  const loadAlertRules = useCallback(() => {
    const stored = localStorage.getItem("janus_alert_rules");
    if (stored) {
      try {
        setAlertRules(JSON.parse(stored));
      } catch (err) {
        console.error(err);
      }
    } else {
      setAlertRules([]);
    }
  }, []);

  const handleDeleteRule = (id: string) => {
    const stored = localStorage.getItem("janus_alert_rules");
    if (stored) {
      try {
        const rules = JSON.parse(stored);
        const updated = rules.filter((r: any) => r.id !== id);
        localStorage.setItem("janus_alert_rules", JSON.stringify(updated));
        window.dispatchEvent(new Event("janus_alerts_changed"));
        toast.error("Price alert removed!");
      } catch (err) {
        console.error(err);
      }
    }
  };

  useEffect(() => {
    loadAlertRules();
    const handleAlertsChange = () => {
      loadAlertRules();
    };
    window.addEventListener("janus_alerts_changed", handleAlertsChange);
    return () => {
      window.removeEventListener("janus_alerts_changed", handleAlertsChange);
    };
  }, [loadAlertRules]);

  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const dataRef = useRef<KlineData[]>(data);
  const prevLastTimeRef = useRef<number | null>(null);
  const prevDataLenRef = useRef<number>(0);
  const prevSymbolRef = useRef<string>(symbol);
  const prevIntervalRef = useRef<string>(interval);
  const isLoadingMoreRef = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);
  // SMC primitives
  const obPrimRef      = useRef<OrderBlockPrimitive | null>(null);
  const fvgPrimRef     = useRef<FVGPrimitive | null>(null);
  const strPrimRef     = useRef<StructurePrimitive | null>(null);
  const sessionPrimRef = useRef<SessionShadingPrimitive | null>(null);
  const tooltipPrimRef = useRef<CrosshairTooltipPrimitive | null>(null);
  const sweepPrimRef = useRef<LiquiditySweepPrimitive | null>(null);
  const markersPluginRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  // OBV series
  const obvSeriesRef = useRef<any>(null);
  // Indicator line series — keyed by "ema-21", "sma-50", "bb-upper", "st", "rsi", "vwap" etc.
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());
  // RSI reference price lines (70/50/30)
  const rsiPriceLinesRef      = useRef<any[]>([]);
  // StochRSI reference price lines (80/20)
  const stochRsiPriceLinesRef = useRef<any[]>([]);
  // CVD histogram series ref (per-bar delta; line goes through indicatorSeriesRef)
  const cvdHistRef  = useRef<any>(null);
  // MACD histogram series ref
  const macdHistRef = useRef<any>(null);
  // Z-Score reference price lines (±2/0)
  const zScorePriceLinesRef = useRef<any[]>([]);
  // Volume Profile primitive
  const vpPrimRef = useRef<VolumeProfilePrimitive | null>(null);
  // Order Book Depth primitive
  const obDepthPrimRef = useRef<OrderBookDepthPrimitive | null>(null);
  // TTM Squeeze histogram series
  const ttmSqHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Dedicated indicator signal markers plugin (separate from SMC markers)
  const indicatorMarkersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  // ─── Price line overlay (smooth thin line tracking close price) ───
  const priceLineSeriesRef = useRef<any>(null);
  // ─── Volume MA line overlay ───
  const volumeMASeriesRef = useRef<any>(null);
  // Volume history buffer for computing running MA during animation
  const volumeHistoryRef = useRef<{ time: number; value: number }[]>([]);

  // ─── Tick animation: persistent lerp loop chasing target ───
  //
  // INVARIANTS (do not violate — each caused a hard-to-debug bug):
  //  1. animTarget.high/low must ONLY expand within a candle — never shrink.
  //     Shrinking makes the wick clamp in the anim loop jump backward → flicker.
  //     Use liveHighRef / liveLowRef to accumulate the running max/min.
  //  2. Do NOT clamp rendered high/low to the animated close (`c`).
  //     The old pattern `Math.min(finalHigh, Math.max(open, c))` made wick length
  //     depend on lerp position → different value every frame → flicker.
  //     Just pass t.high / t.low directly to series.update().
  //  3. Effect 3 (lastPrice) must merge kline high/low from `last` into liveHighRef/liveLowRef.
  //     If it ignores kline data, real wicks from klineStream get overwritten with lower values.
  //
  const animFrameRef = useRef<number | null>(null);
  const animTarget = useRef({ time: 0, open: 0, high: 0, low: 0, close: 0, vol: 0 });
  const animCurrent = useRef({ close: 0, vol: 0 });
  const animLoopRunning = useRef(false);
  const animSeeded = useRef(false); // track if we've seeded initial values
  // Running high/low for the current candle — only expand, never contract (prevents wick flicker)
  const liveHighRef = useRef(0);
  const liveLowRef = useRef(Infinity);
  const liveTimeRef = useRef(0); // openTime (seconds) of the candle being tracked
  const VOLUME_MA_PERIOD = 20; // 20-period volume MA

  const startAnimLoop = useCallback(() => {
    if (animLoopRunning.current) return;
    animLoopRunning.current = true;
    const LERP = 0.18; // per-frame factor (~60fps → snappy ~100ms settle)
    const VOL_LERP = 0.22; // slightly faster for volume
    let idleFrames = 0; // keep loop alive briefly after settling
    const MAX_IDLE = 10; // ~160ms of idle frames before stopping
    const loop = () => {
      if (!candlestickSeriesRef.current) { animLoopRunning.current = false; return; }
      const t = animTarget.current;
      const closeDiff = t.close - animCurrent.current.close;
      const volDiff = t.vol - animCurrent.current.vol;
      
      // Calculate tolerance dynamically as a percentage of close price (0.002%) to prevent micro-fluctuation vibration
      const closeTol = Math.max(0.00001, t.close * 0.00002);
      const closeSettled = Math.abs(closeDiff) < closeTol;
      const volSettled = Math.abs(volDiff) < 0.1 || (t.vol > 0 && Math.abs(volDiff) / t.vol < 0.005);

      if (closeSettled && volSettled) {
        // Snap to exact target
        animCurrent.current.close = t.close;
        animCurrent.current.vol = t.vol;

        // Keep the loop alive briefly so the next tick can skip startup latency
        idleFrames++;
        if (idleFrames >= MAX_IDLE) {
          animLoopRunning.current = false;
          return;
        }

        // Still do a final render
        candlestickSeriesRef.current.update({ time: t.time as UTCTimestamp, open: t.open, high: t.high, low: t.low, close: t.close });
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({ time: t.time as UTCTimestamp, value: t.vol, color: t.close >= t.open ? "rgba(14,203,129,0.15)" : "rgba(246,70,93,0.15)" });
        }
        if (priceLineSeriesRef.current) {
          priceLineSeriesRef.current.update({ time: t.time as UTCTimestamp, value: t.close });
        }
        if (volumeMASeriesRef.current) {
          const hist = volumeHistoryRef.current;
          if (hist.length > 0) {
            hist[hist.length - 1].value = t.vol;
            const slice = hist.slice(-VOLUME_MA_PERIOD);
            const ma = slice.reduce((s, v) => s + v.value, 0) / slice.length;
            volumeMASeriesRef.current.update({ time: t.time as UTCTimestamp, value: ma });
          }
        }
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      // We have movement — reset idle counter
      idleFrames = 0;

      // Lerp close price
      if (!closeSettled) animCurrent.current.close += closeDiff * LERP;
      // Lerp volume
      if (!volSettled) animCurrent.current.vol += volDiff * VOL_LERP;

      const c = animCurrent.current.close;
      const v = animCurrent.current.vol;

      // Use full high/low from animTarget directly — do NOT clamp to animated close.
      // Clamping made the wick length depend on the lerp position, causing wicks to
      // flicker every frame as `c` moved. Wicks are accurate; only close animates.
      candlestickSeriesRef.current.update({
        time: t.time as UTCTimestamp,
        open: t.open,
        high: t.high,
        low: t.low,
        close: c,
      });

      // Animated volume bar update
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.update({
          time: t.time as UTCTimestamp,
          value: v,
          color: c >= t.open ? "rgba(14,203,129,0.15)" : "rgba(246,70,93,0.15)",
        });
      }

      // Animated price line overlay update
      if (priceLineSeriesRef.current) {
        priceLineSeriesRef.current.update({ time: t.time as UTCTimestamp, value: c });
      }

      // Animated volume MA line update
      if (volumeMASeriesRef.current) {
        const hist = volumeHistoryRef.current;
        if (hist.length > 0) {
          hist[hist.length - 1].value = v;
          const slice = hist.slice(-VOLUME_MA_PERIOD);
          const ma = slice.reduce((s, val) => s + val.value, 0) / slice.length;
          volumeMASeriesRef.current.update({ time: t.time as UTCTimestamp, value: ma });
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  // Keep refs updated
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);

  useEffect(() => {
    if (obDepthPrimRef.current) {
      obDepthPrimRef.current.setData(orderBook || null);
    }
  }, [orderBook]);

  // 1. Initialize Chart instance once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#09090b" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "rgba(39, 39, 42, 0.25)" },
        horzLines: { color: "rgba(39, 39, 42, 0.25)" },
      },
      crosshair: {
        mode: 1, // Normal mode
        vertLine: {
          color: "rgba(113, 113, 122, 0.5)",
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: "#18181b",
        },
        horzLine: {
          color: "rgba(113, 113, 122, 0.5)",
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: "#18181b",
        },
      },
      timeScale: {
        borderColor: "rgba(39, 39, 42, 0.25)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
      },
      rightPriceScale: {
        borderColor: "rgba(39, 39, 42, 0.25)",
      },
      width: container.clientWidth,
      height: container.clientHeight || 450,
    });
    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: resolveCSSColor("--janus-up-bright", "#0ecb81"),
      downColor: resolveCSSColor("--janus-down-bright", "#f6465d"),
      borderUpColor: resolveCSSColor("--janus-up-bright", "#0ecb81"),
      borderDownColor: resolveCSSColor("--janus-down-bright", "#f6465d"),
      wickUpColor: resolveCSSColor("--janus-up-bright", "#0ecb81"),
      wickDownColor: resolveCSSColor("--janus-down-bright", "#f6465d"),
    });
    candlestickSeriesRef.current = candlestickSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "", // Overlay on the main pane
    });
    volumeSeriesRef.current = volumeSeries;

    // Scale volume pane down
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // volume will occupy only the bottom 20%
        bottom: 0,
      },
    });

    // ─── Price line overlay: removed (close-to-close yellow line) ───
    priceLineSeriesRef.current = null;

    // ─── Volume MA line overlay ───
    const volumeMASeries = chart.addSeries(LineSeries, {
      color: "rgba(139, 92, 246, 0.6)", // soft purple
      lineWidth: 1,
      priceScaleId: "", // same pane as volume histogram
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    volumeMASeriesRef.current = volumeMASeries;

    // Sync HUD with crosshair movement
    chart.subscribeCrosshairMove((param) => {
      const currentData = dataRef.current;
      if (
        !param.time ||
        param.point === undefined ||
        param.point.x < 0 ||
        param.point.y < 0
      ) {
        // Show latest data if cursor is out of bounds
        const last = currentData[currentData.length - 1];
        if (last) {
          const dec = getPriceDecimals(symbol);
          const o = parseFloat(last.open);
          const c = parseFloat(last.close);
          const pct = ((c - o) / o) * 100;
          setHudData({
            time: new Date(last.openTime).toLocaleString(),
            open: o.toFixed(dec),
            high: parseFloat(last.high).toFixed(dec),
            low: parseFloat(last.low).toFixed(dec),
            close: c.toFixed(dec),
            volume: parseFloat(last.volume).toFixed(2),
            pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
            isGreen: c >= o,
          });
        }
        tooltipPrimRef.current?.setBar(null);
        return;
      }

      const candle = param.seriesData.get(candlestickSeries) as any;
      const volume = param.seriesData.get(volumeSeries) as any;

      if (candle) {
        const dec = getPriceDecimals(symbol);
        const o = candle.open;
        const c = candle.close;
        const pct = ((c - o) / o) * 100;
        setHudData({
          time: new Date((param.time as number) * 1000).toLocaleString(),
          open: o.toFixed(dec),
          high: candle.high.toFixed(dec),
          low: candle.low.toFixed(dec),
          close: c.toFixed(dec),
          volume: volume ? volume.value.toFixed(2) : "0.00",
          pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
          isGreen: c >= o,
        });
      }

      // Update crosshair tooltip primitive
      if (tooltipPrimRef.current) {
        const ohlc = param.seriesData.get(candlestickSeries) as any;
        if (ohlc && ohlc.open !== undefined) {
          const t = param.time as number;
          const kline = dataRef.current.find((k) => Math.round(k.openTime / 1000) === t);
          tooltipPrimRef.current.setBar({
            time: t,
            open: ohlc.open,
            high: ohlc.high,
            low: ohlc.low,
            close: ohlc.close,
            volume: kline ? parseFloat(kline.volume) : 0,
          });
        } else {
          tooltipPrimRef.current.setBar(null);
        }
      }
    });

    // Resize handler
    const handleResize = () => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Lazy load + "go live" detection on scroll
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;

      // Save visible range (zoom level & scroll position) to localStorage
      try {
        localStorage.setItem("janus_chart_logical_range", JSON.stringify({
          from: range.from,
          to: range.to
        }));
      } catch {}

      // Show "go live" button when right edge is > 3 bars behind the last loaded bar
      const lastIdx = dataRef.current.length - 1;
      setIsScrolledBack(lastIdx > 0 && range.to < lastIdx - 3);

      // When left edge approaches the first bar (< 5 bars left of data start)
      if (range.from > 5) return;
      if (isLoadingMoreRef.current) return;
      const oldest = dataRef.current[0];
      if (!oldest) return;
      isLoadingMoreRef.current = true;
      onLoadMoreRef.current?.(oldest.openTime);
    });

    setChartInitialized(true);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      obPrimRef.current = null;
      fvgPrimRef.current = null;
      strPrimRef.current = null;
      markersPluginRef.current = null;
      obvSeriesRef.current = null;
      priceLineSeriesRef.current = null;
      volumeMASeriesRef.current = null;
      volumeHistoryRef.current = [];
      indicatorSeriesRef.current.clear();
      setChartInitialized(false);
    };
  }, []);

  // 1b. Attach SMC primitives AFTER chart is confirmed ready (separate effect to avoid crashing init)
  useEffect(() => {
    if (!chartInitialized || !candlestickSeriesRef.current) return;
    try {
      const obPrim  = new OrderBlockPrimitive();
      const fvgPrim = new FVGPrimitive();
      const strPrim = new StructurePrimitive();
      const sessionPrim = new SessionShadingPrimitive();
      const tooltipPrim = new CrosshairTooltipPrimitive();
      candlestickSeriesRef.current.attachPrimitive(obPrim);
      candlestickSeriesRef.current.attachPrimitive(fvgPrim);
      candlestickSeriesRef.current.attachPrimitive(strPrim);
      candlestickSeriesRef.current.attachPrimitive(sessionPrim);
      candlestickSeriesRef.current.attachPrimitive(tooltipPrim);
      const sweepPrim = new LiquiditySweepPrimitive();
      candlestickSeriesRef.current.attachPrimitive(sweepPrim);
      obPrimRef.current      = obPrim;
      fvgPrimRef.current     = fvgPrim;
      strPrimRef.current     = strPrim;
      sessionPrimRef.current = sessionPrim;
      tooltipPrimRef.current = tooltipPrim;
      sweepPrimRef.current   = sweepPrim;
      // createSeriesMarkers replaces the old .setMarkers() — create lazily only when needed
      // to avoid interfering with auto-scroll and chart rendering pipeline
    } catch (err) {
      console.warn("[chart] SMC primitive attach failed:", err);
    }
    return () => {
      obPrimRef.current      = null;
      fvgPrimRef.current     = null;
      strPrimRef.current     = null;
      sessionPrimRef.current = null;
      tooltipPrimRef.current = null;
      sweepPrimRef.current   = null;
      markersPluginRef.current = null;
    };
  }, [chartInitialized]);

  // 1c. Update price scale precision based on selected symbol
  // NOTE: We set precision for the price axis label display but use a very
  // small minMove so that the lerp animation loop can produce smooth
  // intermediate frames without the chart library quantizing them away.
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;
    const dec = getPriceDecimals(symbol);
    candlestickSeriesRef.current.applyOptions({
      priceFormat: {
        type: "price",
        precision: dec,
        minMove: 0.0001, // keep small for smooth lerp animation frames
      },
    });
  }, [symbol, chartInitialized]);

  // 2. Update chart data — setData on full reload, update() on live tick
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0) return;

    const last = data[data.length - 1];
    const lastTime = last.openTime / 1000;
    const isLiveTick =
      prevDataLenRef.current === data.length &&
      prevLastTimeRef.current === lastTime;
    const isNewCandle =
      prevDataLenRef.current === data.length - 1 &&
      prevLastTimeRef.current !== null;

    if (isLiveTick || isNewCandle) {
      const o = parseFloat(last.open);
      const targetClose = parseFloat(last.close);
      const h = parseFloat(last.high);
      const l = parseFloat(last.low);
      const vol = parseFloat(last.volume);

      // If this is the first tick, seed current position so there's no jump
      if (!animSeeded.current) {
        animCurrent.current.close = targetClose;
        animCurrent.current.vol = vol;
        animSeeded.current = true;
      }

      // Update target — the lerp loop will smoothly chase both price AND volume
      animTarget.current = { time: lastTime, open: o, high: h, low: l, close: targetClose, vol };

      // Update volume history buffer for MA calculation
      const hist = volumeHistoryRef.current;
      if (isNewCandle) {
        // New candle: push new entry
        hist.push({ time: lastTime, value: vol });
        // Keep buffer bounded
        if (hist.length > VOLUME_MA_PERIOD + 5) hist.splice(0, hist.length - VOLUME_MA_PERIOD - 5);
      } else if (hist.length > 0) {
        // Update existing last entry
        hist[hist.length - 1] = { time: lastTime, value: vol };
      }

      // Kick off the lerp loop (no-op if already running) — handles candle, volume bar, price line, volume MA
      startAnimLoop();
    } else {
      // Full reload — symbol/interval change or initial load
      const chartData = data.map((d) => ({
        time: (d.openTime / 1000) as UTCTimestamp,
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
      })).sort((a, b) => (a.time as number) - (b.time as number));
      const volumeData = data.map((d) => {
        const o = parseFloat(d.open);
        const c = parseFloat(d.close);
        return {
          time: (d.openTime / 1000) as UTCTimestamp,
          value: parseFloat(d.volume),
          color: c >= o ? "rgba(14, 203, 129, 0.15)" : "rgba(246, 70, 93, 0.15)",
        };
      }).sort((a, b) => (a.time as number) - (b.time as number));
      candlestickSeriesRef.current.setData(chartData);
      volumeSeriesRef.current.setData(volumeData);

      // Price line overlay: set close prices
      if (priceLineSeriesRef.current) {
        const priceLineData = chartData.map((d) => ({ time: d.time, value: d.close }));
        priceLineSeriesRef.current.setData(priceLineData);
      }

      // Volume MA line: compute rolling MA over volume data
      if (volumeMASeriesRef.current) {
        const volValues = volumeData.map((d) => ({ time: d.time, value: d.value }));
        const volumeMAData: { time: UTCTimestamp; value: number }[] = [];
        for (let i = 0; i < volValues.length; i++) {
          const start = Math.max(0, i - VOLUME_MA_PERIOD + 1);
          const window = volValues.slice(start, i + 1);
          const ma = window.reduce((s, v) => s + v.value, 0) / window.length;
          volumeMAData.push({ time: volValues[i].time, value: ma });
        }
        volumeMASeriesRef.current.setData(volumeMAData);
      }

      // Seed volume history buffer for live MA computation
      volumeHistoryRef.current = volumeData.map((d) => ({ time: d.time as number, value: d.value }));

      const isSymbolChange = prevSymbolRef.current !== symbol;
      const isIntervalChange = prevIntervalRef.current !== interval;
      if (chartRef.current && (isSymbolChange || isIntervalChange)) {
        const storedRange = localStorage.getItem("janus_chart_logical_range");
        let restored = false;
        if (storedRange) {
          try {
            const parsed = JSON.parse(storedRange);
            if (typeof parsed.from === "number" && typeof parsed.to === "number") {
              if (isSymbolChange) {
                // Symbol changed: restore only the zoom width (number of bars)
                // and anchor it to the end of the new data to avoid out-of-bounds locking.
                const rangeWidth = Math.min(parsed.to - parsed.from, chartData.length - 10);
                const totalBars = chartData.length;
                if (rangeWidth > 5) {
                  chartRef.current.timeScale().setVisibleLogicalRange({
                    from: totalBars - rangeWidth,
                    to: totalBars,
                  });
                  restored = true;
                }
              } else {
                // Same symbol: restore exact visible coordinates
                chartRef.current.timeScale().setVisibleLogicalRange(parsed);
                restored = true;
              }
            }
          } catch (err) {
            console.warn("[chart] Failed to restore chart logical range:", err);
          }
        }
        if (!restored) {
          chartRef.current.timeScale().fitContent();
          chartRef.current.timeScale().scrollToPosition(8, false);
        }
      }
      // Reset animation state on full reload
      animCurrent.current.close = 0;
      animCurrent.current.vol = 0;
      animSeeded.current = false;
      animLoopRunning.current = false;
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    }

    prevDataLenRef.current = data.length;
    prevLastTimeRef.current = lastTime;
    prevSymbolRef.current = symbol;
    prevIntervalRef.current = interval;
    isLoadingMoreRef.current = false; // allow next lazy load after chart updated

    // Update HUD with live last candle
    const dec = getPriceDecimals(symbol);
    const o = parseFloat(last.open);
    const c = parseFloat(last.close);
    const pct = ((c - o) / o) * 100;
    setHudData({
      time: new Date(last.openTime).toLocaleString(),
      open: o.toFixed(dec),
      high: parseFloat(last.high).toFixed(dec),
      low: parseFloat(last.low).toFixed(dec),
      close: c.toFixed(dec),
      volume: parseFloat(last.volume).toFixed(2),
      pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      isGreen: c >= o,
    });
  }, [data, symbol, interval]);

  // 3. Live price tick — drives chart animation for all timeframes from ticker lastPrice.
  // klineStream provides high/low/volume updates; lastPrice provides real-time close.
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0 || lastPrice <= 0) return;

    const last = data[data.length - 1];
    const lastTime = last.openTime / 1000;
    const o = parseFloat(last.open);
    const targetClose = lastPrice;

    // Always merge: kline high/low (from klineStream via data prop) + live price.
    // On candle change, reset accumulator; otherwise only expand — never contract.
    const klineHigh = parseFloat(last.high);
    const klineLow = parseFloat(last.low);
    if (liveTimeRef.current !== lastTime) {
      liveTimeRef.current = lastTime;
      liveHighRef.current = klineHigh;
      liveLowRef.current = klineLow;
    }
    // Expand to include both the kline's actual high/low AND the current tick price
    liveHighRef.current = Math.max(liveHighRef.current, klineHigh, targetClose);
    liveLowRef.current = Math.min(liveLowRef.current, klineLow, targetClose);

    const h = liveHighRef.current;
    const l = liveLowRef.current;
    const vol = parseFloat(last.volume);

    if (!animSeeded.current) {
      animCurrent.current.close = targetClose;
      animCurrent.current.vol = vol;
      animSeeded.current = true;
    }

    animTarget.current = { time: lastTime, open: o, high: h, low: l, close: targetClose, vol };
    startAnimLoop();

    const dec = getPriceDecimals(symbol);
    const pct = ((targetClose - o) / o) * 100;
    setHudData({
      time: new Date(last.openTime).toLocaleString(),
      open: o.toFixed(dec),
      high: h.toFixed(dec),
      low: l.toFixed(dec),
      close: targetClose.toFixed(dec),
      volume: vol.toFixed(2),
      pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      isGreen: targetClose >= o,
    });
  }, [lastPrice, interval, data]);

  // 4. SMC / ICT overlay updates — runs when overlayData or toggles change
  useEffect(() => {
    if (!candlestickSeriesRef.current || !obPrimRef.current || !fvgPrimRef.current || !strPrimRef.current) return;
    const tog = overlayToggles;
    const pa  = overlayData;

    // Session shading
    if (sessionPrimRef.current) {
      sessionPrimRef.current.setEnabled(tog?.sessions ?? true);
    }

    // Crosshair tooltip
    if (tooltipPrimRef.current) {
      tooltipPrimRef.current.setEnabled(tog?.crosshairTooltip ?? true);
    }

    // Order Blocks
    obPrimRef.current.setBlocks(tog?.orderBlocks && pa?.orderBlocks ? pa.orderBlocks : []);

    // FVGs
    fvgPrimRef.current.setFVGs(tog?.fvg && pa?.fvgs ? pa.fvgs : []);

    // Structure + Liquidity + Swings
    strPrimRef.current.setData(
      tog?.structure  && pa?.structure  ? pa.structure  : [],
      tog?.liquidity  && pa?.liquidity  ? pa.liquidity  : [],
      tog?.swings     && pa?.swings     ? pa.swings     : []
    );

    // Swing markers + displacement markers — create plugin lazily on first use
    if (!markersPluginRef.current && candlestickSeriesRef.current) {
      try {
        markersPluginRef.current = createSeriesMarkers(candlestickSeriesRef.current, []);
      } catch (err) {
        console.warn("[chart] createSeriesMarkers failed:", err);
      }
    }
    if (markersPluginRef.current) {
      const markers: SeriesMarker<Time>[] = [];


      if (tog?.displacement && pa?.displacement) {
        for (const d of pa.displacement) {
          markers.push({
            time:     (d.time / 1000) as Time,
            position: d.direction === "bullish" ? "belowBar" : "aboveBar",
            shape:    d.direction === "bullish" ? "arrowUp" : "arrowDown",
            color:    d.direction === "bullish" ? resolveCSSColor("--janus-up", "#0ecb81") : resolveCSSColor("--janus-down", "#f6465d"),
            size:     1.5,
            text:     `${d.atrMultiple.toFixed(1)}×`,
          });
        }
      }

      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      markersPluginRef.current.setMarkers(markers);
    }

    // ─── OBV line series ───
    if (tog?.obv && pa?.obv && pa.obv.length > 0 && chartRef.current) {
      if (!obvSeriesRef.current) {
        try {
          const obvSeries = chartRef.current.addSeries(LineSeries, {
            color:       "rgba(6,182,212,0.80)",
            lineWidth:   1,
            priceScaleId: "obv",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          obvSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
            borderVisible: false,
          });
          obvSeriesRef.current = obvSeries;
        } catch { /* safe */ }
      }
      if (obvSeriesRef.current) {
        obvSeriesRef.current.setData(
          pa.obv.map((p) => ({ time: (p.time / 1000) as UTCTimestamp, value: p.value }))
            .sort((a, b) => (a.time as number) - (b.time as number))
        );
      }
    } else if (!tog?.obv && obvSeriesRef.current && chartRef.current) {
      try { chartRef.current.removeSeries(obvSeriesRef.current); } catch { /* safe */ }
      obvSeriesRef.current = null;
    }

    // Primitives call requestUpdate() internally via their setters above
  }, [overlayData, overlayToggles]);

  // ─── Sweep markers effect ───
  useEffect(() => {
    if (!sweepPrimRef.current) return;
    const enabled = overlayToggles?.sweepMarkers ?? true;
    sweepPrimRef.current.setEnabled(enabled);

    if (!enabled || !liquidityEvents || liquidityEvents.length === 0) {
      sweepPrimRef.current.setMarkers([]);
      return;
    }

    const markers: SweepMarker[] = liquidityEvents
      .filter((e) => ["SSS", "SS", "S"].includes(e.priority))
      .map((e) => ({
        time: e.timestamp,
        type: e.type,
        priority: e.priority as SweepMarker["priority"],
        message: e.message,
      }));

    sweepPrimRef.current.setMarkers(markers);
  }, [liquidityEvents, overlayToggles]);

  // ─── Indicator series update ───
  useEffect(() => {
    if (!chartRef.current || !indicatorCfg || data.length === 0) return;

    const chart   = chartRef.current;
    const serMap  = indicatorSeriesRef.current;
    const closes  = data.map((d) => parseFloat(d.close));
    const highs   = data.map((d) => parseFloat(d.high));
    const lows    = data.map((d) => parseFloat(d.low));
    const volumes = data.map((d) => parseFloat(d.volume));
    const times   = data.map((d) => d.openTime);

    const toTime = (i: number) => (times[i] / 1000) as UTCTimestamp;

    const addOrUpdate = (key: string, values: (number | null)[], color: string, dash = false, scaleId = "right") => {
      // WhitespaceData (just {time}) forces a visual break — don't filter nulls, include them as whitespace
      // Sort by time: klines data can arrive with out-of-order timestamps (live ticks merged into history)
      const lineData = values
        .map((v, i) => v !== null ? { time: toTime(i), value: v } : { time: toTime(i) })
        .sort((a, b) => (a.time as number) - (b.time as number)) as { time: UTCTimestamp; value?: number }[];
      if (lineData.length === 0) return;

      if (!serMap.has(key)) {
        try {
          const s = chart.addSeries(LineSeries, {
            color, lineWidth: 1,
            lineStyle: dash ? 2 : 0,  // 2 = dashed in LC
            priceScaleId: scaleId,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          if (scaleId !== "right") {
            s.priceScale().applyOptions({ scaleMargins: { top: 0.80, bottom: 0 }, borderVisible: false });
          }
          serMap.set(key, s);
        } catch { return; }
      }
      serMap.get(key)?.setData(lineData);
    };

    const removeKey = (key: string) => {
      if (serMap.has(key)) {
        try { chart.removeSeries(serMap.get(key)); } catch { /* safe */ }
        serMap.delete(key);
      }
    };

    // EMA
    const allEMAPeriods = [9, 21, 50, 200];
    for (const p of allEMAPeriods) {
      const key = `ema-${p}`;
      if (indicatorCfg.ema.includes(p)) {
        addOrUpdate(key, calcEMA(closes, p), EMA_COLORS[p] ?? "#71717a");
      } else {
        removeKey(key);
      }
    }

    // SMA
    const allSMAPeriods = [20, 50, 200];
    for (const p of allSMAPeriods) {
      const key = `sma-${p}`;
      if (indicatorCfg.sma.includes(p)) {
        addOrUpdate(key, calcSMA(closes, p), SMA_COLORS[p] ?? "#71717a", true);
      } else {
        removeKey(key);
      }
    }

    // Bollinger Bands — split per-bar into squeeze (amber) and normal (cyan) segments.
    // Squeeze = BB bands are inside Keltner channels (low-volatility coil).
    if (indicatorCfg.bb) {
      const { upper, middle, lower } = calcBB(closes, indicatorCfg.bbPeriod, indicatorCfg.bbMult);
      // Compute squeeze state using same period as BB, kMult=1.5
      const { upper: kcU, lower: kcL } = calcKeltner(
        highs, lows, closes, indicatorCfg.bbPeriod, indicatorCfg.bbPeriod, 1.5
      );
      const sqz = upper.map((u, i) => {
        const l = lower[i], ku = kcU[i], kl = kcL[i];
        return u !== null && l !== null && ku !== null && kl !== null
          ? (u as number) < (ku as number) && (l as number) > (kl as number)
          : null;
      });

      // Per-band: value present only on squeeze bars; null (whitespace) otherwise
      const split = (band: (number | null)[]) => ({
        sq:   band.map((v, i) => sqz[i] === true  ? v : null),
        norm: band.map((v, i) => sqz[i] === false ? v : null),
      });

      const ubands = split(upper), mbands = split(middle), lbands = split(lower);

      addOrUpdate("bb-upper-sq",    ubands.sq,   "rgba(245,158,11,0.90)");
      addOrUpdate("bb-upper-norm",  ubands.norm, "rgba(6,182,212,0.70)");
      addOrUpdate("bb-middle-sq",   mbands.sq,   "rgba(245,158,11,0.55)", true);
      addOrUpdate("bb-middle-norm", mbands.norm, "rgba(6,182,212,0.40)",  true);
      addOrUpdate("bb-lower-sq",    lbands.sq,   "rgba(245,158,11,0.90)");
      addOrUpdate("bb-lower-norm",  lbands.norm, "rgba(6,182,212,0.70)");
      // Remove legacy single-color keys if present
      ["bb-upper", "bb-middle", "bb-lower"].forEach(removeKey);
    } else {
      ["bb-upper-sq", "bb-upper-norm", "bb-middle-sq", "bb-middle-norm",
       "bb-lower-sq", "bb-lower-norm", "bb-upper", "bb-middle", "bb-lower"].forEach(removeKey);
    }

    // SuperTrend — split into separate continuous segments to prevent straight-line bridges across gaps
    const removePrefixKeys = (prefix: string) => {
      Array.from(serMap.keys()).forEach((key) => {
        if (key.startsWith(`${prefix}-`)) {
          removeKey(key);
        }
      });
    };

    const renderST = (prefix: string, stValues: (number | null)[], stDirection: ("up" | "down" | null)[],
                      bullColor: string, bearColor: string) => {
      // Clean up previous segments
      removePrefixKeys(prefix);

      interface Segment {
        direction: "up" | "down";
        data: { time: UTCTimestamp; value: number }[];
      }
      const segments: Segment[] = [];
      let currentSegment: Segment | null = null;

      for (let i = 0; i < stValues.length; i++) {
        const val = stValues[i];
        const dir = stDirection[i];

        if (val === null || dir === null) {
          if (currentSegment) {
            segments.push(currentSegment);
            currentSegment = null;
          }
          continue;
        }

        if (!currentSegment || currentSegment.direction !== dir) {
          if (currentSegment) {
            segments.push(currentSegment);
          }
          currentSegment = {
            direction: dir,
            data: [],
          };
        }

        currentSegment.data.push({
          time: toTime(i),
          value: val,
        });
      }
      if (currentSegment) {
        segments.push(currentSegment);
      }

      // Add each segment as a distinct LineSeries
      segments.forEach((seg, idx) => {
        const key = `${prefix}-seg-${idx}`;
        const color = seg.direction === "up" ? bullColor : bearColor;
        try {
          const s = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1.5,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          serMap.set(key, s);
          s.setData(seg.data);
        } catch {
          // Safe check
        }
      });

      // clean up legacy single-series key
      removeKey(prefix);
    };

    if (indicatorCfg.superTrend) {
      const { values, direction } = calcSuperTrend(highs, lows, closes, indicatorCfg.superTrendPeriod, indicatorCfg.superTrendMult);
      renderST("st", values, direction, "rgba(34,197,94,0.90)", "rgba(239,68,68,0.90)");
    } else {
      removePrefixKeys("st");
      removeKey("st");
    }

    // KNN SuperTrend — fixed params (period=10, mult=3) matching backend knn-supertrend service
    if (indicatorCfg.knnSuperTrend) {
      const { values, direction } = calcSuperTrend(highs, lows, closes, 10, 3);
      renderST("knn-st", values, direction, "rgba(6,182,212,0.90)", "rgba(251,146,60,0.90)");
    } else {
      removePrefixKeys("knn-st");
      removeKey("knn-st");
    }

    // RSI sub-pane with 70/50/30 reference lines
    if (indicatorCfg.rsi) {
      const rsiValues = calcRSI(closes, indicatorCfg.rsiPeriod);
      addOrUpdate("rsi", rsiValues, "rgba(168,85,247,0.85)", false, "rsi");
      const rsiSeries = serMap.get("rsi");
      if (rsiSeries && rsiPriceLinesRef.current.length === 0) {
        const lineOpts = [
          { price: 70, color: "rgba(239,68,68,0.50)",  lineWidth: 1, lineStyle: 2, title: "OB" },
          { price: 50, color: "rgba(113,113,122,0.35)", lineWidth: 1, lineStyle: 3, title: "" },
          { price: 30, color: "rgba(34,197,94,0.50)",  lineWidth: 1, lineStyle: 2, title: "OS" },
        ] as const;
        rsiPriceLinesRef.current = lineOpts.map((o) => rsiSeries.createPriceLine(o));
      }
    } else {
      // Clean up price lines when RSI toggled off
      const rsiSeries = serMap.get("rsi");
      if (rsiSeries) {
        rsiPriceLinesRef.current.forEach((l) => { try { rsiSeries.removePriceLine(l); } catch { /* safe */ } });
      }
      rsiPriceLinesRef.current = [];
      removeKey("rsi");
    }

    // VWAP + ±1σ/±2σ bands (volume-weighted standard deviation)
    if (indicatorCfg.vwap) {
      const { vwap, upper1, lower1, upper2, lower2 } = calcVWAP(times, highs, lows, closes, volumes);
      addOrUpdate("vwap",    vwap,   "rgba(245,158,11,0.90)");
      addOrUpdate("vwap-u1", upper1, "rgba(245,158,11,0.50)", true);
      addOrUpdate("vwap-l1", lower1, "rgba(245,158,11,0.50)", true);
      addOrUpdate("vwap-u2", upper2, "rgba(245,158,11,0.25)", true);
      addOrUpdate("vwap-l2", lower2, "rgba(245,158,11,0.25)", true);
    } else {
      ["vwap", "vwap-u1", "vwap-l1", "vwap-u2", "vwap-l2"].forEach(removeKey);
    }

    // CVD — per-bar delta histogram + cumulative CVD line, both on "cvd" sub-pane
    if (indicatorCfg.cvd) {
      let delta: (number | null)[];
      let cvd: (number | null)[];

      if (cvdBars && cvdBars.length >= 10 && data.length > 0) {
        // Aggregate tick-level CVD into per-bar buckets
        const barMs = data.length > 1
          ? (data[1].openTime - data[0].openTime)
          : 60_000;

        let lastCum = 0;
        delta = data.map((bar) => {
          const barEnd = bar.openTime + barMs;
          const ticks = cvdBars.filter((t) => t.ts >= bar.openTime && t.ts < barEnd);
          return ticks.length > 0 ? ticks.reduce((sum, t) => sum + t.delta, 0) : null;
        });
        cvd = data.map((bar) => {
          const barEnd = bar.openTime + barMs;
          const ticks = cvdBars.filter((t) => t.ts >= bar.openTime && t.ts < barEnd);
          if (ticks.length > 0) lastCum = ticks[ticks.length - 1].cumulative;
          return lastCum;
        });
      } else {
        // Fallback: OHLCV approximation
        const result = calcCVD(highs, lows, closes, volumes);
        delta = result.delta;
        cvd = result.cvd;
      }
      const upColor   = "rgba(14,203,129,0.65)";
      const downColor = "rgba(246,70,93,0.65)";
      const cvdScaleOpts = { scaleMargins: { top: 0.78, bottom: 0 }, borderVisible: false };

      // Histogram (per-bar delta)
      if (!cvdHistRef.current && chart) {
        try {
          const h = chart.addSeries(HistogramSeries, {
            priceScaleId: "cvd",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          h.priceScale().applyOptions(cvdScaleOpts);
          cvdHistRef.current = h;
        } catch { /* safe */ }
      }
      if (cvdHistRef.current) {
        const histData = delta
          .map((v, i) => v !== null ? { time: toTime(i), value: v, color: v >= 0 ? upColor : downColor } : null)
          .filter(Boolean)
          .sort((a, b) => (a!.time as number) - (b!.time as number)) as { time: UTCTimestamp; value: number; color: string }[];
        cvdHistRef.current.setData(histData);
      }

      // CVD cumulative line
      addOrUpdate("cvd-line", cvd, "rgba(6,182,212,0.85)", false, "cvd");
      // Sync scale margins for the line series
      serMap.get("cvd-line")?.priceScale().applyOptions(cvdScaleOpts);

    } else {
      // Tear down CVD
      if (cvdHistRef.current && chart) {
        try { chart.removeSeries(cvdHistRef.current); } catch { /* safe */ }
        cvdHistRef.current = null;
      }
      removeKey("cvd-line");
    }

    // MACD — histogram (green/red) + MACD line (blue) + signal line (orange) on "macd" sub-pane
    if (indicatorCfg.macd) {
      const { macd, signal, histogram } = calcMACD(closes, indicatorCfg.macdFast, indicatorCfg.macdSlow, indicatorCfg.macdSignal);
      const macdScaleOpts = { scaleMargins: { top: 0.76, bottom: 0 }, borderVisible: false };

      // Histogram (colored bars)
      if (!macdHistRef.current && chart) {
        try {
          const h = chart.addSeries(HistogramSeries, {
            priceScaleId: "macd",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          h.priceScale().applyOptions(macdScaleOpts);
          macdHistRef.current = h;
        } catch { /* safe */ }
      }
      if (macdHistRef.current) {
        // 4-color histogram: strong/weak bull (green) + strong/weak bear (red)
        const histData = histogram
          .map((v, i) => {
            if (v === null) return null;
            const prev = histogram[i - 1] ?? v;
            let color: string;
            if (v >= 0) color = v > prev ? "rgba(14,203,129,0.90)" : "rgba(14,203,129,0.42)";
            else        color = v < prev ? "rgba(246,70,93,0.90)"  : "rgba(246,70,93,0.42)";
            return { time: toTime(i), value: v, color };
          })
          .filter(Boolean)
          .sort((a, b) => (a!.time as number) - (b!.time as number)) as { time: UTCTimestamp; value: number; color: string }[];
        macdHistRef.current.setData(histData);
      }

      // MACD line + signal line
      addOrUpdate("macd-line",   macd,   "rgba(59,130,246,0.90)", false, "macd");
      addOrUpdate("macd-signal", signal, "rgba(245,158,11,0.90)", false, "macd");
      serMap.get("macd-line")?.priceScale().applyOptions(macdScaleOpts);
      serMap.get("macd-signal")?.priceScale().applyOptions(macdScaleOpts);

    } else {
      if (macdHistRef.current && chart) {
        try { chart.removeSeries(macdHistRef.current); } catch { /* safe */ }
        macdHistRef.current = null;
      }
      removeKey("macd-line");
      removeKey("macd-signal");
    }

    // Nadaraya-Watson Envelope — kernel regression + MAE bands on main price pane
    if (indicatorCfg.nw) {
      const { estimate, upper, lower } = calcNW(closes, indicatorCfg.nwBandwidth, indicatorCfg.nwMult);
      addOrUpdate("nw-est",   estimate, "rgba(168,85,247,0.90)");
      addOrUpdate("nw-upper", upper,    "rgba(168,85,247,0.50)", true);
      addOrUpdate("nw-lower", lower,    "rgba(168,85,247,0.50)", true);
    } else {
      ["nw-est", "nw-upper", "nw-lower"].forEach(removeKey);
    }

    // Stochastic RSI — %K (cyan) + %D (amber) on "stochrsi" sub-pane with 80/20 lines
    if (indicatorCfg.stochRsi) {
      const { k, d } = calcStochRSI(closes, indicatorCfg.stochRsiPeriod, indicatorCfg.stochRsiPeriod, indicatorCfg.stochSmoothK, indicatorCfg.stochSmoothD);
      addOrUpdate("stochrsi-k", k, "rgba(6,182,212,0.85)",  false, "stochrsi");
      addOrUpdate("stochrsi-d", d, "rgba(245,158,11,0.85)", false, "stochrsi");
      const scaleOpts = { scaleMargins: { top: 0.76, bottom: 0 }, borderVisible: false };
      serMap.get("stochrsi-k")?.priceScale().applyOptions(scaleOpts);
      serMap.get("stochrsi-d")?.priceScale().applyOptions(scaleOpts);
      // 80/20 reference lines
      const kSeries = serMap.get("stochrsi-k");
      if (kSeries && stochRsiPriceLinesRef.current.length === 0) {
        stochRsiPriceLinesRef.current = [
          kSeries.createPriceLine({ price: 80, color: "rgba(239,68,68,0.45)",  lineWidth: 1, lineStyle: 2, title: "OB" }),
          kSeries.createPriceLine({ price: 50, color: "rgba(113,113,122,0.30)", lineWidth: 1, lineStyle: 3, title: "" }),
          kSeries.createPriceLine({ price: 20, color: "rgba(34,197,94,0.45)",  lineWidth: 1, lineStyle: 2, title: "OS" }),
        ];
      }
    } else {
      const kSeries = serMap.get("stochrsi-k");
      if (kSeries) {
        stochRsiPriceLinesRef.current.forEach((l) => { try { kSeries.removePriceLine(l); } catch { /* safe */ } });
      }
      stochRsiPriceLinesRef.current = [];
      removeKey("stochrsi-k");
      removeKey("stochrsi-d");
    }

    // Parabolic SAR — bull dots (green) above price, bear dots (red) below, on main pane
    if (indicatorCfg.psar) {
      const { values, direction } = calcPSAR(highs, lows, closes, indicatorCfg.psarStep, indicatorCfg.psarMax);
      const bullSAR = values.map((v, i) => direction[i] === "up"   ? v : null);
      const bearSAR = values.map((v, i) => direction[i] === "down" ? v : null);
      addOrUpdate("psar-bull", bullSAR, "#0ecb81",   false, "right");
      addOrUpdate("psar-bear", bearSAR, "#f6465d", false, "right");
      // Style as dotted (lineStyle 3) to visually approximate dots
      const dotStyle = { lineWidth: 1, lineStyle: 3 } as const;
      serMap.get("psar-bull")?.applyOptions({ ...dotStyle, lineWidth: 1 });
      serMap.get("psar-bear")?.applyOptions({ ...dotStyle, lineWidth: 1 });
    } else {
      removeKey("psar-bull");
      removeKey("psar-bear");
    }

    // Ichimoku Cloud — 5 lines on main price pane
    // Tenkan=orange, Kijun=blue, SpanA=green, SpanB=red, Chikou=gray
    // Note: SpanA/SpanB extend `displacement` bars into the future — arrays are longer than closes
    if (indicatorCfg.ichimoku) {
      const { tenkan, kijun, spanA, spanB, chikou } = calcIchimoku(highs, lows, closes);
      const n = closes.length;
      const disp = 26;
      // Main-pane lines (aligned with closes index)
      addOrUpdate("ichi-tenkan", tenkan.slice(0, n), "rgba(239,68,68,0.85)");
      addOrUpdate("ichi-kijun",  kijun.slice(0, n),  "rgba(59,130,246,0.85)");
      addOrUpdate("ichi-chikou", chikou.slice(0, n),  "rgba(113,113,122,0.70)");
      // Future cloud lines — map displacement-shifted indices to times by extending toTime
      const futureSpanA: (number | null)[] = new Array(n).fill(null);
      const futureSpanB: (number | null)[] = new Array(n).fill(null);
      for (let i = n - disp; i < n; i++) {
        futureSpanA[i] = spanA[i + disp] ?? null;
        futureSpanB[i] = spanB[i + disp] ?? null;
      }
      addOrUpdate("ichi-spanA", futureSpanA, "rgba(14,203,129,0.60)",   true);
      addOrUpdate("ichi-spanB", futureSpanB, "rgba(246,70,93,0.60)", true);
    } else {
      ["ichi-tenkan", "ichi-kijun", "ichi-chikou", "ichi-spanA", "ichi-spanB"].forEach(removeKey);
    }

    // ADX + DI lines — all on "adx" sub-pane
    // ADX=amber (trend strength 0-100), +DI=green, -DI=red
    if (indicatorCfg.adx) {
      const { adx, diPlus, diMinus } = calcADX(highs, lows, closes, indicatorCfg.adxPeriod);
      const adxScaleOpts = { scaleMargins: { top: 0.76, bottom: 0 }, borderVisible: false };
      addOrUpdate("adx-line",    adx,     "rgba(245,158,11,0.90)",  false, "adx");
      addOrUpdate("adx-diplus",  diPlus,  "rgba(14,203,129,0.80)",   false, "adx");
      addOrUpdate("adx-diminus", diMinus, "rgba(246,70,93,0.80)", false, "adx");
      serMap.get("adx-line")?.priceScale().applyOptions(adxScaleOpts);
    } else {
      ["adx-line", "adx-diplus", "adx-diminus"].forEach(removeKey);
    }

    // Z-Score — sub-pane with ±2/±1/0 reference lines
    if (indicatorCfg.zScore) {
      const zValues = calcZScore(closes, indicatorCfg.zScorePeriod);
      addOrUpdate("zscore", zValues, "rgba(6,182,212,0.85)", false, "zscore");
      const scaleOpts = { scaleMargins: { top: 0.76, bottom: 0 }, borderVisible: false };
      serMap.get("zscore")?.priceScale().applyOptions(scaleOpts);
      const zSeries = serMap.get("zscore");
      if (zSeries && zScorePriceLinesRef.current.length === 0) {
        zScorePriceLinesRef.current = [
          zSeries.createPriceLine({ price:  2, color: "rgba(239,68,68,0.50)",   lineWidth: 1, lineStyle: 2, title: "+2σ" }),
          zSeries.createPriceLine({ price:  1, color: "rgba(239,68,68,0.25)",   lineWidth: 1, lineStyle: 3, title: "+1σ" }),
          zSeries.createPriceLine({ price:  0, color: "rgba(113,113,122,0.40)", lineWidth: 1, lineStyle: 0, title: "0" }),
          zSeries.createPriceLine({ price: -1, color: "rgba(34,197,94,0.25)",   lineWidth: 1, lineStyle: 3, title: "-1σ" }),
          zSeries.createPriceLine({ price: -2, color: "rgba(34,197,94,0.50)",   lineWidth: 1, lineStyle: 2, title: "-2σ" }),
        ];
      }
    } else {
      const zSeries = serMap.get("zscore");
      if (zSeries) {
        zScorePriceLinesRef.current.forEach((l) => { try { zSeries.removePriceLine(l); } catch { /* safe */ } });
      }
      zScorePriceLinesRef.current = [];
      removeKey("zscore");
    }

    // Keltner Channels — EMA middle + ATR-based upper/lower bands (cyan)
    if (indicatorCfg.keltner) {
      const { upper, middle, lower } = calcKeltner(highs, lows, closes, indicatorCfg.keltnerEma, indicatorCfg.keltnerAtr, indicatorCfg.keltnerMult);
      addOrUpdate("keltner-upper",  upper,  "rgba(6,182,212,0.70)", true);
      addOrUpdate("keltner-middle", middle, "rgba(6,182,212,0.90)");
      addOrUpdate("keltner-lower",  lower,  "rgba(6,182,212,0.70)", true);
    } else {
      ["keltner-upper", "keltner-middle", "keltner-lower"].forEach(removeKey);
    }

    // Donchian Channels — highest high / lowest low / midline (purple)
    if (indicatorCfg.donchian) {
      const { upper, middle, lower } = calcDonchian(highs, lows, indicatorCfg.donchianPeriod);
      addOrUpdate("donchian-upper",  upper,  "rgba(168,85,247,0.70)", true);
      addOrUpdate("donchian-middle", middle, "rgba(168,85,247,0.45)", true);
      addOrUpdate("donchian-lower",  lower,  "rgba(168,85,247,0.70)", true);
    } else {
      ["donchian-upper", "donchian-middle", "donchian-lower"].forEach(removeKey);
    }

    // TTM Squeeze — 4-color momentum histogram on "ttmsq" sub-pane
    if (indicatorCfg.ttmSqueeze) {
      const { momentum, histColor } = calcTTMSqueeze(
        closes, highs, lows, indicatorCfg.ttmSqPeriod, indicatorCfg.ttmSqBBMult, indicatorCfg.ttmSqKMult
      );
      const ttmScaleOpts = { scaleMargins: { top: 0.78, bottom: 0 }, borderVisible: false };
      if (!ttmSqHistRef.current && chart) {
        try {
          const h = chart.addSeries(HistogramSeries, { priceScaleId: "ttmsq", lastValueVisible: false, priceLineVisible: false });
          h.priceScale().applyOptions(ttmScaleOpts);
          ttmSqHistRef.current = h;
        } catch { /* safe */ }
      }
      if (ttmSqHistRef.current) {
        const colorMap: Record<string, string> = {
          g_strong: "rgba(14,203,129,0.90)", g_weak: "rgba(14,203,129,0.42)",
          r_strong: "rgba(246,70,93,0.90)",  r_weak: "rgba(246,70,93,0.42)",
        };
        const ttmData = momentum
          .map((v, i) => {
            if (v === null || histColor[i] === null) return null;
            return { time: toTime(i), value: v, color: colorMap[histColor[i]!] ?? "rgba(113,113,122,0.50)" };
          })
          .filter(Boolean)
          .sort((a, b) => (a!.time as number) - (b!.time as number)) as { time: UTCTimestamp; value: number; color: string }[];
        ttmSqHistRef.current.setData(ttmData);
      }
    } else if (!indicatorCfg.ttmSqueeze && ttmSqHistRef.current && chart) {
      try { chart.removeSeries(ttmSqHistRef.current); } catch { /* safe */ }
      ttmSqHistRef.current = null;
    }

    // Volume Profile — canvas primitive attached to candlestick series
    if (indicatorCfg.volumeProfile && candlestickSeriesRef.current) {
      const vpData = calcVolumeProfile(highs, lows, closes, volumes, indicatorCfg.volumeProfileBuckets);
      if (!vpPrimRef.current) {
        vpPrimRef.current = new VolumeProfilePrimitive();
        try { candlestickSeriesRef.current.attachPrimitive(vpPrimRef.current); } catch { /* safe */ }
      }
      vpPrimRef.current.setData(vpData);
    } else if (!indicatorCfg.volumeProfile && vpPrimRef.current) {
      vpPrimRef.current.setData(null);
      try { candlestickSeriesRef.current?.detachPrimitive(vpPrimRef.current); } catch { /* safe */ }
      vpPrimRef.current = null;
    }

    // Order Book Depth — canvas primitive attached to candlestick series
    if (interval === "1m" && candlestickSeriesRef.current) {
      if (!obDepthPrimRef.current) {
        obDepthPrimRef.current = new OrderBookDepthPrimitive();
        try { candlestickSeriesRef.current.attachPrimitive(obDepthPrimRef.current); } catch { /* safe */ }
      }
    } else if (interval !== "1m" && obDepthPrimRef.current) {
      obDepthPrimRef.current.setData(null);
      try { candlestickSeriesRef.current?.detachPrimitive(obDepthPrimRef.current); } catch { /* safe */ }
      obDepthPrimRef.current = null;
    }

    // ── Indicator Signal Markers ─────────────────────────────────────────
    // Collect signals from all active indicators, render on dedicated plugin.
    if (candlestickSeriesRef.current) {
      if (!indicatorMarkersRef.current) {
        try { indicatorMarkersRef.current = createSeriesMarkers(candlestickSeriesRef.current, []); }
        catch { /* safe */ }
      }
      const signals: ReturnType<typeof detectMACDSignals> = [];

      if (indicatorCfg.macd) {
        const { macd: m, signal: s } = calcMACD(closes, indicatorCfg.macdFast, indicatorCfg.macdSlow, indicatorCfg.macdSignal);
        signals.push(...detectMACDSignals(m, s, times));
      }
      if (indicatorCfg.adx) {
        const { adx, diPlus, diMinus } = calcADX(highs, lows, closes, indicatorCfg.adxPeriod);
        signals.push(...detectADXSignals(adx, diPlus, diMinus, times));
      }
      if (indicatorCfg.superTrend) {
        const { direction } = calcSuperTrend(highs, lows, closes, indicatorCfg.superTrendPeriod, indicatorCfg.superTrendMult);
        signals.push(...detectDirectionFlips(direction, times, "ST"));
      }
      if (indicatorCfg.knnSuperTrend) {
        // KNN ST direction is computed inline in Dashboard — recompute here for signals
        const { direction } = calcSuperTrend(highs, lows, closes, 10, 3);
        signals.push(...detectDirectionFlips(direction, times, "KNN"));
      }
      if (indicatorCfg.psar) {
        const { direction } = calcPSAR(highs, lows, closes, indicatorCfg.psarStep, indicatorCfg.psarMax);
        signals.push(...detectDirectionFlips(direction, times, "SAR"));
      }
      if (indicatorCfg.stochRsi) {
        const { k, d } = calcStochRSI(closes, indicatorCfg.stochRsiPeriod, indicatorCfg.stochRsiPeriod, indicatorCfg.stochSmoothK, indicatorCfg.stochSmoothD);
        signals.push(...detectStochCross(k, d, times));
      }
      if (indicatorCfg.zScore) {
        const z = calcZScore(closes, indicatorCfg.zScorePeriod);
        signals.push(...detectZScoreSignals(z, times));
      }
      if (indicatorCfg.ichimoku) {
        const { tenkan, kijun, spanA, spanB } = calcIchimoku(highs, lows, closes);
        signals.push(...detectIchimokuSignals(closes, tenkan, kijun, spanA, spanB, times));
      }
      if (indicatorCfg.donchian) {
        const { upper, lower } = calcDonchian(highs, lows, indicatorCfg.donchianPeriod);
        signals.push(...detectDonchianBreakout(closes, upper, lower, times));
      }
      if (indicatorCfg.nw) {
        const { upper, lower } = calcNW(closes, indicatorCfg.nwBandwidth, indicatorCfg.nwMult);
        signals.push(...detectNWBandTag(closes, upper, lower, times));
      }
      if (indicatorCfg.vwap) {
        const { vwap } = calcVWAP(times, highs, lows, closes, volumes);
        signals.push(...detectVWAPSignals(closes, vwap, times));
      }
      if (indicatorCfg.rsi) {
        const rsiVals = calcRSI(closes, indicatorCfg.rsiPeriod);
        signals.push(...detectRSIDivergence(closes, rsiVals, times));
      }
      if (indicatorCfg.cvd) {
        let cvdForSignals: (number | null)[];
        if (cvdBars && cvdBars.length >= 10 && data.length > 0) {
          const barMs = data.length > 1 ? (data[1].openTime - data[0].openTime) : 60_000;
          let lastCum = 0;
          cvdForSignals = data.map((bar) => {
            const barEnd = bar.openTime + barMs;
            const ticks = cvdBars.filter((t) => t.ts >= bar.openTime && t.ts < barEnd);
            if (ticks.length > 0) lastCum = ticks[ticks.length - 1].cumulative;
            return lastCum;
          });
        } else {
          const result = calcCVD(highs, lows, closes, volumes);
          cvdForSignals = result.cvd;
        }
        signals.push(...detectCVDDivergence(closes, cvdForSignals, times));
      }

      if (indicatorMarkersRef.current) {
        indicatorMarkersRef.current.setMarkers(
          signals.sort((a, b) => (a.time as number) - (b.time as number))
        );
      }
    }

  // Throttle: only rerun heavy indicator calculations when candle count changes
  // (new candle) or when config/interval changes — NOT on every intra-candle tick.
  // The tick-level animation (lerp loop) runs independently via requestAnimationFrame.
  }, [indicatorCfg, data.length, interval]);

  // Draw custom position lines (entry price and liquidation price) with empty titles
  // so the HTML overlay can render custom left/right aligned labels on top.
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series) return;

    // Remove all old price lines
    priceLinesRef.current.forEach((line) => {
      try {
        series.removePriceLine(line);
      } catch (err) {
        console.error("Failed to remove price line", err);
      }
    });
    priceLinesRef.current = [];

    // Create new price lines for current positions
    if (!positions || positions.length === 0) return;

    const newLines = positions
      .map((pos) => {
        const entryPrice = parseFloat(pos.entryPrice);
        if (isNaN(entryPrice) || entryPrice <= 0) return null;

        const isLong = pos.side === "long";
        const color = isLong ? resolveCSSColor("--janus-up-bright", "#0ecb81") : resolveCSSColor("--janus-down-bright", "#f6465d");

        try {
          const line = series.createPriceLine({
            price: entryPrice,
            color: color,
            lineWidth: 1.5,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "", // empty title, handled by HTML overlay
          });
          return line;
        } catch (err) {
          console.error("Error creating entry price line", err);
          return null;
        }
      })
      .filter(Boolean);

    // Create liquidation lines
    const liqLines = positions
      .map((pos) => {
        if (!pos.liquidationPrice) return null;
        const liqPrice = parseFloat(pos.liquidationPrice);
        if (isNaN(liqPrice) || liqPrice <= 0) return null;

        try {
          const line = series.createPriceLine({
            price: liqPrice,
            color: "#f59e0b",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "", // empty title, handled by HTML overlay
          });
          return line;
        } catch (err) {
          console.error("Error creating liq price line", err);
          return null;
        }
      })
      .filter(Boolean);

    priceLinesRef.current = [...newLines, ...liqLines];
  }, [positions, chartInitialized]);

  // Draw custom price alert lines
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || !chartInitialized) return;

    customAlertLinesRef.current.forEach((line) => {
      try {
        series.removePriceLine(line);
      } catch (err) {
        console.error("Failed to remove custom price line", err);
      }
    });
    customAlertLinesRef.current = [];

    const activePriceAlerts = alertRules.filter(
      (rule) => rule.symbol === symbol && rule.type === "price" && rule.isActive
    );

    const newAlertLines = activePriceAlerts.map((rule) => {
      try {
        const line = series.createPriceLine({
          price: rule.value,
          color: "#f59e0b",
          lineWidth: 1.5,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `Alert @ ${rule.value.toFixed(2)}`,
        });
        return line;
      } catch (err) {
        console.error("Error creating custom price line", err);
        return null;
      }
    }).filter(Boolean);

    customAlertLinesRef.current = newAlertLines;
  }, [alertRules, symbol, chartInitialized]);

  // Draw bid and ask price lines
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || !chartInitialized) return;

    if (bidAskLinesRef.current.bidLine) {
      try { series.removePriceLine(bidAskLinesRef.current.bidLine); } catch {}
      bidAskLinesRef.current.bidLine = null;
    }
    if (bidAskLinesRef.current.askLine) {
      try { series.removePriceLine(bidAskLinesRef.current.askLine); } catch {}
      bidAskLinesRef.current.askLine = null;
    }

    if (bidPrice && bidPrice > 0) {
      try {
        bidAskLinesRef.current.bidLine = series.createPriceLine({
          price: bidPrice,
          color: "rgba(16, 185, 129, 0.65)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "BID",
        });
      } catch (err) {
        console.error("Error creating bid line", err);
      }
    }

    if (askPrice && askPrice > 0) {
      try {
        bidAskLinesRef.current.askLine = series.createPriceLine({
          price: askPrice,
          color: "rgba(239, 68, 68, 0.65)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "ASK",
        });
      } catch (err) {
        console.error("Error creating ask line", err);
      }
    }

    return () => {
      const s = candlestickSeriesRef.current;
      if (!s) return;
      if (bidAskLinesRef.current.bidLine) {
        try { s.removePriceLine(bidAskLinesRef.current.bidLine); } catch {}
        bidAskLinesRef.current.bidLine = null;
      }
      if (bidAskLinesRef.current.askLine) {
        try { s.removePriceLine(bidAskLinesRef.current.askLine); } catch {}
        bidAskLinesRef.current.askLine = null;
      }
    };
  }, [bidPrice, askPrice, chartInitialized]);



  // Recalculate vertical coordinates of active positions on the canvas
  const updatePositionsCoordinates = useCallback(() => {
    const series = candlestickSeriesRef.current;
    const newCoords: Record<number, { entryY: number | null; liqY: number | null }> = {};
    
    if (lastPrice > 0) {
      setLastPriceY(series.priceToCoordinate(lastPrice));
    } else {
      setLastPriceY(null);
    }

    if (!positions || positions.length === 0) {
      setPositionsY(newCoords);
      return;
    }
    positions.forEach((pos) => {
      const entryPrice = parseFloat(pos.entryPrice);
      if (isNaN(entryPrice) || entryPrice <= 0) return;

      const entryY = series.priceToCoordinate(entryPrice);
      let liqY: number | null = null;
      if (pos.liquidationPrice) {
        const liqPrice = parseFloat(pos.liquidationPrice);
        if (!isNaN(liqPrice) && liqPrice > 0) {
          liqY = series.priceToCoordinate(liqPrice);
        }
      }

      newCoords[pos.id] = { entryY, liqY };
    });

    setPositionsY(newCoords);
  }, [positions]);

  // Update coordinates on position, initialization, or price tick changes
  useEffect(() => {
    updatePositionsCoordinates();
  }, [positions, chartInitialized, lastPrice, updatePositionsCoordinates]);

  // Update coordinates when zooming or scrolling the chart
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleScrollZoom = () => {
      updatePositionsCoordinates();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleScrollZoom);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleScrollZoom);
      } catch {
        // Safe check
      }
    };
  }, [chartInitialized, updatePositionsCoordinates]);

  // Countdown Timer
  useEffect(() => {
    if (data.length === 0) return;
    const intervalMap: Record<string, number> = {
      "1s": 1000,
      "1m": 60000,
      "3m": 180000,
      "5m": 300000,
      "15m": 900000,
      "30m": 1800000,
      "1h": 3600000,
      "2h": 7200000,
      "4h": 14400000,
      "6h": 21600000,
      "8h": 28800000,
      "12h": 43200000,
      "1d": 86400000,
    };
    const ms = intervalMap[interval] || 60000;
    
    const tick = () => {
      const lastOpen = data[data.length - 1].openTime;
      const nextOpen = lastOpen + ms;
      const remaining = Math.max(0, nextOpen - Date.now());
      
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      
      if (hours > 0) {
        setCountdownStr(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      } else {
        setCountdownStr(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    };

    tick(); // initial call
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [data, interval]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full h-full relative select-none"
      onMouseMove={handleContainerMouseMove}
      onMouseLeave={handleContainerMouseLeave}
    >
      {/* HUD Info Overlay */}
      {hudData && (
        <div className="absolute top-2 left-4 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-md border border-white/5 pointer-events-none">
          <span className="text-[#a1a1aa]">{hudData.time}</span>
          <span>
            <span className="text-[#71717a] mr-0.5">O</span>
            <span className={hudData.isGreen ? "text-j-up-bright" : "text-j-down-bright"}>{hudData.open}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">H</span>
            <span className={hudData.isGreen ? "text-j-up-bright" : "text-j-down-bright"}>{hudData.high}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">L</span>
            <span className={hudData.isGreen ? "text-j-up-bright" : "text-j-down-bright"}>{hudData.low}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">C</span>
            <span className={hudData.isGreen ? "text-j-up-bright" : "text-j-down-bright"}>{hudData.close}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">Chg</span>
            <span className={hudData.isGreen ? "text-j-up-bright" : "text-j-down-bright"}>{hudData.pct}</span>
          </span>
          <span className="hidden sm:inline">
            <span className="text-[#71717a] mr-0.5">Vol</span>
            <span className="text-[#f4f4f5]">{hudData.volume}</span>
          </span>
        </div>
      )}

      {/* Go-to-live button — appears when user scrolls into history */}
      {isScrolledBack && (
        <button
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          className="absolute bottom-8 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-[#f59e0b]/90 hover:bg-[#f59e0b] text-black shadow-lg transition-all animate-pulse"
          title="Go to current candle"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
            <path d="M2 5h6M6 3l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Live
        </button>
      )}

      {/* Countdown Timer Overlay */}
      {lastPriceY !== null && countdownStr && (
        <div
          className="absolute z-20 text-[10px] text-[#f59e0b] font-medium font-mono pointer-events-none transition-all duration-75"
          style={{
            top: `${lastPriceY + 14}px`, // perfectly positioned right below the price tag
            right: '4px',
            textShadow: '0px 0px 4px rgba(0,0,0,0.8), 1px 1px 0px black, -1px -1px 0px black',
          }}
        >
          {countdownStr}
        </div>
      )}
      {/* HTML Position Lines Left/Right Labels Overlay */}
      {chartInitialized && positions && positions.length > 0 && lastPrice > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {positions.map((pos) => {
            const coords = positionsY[pos.id];
            if (!coords) return null;

            const { entryY, liqY } = coords;
            if (entryY === null || entryY < 0) return null;

            const entry = parseFloat(pos.entryPrice);
            const size = parseFloat(pos.size);
            const lev = pos.leverage || 1;
            const isLong = pos.side === "long";

            const pnl = isLong ? (lastPrice - entry) * size : (entry - lastPrice) * size;
            const pnlPct = ((isLong ? (lastPrice - entry) : (entry - lastPrice)) / entry) * 100 * lev;
            const isProfit = pnl >= 0;
            const sign = isProfit ? "+" : "";

            const sizeStr = size.toFixed(4);

            return (
              <div key={pos.id}>
                {/* Entry Price Left Label (PnL Capsule) and Right Label (Details) */}
                <div
                  className="absolute left-0 right-0 h-0"
                  style={{
                    top: `${entryY}px`,
                  }}
                >
                  {/* Left Label: PnL Capsule (centered at 25% of chart width) */}
                  <span
                    className={cn(
                      "absolute px-2 py-0.5 rounded text-[10px] font-bold font-mono shadow-md border transition-all",
                      isProfit
                        ? "bg-j-up-bright/90 border-j-up-bright text-black"
                        : "bg-j-down-bright/90 border-j-down-bright text-white"
                    )}
                    style={{
                      left: "25%",
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    PnL: {sign}{pnl.toFixed(2)} USDT ({sign}{pnlPct.toFixed(2)}%)
                  </span>

                  {/* Right Label: Position details */}
                  <span
                    className="absolute px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-[#18181b]/90 border border-[#27272a] text-[#f4f4f5] shadow-md"
                    style={{
                      right: "68px",
                      transform: "translateY(-50%)",
                    }}
                  >
                    {isLong ? "LONG" : "SHORT"} {sizeStr} @ {entry.toFixed(2)}
                  </span>
                </div>

                {/* Liquidation Price Labels (Centered at 25% of chart width / Right details) */}
                {liqY !== null && liqY >= 0 && (
                  <div
                    className="absolute left-0 right-0 h-0"
                    style={{
                      top: `${liqY}px`,
                    }}
                  >
                    {/* Left Label: LIQ Indicator */}
                    <span
                      className="absolute px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#f59e0b]/90 border border-[#f59e0b] text-black shadow-md"
                      style={{
                        left: "25%",
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      LIQ
                    </span>

                    {/* Right Label: Liquidation price */}
                    <span
                      className="absolute px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-[#18181b]/90 border border-[#27272a] text-[#f59e0b] shadow-md"
                      style={{
                        right: "68px",
                        transform: "translateY(-50%)",
                      }}
                    >
                      LIQ @ {parseFloat(pos.liquidationPrice || "0").toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dynamic Cursor Price Alert Creator (+) Button */}
      {hoveredCrosshair && (
        <button
          onClick={() => {
            const roundedPrice = hoveredCrosshair.price;
            const operator = roundedPrice > lastPrice ? ">" : "<";

            const newRule = {
              id: Math.random().toString(36).substring(2, 9),
              symbol: symbol,
              type: "price",
              operator,
              value: roundedPrice,
              isActive: true,
            };

            const stored = localStorage.getItem("janus_alert_rules");
            const currentRules = stored ? JSON.parse(stored) : [];
            const updatedRules = [...currentRules, newRule];
            localStorage.setItem("janus_alert_rules", JSON.stringify(updatedRules));

            window.dispatchEvent(new Event("janus_alerts_changed"));
             toast.success(`Price alert created at $${formatPrice(roundedPrice, symbol)}!`);
          }}
          className="absolute z-30 w-[18px] h-[18px] bg-[#1c1c1f] hover:bg-[#f59e0b] text-[#e4e4e7] hover:text-black border border-[#3f3f46] rounded-full flex items-center justify-center cursor-pointer transition-all shadow-lg active:scale-95"
          style={{
            top: `${hoveredCrosshair.y}px`,
            right: "58px",
            transform: "translate(50%, -50%)",
          }}
          title={`Create Price Alert at $${formatPrice(hoveredCrosshair.price, symbol)}`}
        >
          <Plus size={8} strokeWidth={3} />
        </button>
      )}

      {/* Custom Alerts List Overlay */}
      {chartInitialized && alertRules.length > 0 && (
        <div className="absolute bottom-[38px] right-[68px] z-10 flex flex-col gap-1 max-h-[120px] overflow-y-auto bg-[#09090b]/80 backdrop-blur-md p-2 rounded border border-[#27272a] font-mono text-[9px] pointer-events-auto max-w-[200px] shadow-lg">
          <div className="text-[#71717a] font-bold mb-1 uppercase tracking-wider text-[8px]">Active Alert Lines</div>
          {alertRules
            .filter((rule) => rule.symbol === symbol && rule.type === "price")
            .map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 justify-between bg-white/5 px-2 py-1 rounded hover:bg-white/10 transition-colors">
                <span className="text-[#f59e0b] font-bold">
                  {rule.operator} ${rule.value.toFixed(2)}
                </span>
                <span className={cn("text-[7px] uppercase font-bold px-1 rounded-sm", rule.isActive ? "bg-j-up-bright/15 text-j-up-bright" : "bg-white/15 text-[#a1a1aa]")}>
                  {rule.isActive ? "ON" : "OFF"}
                </span>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="text-[#71717a] hover:text-j-down transition-colors pl-1 font-bold text-xs cursor-pointer"
                  title="Delete Alert"
                >
                  ✕
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Active Position Floating Capsule */}
      {positions && positions.length > 0 && lastPrice > 0 && (
        <div className="absolute top-11 right-[68px] z-10 flex flex-col gap-1.5 pointer-events-none">
          {positions.map((pos) => {
            const entry = parseFloat(pos.entryPrice);
            const size = parseFloat(pos.size);
            const lev = pos.leverage || 1;
            const isLong = pos.side === "long";
            const pnl = isLong ? (lastPrice - entry) * size : (entry - lastPrice) * size;
            const pnlPct = ((isLong ? (lastPrice - entry) : (entry - lastPrice)) / entry) * 100 * lev;
            const isProfit = pnl >= 0;

            return (
              <div
                key={pos.id}
                className="flex items-center gap-2.5 bg-black/75 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full shadow-lg text-[10px] font-mono select-none"
              >
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase",
                    isLong
                      ? "bg-j-up-bright/15 text-j-up-bright"
                      : "bg-j-down-bright/15 text-j-down-bright"
                  )}
                >
                  {isLong ? "Long" : "Short"} {size.toFixed(3)}
                </span>
                <span className="text-[#a1a1aa]">
                  Entry: <span className="text-[#f4f4f5]">{entry.toFixed(2)}</span>
                </span>
                <span className="text-[#52525b]">|</span>
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    isProfit ? "text-j-up-bright" : "text-j-down-bright"
                  )}
                >
                  {isProfit ? "+" : ""}
                  {pnl.toFixed(2)} USDT ({isProfit ? "+" : ""}
                  {pnlPct.toFixed(2)}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function aggregateOrderBook(levels: [string, string][], step: number, isBid: boolean): [string, string][] {
  const groups: Record<string, number> = {};
  for (const [pStr, qStr] of levels) {
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    if (isNaN(p) || isNaN(q)) continue;

    // Group price
    let groupedPrice: number;
    if (isBid) {
      groupedPrice = Math.floor(p / step) * step;
    } else {
      groupedPrice = Math.ceil(p / step) * step;
    }

    // Formatting key to avoid precision floating point issues
    const decimals = step < 1 ? Math.round(-Math.log10(step)) : 0;
    const key = groupedPrice.toFixed(decimals);
    groups[key] = (groups[key] || 0) + q;
  }

  return Object.entries(groups)
    .map(([p, q]) => [p, String(q)] as [string, string])
    .sort((a, b) => isBid ? parseFloat(b[0]) - parseFloat(a[0]) : parseFloat(a[0]) - parseFloat(b[0]));
}

// Helper to summarize events in the last 60 seconds
const getTapeSummary = (events: any[]) => {
  const cutoff = Date.now() - 60_000;
  const recent = events.filter((ev) => ev.timestamp >= cutoff);
  if (recent.length === 0) return null;

  const counts: Record<string, number> = {};
  let bullishScore = 0;
  let bearishScore = 0;

  recent.forEach((ev) => {
    const type = (ev.type || "").replace(/_/g, " ").toUpperCase();
    counts[type] = (counts[type] || 0) + 1;

    const msg = (ev.message || "").toUpperCase();
    if (
      type.includes("BUY ABSORPTION") || 
      type.includes("SELLER EXHAUSTION") || 
      msg.includes("BIDS ADDED") || 
      msg.includes("ASKS REMOVED") ||
      msg.includes("BULLISH TRAP")
    ) {
      bullishScore++;
    } else if (
      type.includes("SELL ABSORPTION") || 
      type.includes("BUYER EXHAUSTION") || 
      msg.includes("ASKS ADDED") || 
      msg.includes("BIDS REMOVED") ||
      msg.includes("BEARISH TRAP")
    ) {
      bearishScore++;
    }
  });

  const parts = Object.entries(counts).map(([type, count]) => `${count} ${type}`);
  let sentiment = "Neutral Balance";
  let sentimentColor = "text-[#a1a1aa]";
  if (bullishScore > bearishScore) {
    sentiment = "Bullish 📈";
    sentimentColor = "text-[#0ecb81]";
  } else if (bearishScore > bullishScore) {
    sentiment = "Bearish 📉";
    sentimentColor = "text-[#f6465d]";
  }

  return {
    text: `Last 60s: ${parts.join(", ")}.`,
    sentiment,
    sentimentColor,
  };
};
