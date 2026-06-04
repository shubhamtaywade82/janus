import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { ExitSignalToast } from "@/components/ExitSignalToast";
import { RegimeIndicator } from "@/components/RegimeIndicator";
import { RiskStatus } from "@/components/RiskStatus";
import { AutoTraderPanel } from "@/components/AutoTraderPanel";
import { LlmActivityFeed } from "@/components/LlmActivityFeed";
import {
  Clock,
  Plus,
  Minus,
  RefreshCw,
  Activity,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import type { UTCTimestamp, SeriesMarker, Time } from "lightweight-charts";
import { OrderBlockPrimitive } from "@/lib/chart/primitives/OrderBlockPrimitive";
import { FVGPrimitive } from "@/lib/chart/primitives/FVGPrimitive";
import { StructurePrimitive } from "@/lib/chart/primitives/StructurePrimitive";
import { VolumeProfilePrimitive } from "@/lib/chart/primitives/VolumeProfilePrimitive";
import { ChartOverlayPanel } from "@/components/ChartOverlayPanel";
import type { OverlayToggles } from "@/components/ChartOverlayPanel";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { AlertConfigPanel } from "@/components/AlertConfigPanel";
import type { AlertConfig } from "@/lib/chart/alert-engine";
import { checkIndicatorAlerts, checkSMCAlerts } from "@/lib/chart/alert-engine";
import type { IndicatorConfig } from "@/components/IndicatorPanel";
import { EMA_COLORS, SMA_COLORS } from "@/components/IndicatorPanel";
import { calcEMA, calcSMA, calcBB, calcSuperTrend, calcRSI, calcVWAP, calcCVD, calcNW, calcMACD, calcStochRSI, calcPSAR, calcIchimoku, calcADX, calcZScore, calcVolumeProfile, calcKeltner, calcDonchian, calcTTMSqueeze } from "@/lib/chart/indicators";
import { detectMACDSignals, detectADXSignals, detectDirectionFlips, detectStochCross, detectZScoreSignals, detectIchimokuSignals, detectDonchianBreakout, detectNWBandTag, detectVWAPSignals, detectRSIDivergence, detectCVDDivergence } from "@/lib/chart/indicator-signals";
import type { PriceActionData } from "@/lib/chart/pa-types";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { formatPrice, formatQty, getPriceDecimals } from "@/utils/precision";

// ─── Types ───
interface KlineData {
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
  if (value.startsWith("hsl") || value.startsWith("#") || value.startsWith("rgb")) {
    return value;
  }
  const formatted = value.includes(",") ? value : value.split(/\s+/).join(", ");
  return `hsl(${formatted})`;
};

// ─── TradingView Lightweight Chart Component ───
const MiniChart = ({ data, positions, lastPrice, symbol, interval, onLoadMore, overlayData, overlayToggles, indicatorCfg, bidPrice, askPrice }: {
  data: KlineData[]; positions: any[]; lastPrice: number; symbol: string; interval: string;
  onLoadMore?: (beforeTime: number) => void;
  overlayData?: PriceActionData | null;
  overlayToggles?: OverlayToggles;
  indicatorCfg?: IndicatorConfig | null;
  bidPrice?: number;
  askPrice?: number;
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hudData, setHudData] = useState<any>(null);
  const [chartInitialized, setChartInitialized] = useState(false);
  const [positionsY, setPositionsY] = useState<Record<number, { entryY: number | null; liqY: number | null }>>({});
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
  const obPrimRef   = useRef<OrderBlockPrimitive | null>(null);
  const fvgPrimRef  = useRef<FVGPrimitive | null>(null);
  const strPrimRef  = useRef<StructurePrimitive | null>(null);
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
  // TTM Squeeze histogram series
  const ttmSqHistRef = useRef<any>(null);
  // Dedicated indicator signal markers plugin (separate from SMC markers)
  const indicatorMarkersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  // ─── Price line overlay (smooth thin line tracking close price) ───
  const priceLineSeriesRef = useRef<any>(null);
  // ─── Volume MA line overlay ───
  const volumeMASeriesRef = useRef<any>(null);
  // Volume history buffer for computing running MA during animation
  const volumeHistoryRef = useRef<{ time: number; value: number }[]>([]);

  // ─── Tick animation: persistent lerp loop chasing target ───
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
          const o = parseFloat(last.open);
          const c = parseFloat(last.close);
          const pct = ((c - o) / o) * 100;
          setHudData({
            time: new Date(last.openTime).toLocaleString(),
            open: o.toFixed(2),
            high: parseFloat(last.high).toFixed(2),
            low: parseFloat(last.low).toFixed(2),
            close: c.toFixed(2),
            volume: parseFloat(last.volume).toFixed(2),
            pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
            isGreen: c >= o,
          });
        }
        return;
      }

      const candle = param.seriesData.get(candlestickSeries) as any;
      const volume = param.seriesData.get(volumeSeries) as any;

      if (candle) {
        const o = candle.open;
        const c = candle.close;
        const pct = ((c - o) / o) * 100;
        setHudData({
          time: new Date((param.time as number) * 1000).toLocaleString(),
          open: o.toFixed(2),
          high: candle.high.toFixed(2),
          low: candle.low.toFixed(2),
          close: c.toFixed(2),
          volume: volume ? volume.value.toFixed(2) : "0.00",
          pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
          isGreen: c >= o,
        });
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

    // Lazy load older candles when user scrolls to the left edge
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;

      // Save visible range (zoom level & scroll position) to localStorage
      try {
        localStorage.setItem("janus_chart_logical_range", JSON.stringify({
          from: range.from,
          to: range.to
        }));
      } catch (err) {}

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
      candlestickSeriesRef.current.attachPrimitive(obPrim);
      candlestickSeriesRef.current.attachPrimitive(fvgPrim);
      candlestickSeriesRef.current.attachPrimitive(strPrim);
      obPrimRef.current  = obPrim;
      fvgPrimRef.current = fvgPrim;
      strPrimRef.current = strPrim;
      // createSeriesMarkers replaces the old .setMarkers() — create lazily only when needed
      // to avoid interfering with auto-scroll and chart rendering pipeline
    } catch (err) {
      console.warn("[chart] SMC primitive attach failed:", err);
    }
    return () => {
      obPrimRef.current  = null;
      fvgPrimRef.current = null;
      strPrimRef.current = null;
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
    const o = parseFloat(last.open);
    const c = parseFloat(last.close);
    const pct = ((c - o) / o) * 100;
    setHudData({
      time: new Date(last.openTime).toLocaleString(),
      open: o.toFixed(2),
      high: parseFloat(last.high).toFixed(2),
      low: parseFloat(last.low).toFixed(2),
      close: c.toFixed(2),
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

    const pct = ((targetClose - o) / o) * 100;
    setHudData({
      time: new Date(last.openTime).toLocaleString(),
      open: o.toFixed(2),
      high: h.toFixed(2),
      low: l.toFixed(2),
      close: targetClose.toFixed(2),
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

    // Order Blocks
    obPrimRef.current.setBlocks(tog?.orderBlocks && pa?.orderBlocks ? pa.orderBlocks : []);

    // FVGs
    fvgPrimRef.current.setFVGs(tog?.fvg && pa?.fvgs ? pa.fvgs : []);

    // Structure + Liquidity
    strPrimRef.current.setData(
      tog?.structure  && pa?.structure  ? pa.structure  : [],
      tog?.liquidity  && pa?.liquidity  ? pa.liquidity  : []
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

      if (tog?.swings && pa?.swings) {
        for (const s of pa.swings) {
          markers.push({
            time:     (s.time / 1000) as Time,
            position: s.type === "high" ? "aboveBar" : "belowBar",
            shape:    "circle", // Use circle with size 0 to effectively hide the shape
            color:    s.type === "high" ? "#a1a1aa" : "#a1a1aa",
            size:     0.01,
            text:     s.label || "",
          });
        }
      }

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
      const { delta, cvd } = calcCVD(highs, lows, closes, volumes);
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
      addOrUpdate("psar-bull", bullSAR, "hsl(var(--janus-up))",   false, "right");
      addOrUpdate("psar-bear", bearSAR, "hsl(var(--janus-down))", false, "right");
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
      addOrUpdate("ichi-spanA", futureSpanA, "hsl(var(--janus-up)/0.60)",   true);
      addOrUpdate("ichi-spanB", futureSpanB, "hsl(var(--janus-down)/0.60)", true);
    } else {
      ["ichi-tenkan", "ichi-kijun", "ichi-chikou", "ichi-spanA", "ichi-spanB"].forEach(removeKey);
    }

    // ADX + DI lines — all on "adx" sub-pane
    // ADX=amber (trend strength 0-100), +DI=green, -DI=red
    if (indicatorCfg.adx) {
      const { adx, diPlus, diMinus } = calcADX(highs, lows, closes, indicatorCfg.adxPeriod);
      const adxScaleOpts = { scaleMargins: { top: 0.76, bottom: 0 }, borderVisible: false };
      addOrUpdate("adx-line",    adx,     "rgba(245,158,11,0.90)",  false, "adx");
      addOrUpdate("adx-diplus",  diPlus,  "hsl(var(--janus-up)/0.80)",   false, "adx");
      addOrUpdate("adx-diminus", diMinus, "hsl(var(--janus-down)/0.80)", false, "adx");
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
        const { cvd } = calcCVD(highs, lows, closes, volumes);
        signals.push(...detectCVDDivergence(closes, cvd, times));
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
    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    if (!chart || !series || !positions || positions.length === 0) {
      setPositionsY({});
      return;
    }

    const newCoords: Record<number, { entryY: number | null; liqY: number | null }> = {};
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
      } catch (err) {
        // Safe check
      }
    };
  }, [chartInitialized, updatePositionsCoordinates]);

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

// ─── Order Book Component ───
const OrderBook = ({ symbol, tickerData, markPrice }: { symbol: string; tickerData: any; markPrice?: number }) => {
  const [activeTab, setActiveTab] = useState<"book" | "telemetry">("book");
  const [depth, setDepth] = useState<any>(null);

  const decimals = getPriceDecimals(symbol);
  const defaultStep = parseFloat(Math.pow(10, -decimals).toFixed(decimals));
  const [priceStep, setPriceStep] = useState<number>(defaultStep);

  // Sync priceStep when symbol changes
  useEffect(() => {
    const dec = getPriceDecimals(symbol);
    setPriceStep(parseFloat(Math.pow(10, -dec).toFixed(dec)));
  }, [symbol]);

  // Generate selector options
  const aggregationOptions = useMemo(() => {
    const dec = getPriceDecimals(symbol);
    const options: number[] = [];
    let step = Math.pow(10, -dec);
    for (let i = 0; i < 5; i++) {
      options.push(parseFloat(step.toFixed(dec)));
      step *= 10;
    }
    return options;
  }, [symbol]);

  const { data: initialDepth } = trpc.market.orderBook.useQuery(
    { symbol, limit: 100 }, // Fetch more levels for quality aggregation
    { staleTime: Infinity }
  );

  const { data: liveState } = trpc.market.liveState.useQuery(
    { symbol },
    { refetchInterval: 1000, enabled: activeTab === "telemetry" }
  );

  const [liquidityEvents, setLiquidityEvents] = useState<any[]>([]);
  trpc.market.liquidityEventStream.useSubscription(
    { symbol },
    {
      onData: (event: any) => {
        setLiquidityEvents((prev) => [event, ...prev].slice(0, 50));
      },
    }
  );

  useEffect(() => {
    if (initialDepth) setDepth(initialDepth);
  }, [initialDepth, symbol]);

  const onDataRef = useRef((data: any) => setDepth(data));
  useEffect(() => {
    onDataRef.current = (data: any) => setDepth(data);
  }, []);

  const streamOpts = useRef({
    onData: (data: any) => onDataRef.current(data),
  });

  trpc.market.orderBookStream.useSubscription(
    { symbol },
    streamOpts.current
  );

  // Pair bids[i] with asks[i] side-by-side — both sorted best first
  const rawBids = (depth && Array.isArray(depth.bids) ? depth.bids : []) as [string, string][];
  const rawAsks = (depth && Array.isArray(depth.asks) ? depth.asks : []) as [string, string][];

  // Aggregate dynamically
  const bids = useMemo(() => {
    return aggregateOrderBook(rawBids, priceStep, true).slice(0, 6);
  }, [rawBids, priceStep]);

  const asks = useMemo(() => {
    return aggregateOrderBook(rawAsks, priceStep, false).slice(0, 6);
  }, [rawAsks, priceStep]);

  // Compute cumulative sums and total volumes
  const { bidsWithSum, asksWithSum, totalBidVolume, totalAskVolume } = useMemo(() => {
    let bidSum = 0;
    const bidsWithSum = bids.map(([p, q]) => {
      const size = parseFloat(q);
      bidSum += size;
      return { price: p, qty: size, sum: bidSum };
    });

    let askSum = 0;
    const asksWithSum = asks.map(([p, q]) => {
      const size = parseFloat(q);
      askSum += size;
      return { price: p, qty: size, sum: askSum };
    });

    return {
      bidsWithSum,
      asksWithSum,
      totalBidVolume: bidSum,
      totalAskVolume: askSum,
    };
  }, [bids, asks]);

  const maxBidSum = Math.max(totalBidVolume, 1);
  const maxAskSum = Math.max(totalAskVolume, 1);
  const maxBidSize = Math.max(...bids.map(([, q]) => parseFloat(q)), 1);
  const maxAskSize = Math.max(...asks.map(([, q]) => parseFloat(q)), 1);

  const spread = bids[0] && asks[0]
    ? parseFloat(asks[0][0]) - parseFloat(bids[0][0])
    : 0;
  const spreadPct = bids[0] ? (spread / parseFloat(bids[0][0])) * 100 : 0;

  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const isPriceUp = tickerData && parseFloat(tickerData.priceChange) >= 0;
  const lastPriceColor = isPriceUp ? "hsl(var(--janus-up-bright))" : "hsl(var(--janus-down-bright))";
  const directionSymbol = isPriceUp ? "▲" : "▼";

  const totalVol = totalBidVolume + totalAskVolume;
  const bidPct = totalVol > 0 ? (totalBidVolume / totalVol) * 100 : 50;
  const askPct = 100 - bidPct;

  return (
    <div className="flex flex-col h-full text-[10px]">
      {/* Price header: Futures + Mark */}
      <div className="px-3 py-2 border-b border-[#27272a]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[#71717a]">Order Book</span>
            <select
              value={priceStep}
              onChange={(e) => setPriceStep(parseFloat(e.target.value))}
              className="bg-[#18181b] border border-[#27272a] rounded px-1 py-0.5 text-[9px] text-[#f4f4f5] outline-none cursor-pointer focus:border-[#f59e0b] h-5"
            >
              {aggregationOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          {spread > 0 && (
            <span className="text-[#52525b]">Spread {formatPrice(spread, symbol)} ({spreadPct.toFixed(3)}%)</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[9px] text-[#71717a]">Futures</div>
            <div className="text-sm font-bold tabular-nums flex items-center gap-1" style={{ color: lastPriceColor }}>
              {lastPrice > 0 ? (
                <>
                  <span className="text-[10px]">{directionSymbol}</span>
                  <AnimatedNumber value={lastPrice} decimals={getPriceDecimals(symbol)} duration={150} />
                </>
              ) : "--"}
            </div>
          </div>
          {markPrice && (
            <div>
              <div className="text-[9px] text-[#71717a]">Mark</div>
              <div className="text-sm font-bold tabular-nums text-[#f59e0b]">
                {formatPrice(markPrice, symbol)}
              </div>
            </div>
          )}
          {tickerData && (
            <div className="ml-auto text-right">
              <div className="text-[9px] text-[#71717a]">24h Change</div>
              <div className="font-medium tabular-nums" style={{ color: lastPriceColor }}>
                {parseFloat(tickerData.priceChangePercent) >= 0 ? "+" : ""}
                {parseFloat(tickerData.priceChangePercent).toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex border-b border-[#27272a] text-[10px]">
        <button
          onClick={() => setActiveTab("book")}
          className={cn(
            "flex-1 py-1.5 text-center font-bold border-b-2 transition-all",
            activeTab === "book"
              ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
              : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
          )}
        >
          Depth Book
        </button>
        <button
          onClick={() => setActiveTab("telemetry")}
          className={cn(
            "flex-1 py-1.5 text-center font-bold border-b-2 transition-all flex items-center justify-center gap-1",
            activeTab === "telemetry"
              ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
              : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
          )}
        >
          <Activity size={10} className={cn(activeTab === "telemetry" && "text-[#f59e0b]")} />
          Flow Telemetry
        </button>
      </div>

      {activeTab === "book" ? (
        <>
          {/* Buy/Sell Pressure Imbalance Bar */}
          <div className="px-3 py-1 flex items-center justify-between text-[8px] font-bold text-[#52525b] bg-[#18181b]/20 border-b border-[#27272a]/30">
            <span className="text-j-up-bright">BIDS {bidPct.toFixed(0)}%</span>
            <div className="flex-1 mx-2 h-1 rounded overflow-hidden flex bg-zinc-800">
              <div className="bg-j-up-bright h-full transition-all duration-500" style={{ width: `${bidPct}%` }} />
              <div className="bg-j-down-bright h-full transition-all duration-500" style={{ width: `${askPct}%` }} />
            </div>
            <span className="text-j-down-bright">ASKS {askPct.toFixed(0)}%</span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-3 px-3 py-1 border-b border-[#27272a]/50 text-[9px] text-[#52525b]">
            <span>PRICE</span>
            <span className="text-right">QTY</span>
            <span className="text-right">TOTAL</span>
          </div>

          <div className="flex-1 flex flex-col justify-between overflow-hidden">
            {/* Asks (Top, highest at top, best ask at bottom) */}
            <div className="flex-1 overflow-hidden flex flex-col justify-end">
              {asksWithSum.slice().reverse().map((ask, i) => {
                const depthW = (ask.sum / maxAskSum) * 100;
                const volW = (ask.qty / maxAskSize) * 100;
                const priceDecForStep = priceStep < 1 ? Math.round(-Math.log10(priceStep)) : 0;
                return (
                  <div key={`ask-${i}`} className="relative grid grid-cols-3 items-center py-0.5 px-3 hover:bg-[#27272a]/30">
                    {/* Layer 1: Cumulative Depth Bar (fainter) */}
                    <div className="absolute inset-y-0 right-0 bg-j-down-bright/5 rounded-l transition-all duration-300" style={{ width: `${depthW}%` }} />
                    {/* Layer 2: Individual Volume Bar (brighter overlay) */}
                    <div className="absolute inset-y-0 right-0 bg-j-down-bright/15 rounded-l transition-all duration-300" style={{ width: `${volW}%`, marginRight: '2px' }} />
                    <span className="relative tabular-nums text-j-down-bright font-medium">
                      {formatPrice(ask.price, symbol, priceDecForStep)}
                    </span>
                    <span className="relative text-right tabular-nums text-zinc-300">
                      {ask.qty.toFixed(1)}
                    </span>
                    <span className="relative text-right tabular-nums text-zinc-500">
                      {ask.sum.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Mid-market price banner */}
            <div className="py-1 px-3 border-y border-[#27272a]/50 bg-[#18181b]/50 flex items-center justify-between font-bold">
              <span className="text-[11px] tabular-nums flex items-center gap-1" style={{ color: lastPriceColor }}>
                {lastPrice > 0 ? (
                  <>
                    <span className="text-[10px]">{directionSymbol}</span>
                    <AnimatedNumber value={lastPrice} decimals={getPriceDecimals(symbol)} duration={150} />
                  </>
                ) : "--"}
              </span>
              {spread > 0 && (
                <span className="text-[9px] text-[#71717a] font-normal">Spread {formatPrice(spread, symbol, priceStep < 1 ? Math.round(-Math.log10(priceStep)) : 0)} ({spreadPct.toFixed(2)}%)</span>
              )}
            </div>

            {/* Bids (Bottom, best bid at top, lowest price at bottom) */}
            <div className="flex-1 overflow-hidden">
              {bidsWithSum.map((bid, i) => {
                const depthW = (bid.sum / maxBidSum) * 100;
                const volW = (bid.qty / maxBidSize) * 100;
                const priceDecForStep = priceStep < 1 ? Math.round(-Math.log10(priceStep)) : 0;
                return (
                  <div key={`bid-${i}`} className="relative grid grid-cols-3 items-center py-0.5 px-3 hover:bg-[#27272a]/30">
                    {/* Layer 1: Cumulative Depth Bar (fainter) */}
                    <div className="absolute inset-y-0 right-0 bg-j-up-bright/5 rounded-l transition-all duration-300" style={{ width: `${depthW}%` }} />
                    {/* Layer 2: Individual Volume Bar (brighter overlay) */}
                    <div className="absolute inset-y-0 right-0 bg-j-up-bright/15 rounded-l transition-all duration-300" style={{ width: `${volW}%`, marginRight: '2px' }} />
                    <span className="relative tabular-nums text-j-up-bright font-medium">
                      {formatPrice(bid.price, symbol, priceDecForStep)}
                    </span>
                    <span className="relative text-right tabular-nums text-zinc-300">
                      {bid.qty.toFixed(1)}
                    </span>
                    <span className="relative text-right tabular-nums text-zinc-500">
                      {bid.sum.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden p-1.5 flex flex-col justify-between gap-1 bg-[#09090b]">
          {!liveState ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#71717a] py-8">
              <RefreshCw size={16} className="animate-spin text-[#f59e0b]" />
              <span>Loading telemetry...</span>
            </div>
          ) : (() => {
            const metrics = liveState.metrics;
            const netDelta = (metrics.liquidityAdded || 0) - (metrics.liquidityRemoved || 0);

            // Volatility regime styling
            const regime = metrics.volatilityRegime || "NORMAL";
            let regimeColor = "text-[#a1a1aa] border-[#27272a] bg-[#27272a]/10";
            if (regime === "HIGH") {
              regimeColor = "text-[#ef4444] border-[#ef4444]/50 bg-[#ef4444]/10 shadow-[inset_0_0_8px_rgba(239,68,68,0.15)]";
            } else if (regime === "LOW") {
              regimeColor = "text-[#3b82f6] border-[#3b82f6] bg-[#1e3a8a]/20 shadow-[inset_0_0_8px_rgba(59,130,246,0.15)]";
            }

            // Imbalance calculations (cap at -1 to +1)
            const imb = Math.max(-1, Math.min(1, metrics.bidAskImbalance || 0));
            // Position percentage (0 to 100)
            const imbPct = ((imb + 1) / 2) * 100;

            // Sweep and absorption levels
            const sweep = metrics.sweepScore || 0;
            const absorb = metrics.absorptionScore || 0;

            return (
              <>
                {/* Volatility & Net Delta Row */}
                <div className="grid grid-cols-2 gap-1">
                  <div className={cn("flex flex-col justify-center items-center py-1.5 px-2 rounded-md border text-center transition-all", regimeColor)}>
                    <span className="text-[7.5px] uppercase tracking-wider text-[#71717a] font-bold mb-0.5">Volatility Regime</span>
                    <span className="text-sm font-black tracking-widest">{regime}</span>
                  </div>
                  <div className="flex flex-col justify-center items-center py-1.5 px-2 rounded-md border border-[#27272a] bg-[#18181b]/30 text-center">
                    <span className="text-[7.5px] uppercase tracking-wider text-[#71717a] font-bold mb-0.5">Net Liquidity Delta</span>
                    <span className={cn("text-sm font-bold tabular-nums", netDelta >= 0 ? "text-j-up-bright" : "text-j-down-bright")}>
                      {netDelta >= 0 ? "+" : ""}{netDelta.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Imbalance scale */}
                <div className="p-1.5 rounded-md border border-[#27272a] bg-[#1c1c1f]/40 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[7.5px] uppercase text-[#71717a] font-bold">
                    <span>Seller Pressure</span>
                    <span className={cn("font-bold text-[8.5px] tabular-nums", imb >= 0 ? "text-j-up-bright" : "text-j-down-bright")}>
                      OFI: {imb >= 0 ? "+" : ""}{imb.toFixed(2)}
                    </span>
                    <span>Buyer Pressure</span>
                  </div>
                  <div className="relative h-1.5 rounded bg-gradient-to-r from-red-950 via-zinc-900 to-emerald-950 border border-[#27272a] overflow-hidden flex">
                    {/* Imbalance Marker */}
                    <div className="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_6px_#fff] transition-all duration-300" style={{ left: `${imbPct}%`, transform: 'translateX(-50%)' }} />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b] font-bold mt-0.5">
                    <span>100% ASKS</span>
                    <span>MID</span>
                    <span>100% BIDS</span>
                  </div>
                </div>

                {/* Sweep Indicator */}
                <div className="p-1.5 rounded-md border border-[#27272a] bg-[#1c1c1f]/40 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[7.5px] uppercase text-[#71717a] font-bold">
                    <span className="flex items-center gap-1">
                      <Zap size={8} className="text-[#ef4444]" />
                      Tape Sweep Intensity
                    </span>
                    <span className="font-bold tabular-nums text-[8.5px] text-[#ef4444]">
                      {sweep.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-[#27272a]/50 overflow-hidden border border-[#27272a]">
                    <div
                      className="h-full bg-[#ef4444] transition-all duration-500"
                      style={{ width: `${sweep}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b] font-bold mt-0.5">
                    <span>STABLE</span>
                    <span className="text-[#ef4444] font-bold uppercase">
                      Aggressive Breakout
                    </span>
                  </div>
                </div>

                {/* Absorption Indicator */}
                <div className="p-1.5 rounded-md border border-[#27272a] bg-[#1c1c1f]/40 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[7.5px] uppercase text-[#71717a] font-bold">
                    <span className="flex items-center gap-1">
                      {/* Custom grid/absorption icon */}
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#10b981]">
                        <rect x="3" y="3" width="6" height="6" />
                        <rect x="15" y="3" width="6" height="6" />
                        <rect x="15" y="15" width="6" height="6" />
                        <rect x="3" y="15" width="6" height="6" />
                      </svg>
                      Micro Limit Absorption
                    </span>
                    <span className="font-bold tabular-nums text-[8.5px] text-[#10b981]">
                      {absorb.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-[#27272a]/50 overflow-hidden border border-[#27272a]">
                    <div
                      className="h-full bg-[#10b981] transition-all duration-500"
                      style={{ width: `${absorb}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b] font-bold mt-0.5">
                    <span>NO WALL</span>
                    <span className="text-[#10b981] font-bold uppercase">
                      Heavy Block Absorption
                    </span>
                  </div>
                </div>

                {/* Liquidity Added & Removed Stats */}
                <div className="grid grid-cols-2 gap-1 text-[7.5px] text-[#71717a] font-bold">
                  <div className="p-1.5 rounded-md border border-[#27272a] bg-[#18181b]/30">
                    <div className="mb-0.5 uppercase text-[#71717a]">Liquidity Added</div>
                    <div className="text-[11px] text-j-up-bright font-bold tabular-nums">
                      +{(metrics.liquidityAdded || 0).toFixed(1)}
                    </div>
                  </div>
                  <div className="p-1.5 rounded-md border border-[#27272a] bg-[#18181b]/30">
                    <div className="mb-0.5 uppercase text-[#71717a]">Liquidity Removed</div>
                    <div className="text-[11px] text-j-down-bright font-bold tabular-nums">
                      -{(metrics.liquidityRemoved || 0).toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Liquidity Event Tape */}
                <div className="flex-1 mt-1 flex flex-col min-h-[60px] rounded-md border border-[#27272a] bg-[#09090b] overflow-hidden">
                  <div className="px-2 py-1 text-[8px] uppercase tracking-wider text-[#71717a] font-bold border-b border-[#27272a] bg-[#18181b]">
                    Live Event Tape
                  </div>
                  <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-0.5">
                    {liquidityEvents.length === 0 && (
                      <div className="text-center text-[#52525b] text-[9px] py-4">No recent events</div>
                    )}
                    {liquidityEvents.map((ev, i) => {
                      let color = "text-[#a1a1aa]";
                      let bg = "bg-[#27272a]/20";
                      if (ev.priority === "SSS") {
                        color = "text-[#f59e0b] font-bold";
                        bg = "bg-[#f59e0b]/10 border border-[#f59e0b]/30 shadow-[inset_0_0_4px_rgba(245,158,11,0.2)]";
                      } else if (ev.priority === "SS") {
                        color = "text-[#a855f7]";
                        bg = "bg-[#a855f7]/10";
                      } else if (ev.priority === "S") {
                        color = "text-[#3b82f6]";
                      }
                      return (
                        <div key={ev.id || i} className={cn("px-1.5 py-1 rounded text-[9px] flex justify-between items-center", bg)}>
                          <span className={cn("truncate mr-2 uppercase tracking-wide", color)}>{ev.type.replace(/_/g, " ")}</span>
                          <span className="text-[#52525b] whitespace-nowrap tabular-nums">{ev.message}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// ─── Recent Trades Component ───
const RecentTrades = ({ symbol }: { symbol: string }) => {
  const [trades, setTrades] = useState<any[]>([]);

  const { data: initialTrades } = trpc.market.recentTrades.useQuery(
    { symbol, limit: 20 },
    { staleTime: Infinity }
  );

  useEffect(() => {
    if (initialTrades) setTrades(initialTrades);
  }, [initialTrades, symbol]);

  const onDataRef = useRef((trade: any) => {
    setTrades((prev) => [trade, ...prev].slice(0, 20));
  });
  useEffect(() => {
    onDataRef.current = (trade: any) => {
      setTrades((prev) => [trade, ...prev].slice(0, 20));
    };
  }, []);

  const streamOpts = useRef({
    onData: (trade: any) => onDataRef.current(trade),
  });

  trpc.market.recentTradesStream.useSubscription(
    { symbol },
    streamOpts.current
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a]">
        <span className="text-xs text-[#71717a]">Recent Trades</span>
        <Clock size={12} className="text-[#71717a]" />
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {trades?.map((trade, i) => (
          <div
            key={`${trade.id}-${i}`}
            className="flex items-center justify-between px-3 py-1 text-xs"
          >
            <span
              className={cn(
                "tabular-nums",
                trade.isBuyerMaker ? "text-j-down" : "text-j-up"
              )}
            >
              {formatPrice(trade.price, symbol, (trade as any).basePrecision)}
            </span>
            <span className="text-[#71717a] tabular-nums">
              {formatQty(trade.qty, symbol, (trade as any).targetPrecision)}
            </span>
            <span className="text-[#52525b] text-[10px]">
              {new Date(trade.time).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helper Ticker Stream Subscriber Component ───
const TickerStreamSubscriber = ({
  symbol,
  onUpdate,
}: {
  symbol: string;
  onUpdate: (symbol: string, data: any) => void;
}) => {
  const onDataRef = useRef((data: any) => {
    onUpdate(symbol, data);
  });
  useEffect(() => {
    onDataRef.current = (data: any) => onUpdate(symbol, data);
  }, [onUpdate, symbol]);

  const opts = useRef({
    onData: (data: any) => onDataRef.current(data),
  });

  trpc.market.tickerStream.useSubscription({ symbol }, opts.current);
  return null;
};

// ─── Ticker Strip ───
const TickerStrip = ({
  activeSymbol,
  onSelectSymbol,
}: {
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}) => {
  const [tickersMap, setTickersMap] = useState<Record<string, any>>({});

  const { data: initialTickers } = trpc.market.ticker24h.useQuery(
    {},
    { staleTime: Infinity }
  );

  useEffect(() => {
    if (Array.isArray(initialTickers)) {
      const map: Record<string, any> = {};
      for (const t of initialTickers) {
        map[t.symbol] = t;
      }
      setTickersMap(map);
    }
  }, [initialTickers]);

  const supportedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

  const handleTickerUpdate = useCallback((symbol: string, data: any) => {
    setTickersMap((prev) => ({
      ...prev,
      [symbol]: data,
    }));
  }, []);

  const tickerList = supportedSymbols.map((s) => tickersMap[s]).filter(Boolean);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[#27272a] bg-[#09090b] overflow-x-auto scrollbar-thin">
      {supportedSymbols.map((symbol) => (
        <TickerStreamSubscriber key={symbol} symbol={symbol} onUpdate={handleTickerUpdate} />
      ))}
      {tickerList.map((t: any) => {
        const isActive = t.symbol === activeSymbol;
        return (
          <button
            key={t.symbol}
            onClick={() => onSelectSymbol(t.symbol)}
            className={cn(
              "flex items-center gap-2 flex-shrink-0 px-2 py-0.5 rounded transition-all hover:bg-[#27272a]/30 cursor-pointer outline-none border text-left",
              isActive ? "border-[#f59e0b] bg-[#f59e0b]/5" : "border-transparent"
            )}
          >
            <span className={cn("text-[10px] font-semibold", isActive ? "text-[#f59e0b]" : "text-[#71717a]")}>
              {t.symbol}
            </span>
            <span className="text-[10px] tabular-nums text-[#f4f4f5]">
              <AnimatedNumber value={parseFloat(t.lastPrice)} decimals={getPriceDecimals(t.symbol)} duration={150} />
            </span>
            <span
              className={cn(
                "text-[10px] tabular-nums",
                parseFloat(t.priceChangePercent) >= 0 ? "text-j-up" : "text-j-down"
              )}
            >
              {parseFloat(t.priceChangePercent) >= 0 ? "+" : ""}
              {parseFloat(t.priceChangePercent).toFixed(2)}%
            </span>
          </button>
        );
      })}
    </div>
  );
};

// ─── Main Dashboard ───
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

  useEffect(() => {
    setBestBid(null);
    setBestAsk(null);
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
  const [alertCfg, setAlertCfg] = useState<AlertConfig | null>(null);
  const prevPaDataRef = useRef<any>(null);
  const prevKlinesLenRef = useRef(0);

  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(() => {
    try {
      const saved = localStorage.getItem("janus_chart_overlays");
      return saved ? JSON.parse(saved) : { swings: true, orderBlocks: true, fvg: true, structure: true, liquidity: true, displacement: false, premiumDiscount: false, obv: false };
    } catch { return { swings: true, orderBlocks: true, fvg: true, structure: true, liquidity: true, displacement: false, premiumDiscount: false, obv: false }; }
  });

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
          return [...prev, kline].slice(-150);
        }
        return prev;
      });
    };
  }, [interval]);

  const klineStreamOpts = useRef({
    onData: (data: any) => klineCallbackRef.current(data),
  });

  trpc.market.klineStream.useSubscription(
    { symbol: selectedSymbol },
    klineStreamOpts.current
  );

  const tickerCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    tickerCallbackRef.current = (data: any) => {
      setTicker(data);
    };
  }, []);

  const tickerStreamOpts = useRef({
    onData: (data: any) => tickerCallbackRef.current(data),
  });

  trpc.market.tickerStream.useSubscription(
    { symbol: selectedSymbol },
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
    };
  }, []);

  const depthStreamOpts = useRef({
    onData: (data: any) => depthCallbackRef.current(data),
  });

  trpc.market.orderBookStream.useSubscription(
    { symbol: selectedSymbol },
    depthStreamOpts.current
  );

  // Fetch portfolio for open positions
  const [portfolio, setPortfolio] = useState<any>(null);
  const { data: initialPortfolio } = trpc.trading.portfolio.useQuery(
    { userId: 1 },
    { staleTime: Infinity }
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
    { userId: 1 },
    portfolioStreamOpts.current
  );

  const openPositions = portfolio?.positions || [];
  const symbolPositions = openPositions.filter(
    (p: any) => p.symbol === selectedSymbol && p.status === "open"
  );

  const { data: instrInfo } = trpc.trading.instrumentInfo.useQuery(
    { userId: 1, symbol: selectedSymbol },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );

  const { data: conversion } = trpc.trading.currencyConversion.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const usdtInrRate = conversion?.rate ?? 89.0;

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

  // ─── Alert engine — runs when new candle or new SMC data arrives ───
  const sendTelegramAlert = trpc.telegram.sendAlert.useMutation().mutate;

  useEffect(() => {
    if (!alertCfg || !indicatorCfg || klines.length < 3) return;
    const isNewCandle = klines.length !== prevKlinesLenRef.current;
    const isNewPaData = paData !== prevPaDataRef.current;
    if (!isNewCandle && !isNewPaData) return;

    const currentPrice = lastPrice || parseFloat(klines[klines.length - 1]?.close ?? "0");
    const allEvents: import("@/lib/chart/alert-engine").AlertEvent[] = [];

    if (isNewCandle) {
      allEvents.push(...checkIndicatorAlerts(klines as any[], alertCfg, indicatorCfg, selectedSymbol));
    }
    if (isNewPaData && paData && prevPaDataRef.current) {
      allEvents.push(...checkSMCAlerts(paData as any, prevPaDataRef.current, currentPrice, selectedSymbol, alertCfg));
    }

    for (const evt of allEvents) {
      toast(evt.message, {
        description: `${selectedSymbol} @ ${evt.price.toFixed(2)} — ${interval}`,
        duration: 8_000,
        style: { borderLeft: `3px solid ${evt.direction === "bullish" ? "hsl(var(--janus-up))" : evt.direction === "bearish" ? "hsl(var(--janus-down))" : "#f59e0b"}` },
      });
      try {
        sendTelegramAlert({ message: `${evt.emoji} <b>${selectedSymbol} ${interval}</b>\n${evt.message}\nPrice: <code>${evt.price.toFixed(4)}</code>` });
      } catch { /* Telegram may not be configured */ }
    }

    prevKlinesLenRef.current = klines.length;
    prevPaDataRef.current    = paData ?? prevPaDataRef.current;
  }, [klines.length, paData, alertCfg, indicatorCfg, selectedSymbol, interval, lastPrice, sendTelegramAlert]);

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
        userId: 1,
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
                lastPrice={lastPrice}
                symbol={selectedSymbol}
                interval={interval}
                onLoadMore={handleLoadMore}
                overlayData={paData ?? null}
                overlayToggles={overlayToggles}
                indicatorCfg={indicatorCfg}
                bidPrice={bestBid ?? undefined}
                askPrice={bestAsk ?? undefined}
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
              <OrderBook symbol={selectedSymbol} tickerData={tickerData} />
            </div>
            {/* Recent Trades */}
            <div className="h-64 border-t border-[#27272a] flex flex-col overflow-hidden bg-[#09090b]">
              <RecentTrades symbol={selectedSymbol} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
