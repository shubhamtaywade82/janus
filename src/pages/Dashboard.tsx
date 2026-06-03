import { useState, useEffect, useCallback, useRef } from "react";
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
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import type { UTCTimestamp, SeriesMarker, Time } from "lightweight-charts";
import { OrderBlockPrimitive } from "@/lib/chart/primitives/OrderBlockPrimitive";
import { FVGPrimitive } from "@/lib/chart/primitives/FVGPrimitive";
import { StructurePrimitive } from "@/lib/chart/primitives/StructurePrimitive";
import { ChartOverlayPanel } from "@/components/ChartOverlayPanel";
import type { OverlayToggles } from "@/components/ChartOverlayPanel";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { AlertConfigPanel } from "@/components/AlertConfigPanel";
import type { AlertConfig } from "@/lib/chart/alert-engine";
import { checkIndicatorAlerts, checkSMCAlerts } from "@/lib/chart/alert-engine";
import type { IndicatorConfig } from "@/components/IndicatorPanel";
import { EMA_COLORS, SMA_COLORS } from "@/components/IndicatorPanel";
import { calcEMA, calcSMA, calcBB, calcSuperTrend, calcRSI, calcVWAP, calcCVD } from "@/lib/chart/indicators";
import type { PriceActionData } from "@/lib/chart/pa-types";
import { AnimatedNumber } from "@/components/AnimatedNumber";

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
const MiniChart = ({ data, positions, lastPrice, symbol, interval, onLoadMore, overlayData, overlayToggles, indicatorCfg }: {
  data: KlineData[]; positions: any[]; lastPrice: number; symbol: string; interval: string;
  onLoadMore?: (beforeTime: number) => void;
  overlayData?: PriceActionData | null;
  overlayToggles?: OverlayToggles;
  indicatorCfg?: IndicatorConfig | null;
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hudData, setHudData] = useState<any>(null);
  const [chartInitialized, setChartInitialized] = useState(false);
  const [positionsY, setPositionsY] = useState<Record<number, { entryY: number | null; liqY: number | null }>>({});
  const priceLinesRef = useRef<any[]>([]);

  const [alertRules, setAlertRules] = useState<any[]>([]);
  const customAlertLinesRef = useRef<any[]>([]);
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
        price: parseFloat(price.toFixed(2)),
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
  const rsiPriceLinesRef = useRef<any[]>([]);
  // CVD histogram series ref (per-bar delta; line goes through indicatorSeriesRef)
  const cvdHistRef = useRef<any>(null);

  // ─── Tick animation: persistent lerp loop chasing target ───
  const animFrameRef = useRef<number | null>(null);
  const animTarget = useRef({ time: 0, open: 0, high: 0, low: 0, close: 0, vol: 0 });
  const animCurrent = useRef({ close: 0 });
  const animLoopRunning = useRef(false);

  const startAnimLoop = useCallback(() => {
    if (animLoopRunning.current) return;
    animLoopRunning.current = true;
    const LERP = 0.09; // per-frame factor (~60fps → smooth ~250ms settle)
    const loop = () => {
      if (!candlestickSeriesRef.current) { animLoopRunning.current = false; return; }
      const t = animTarget.current;
      const diff = t.close - animCurrent.current.close;
      if (Math.abs(diff) < 0.0005) {
        animCurrent.current.close = t.close;
        animLoopRunning.current = false;
        candlestickSeriesRef.current.update({ time: t.time as UTCTimestamp, open: t.open, high: t.high, low: t.low, close: t.close });
        return;
      }
      animCurrent.current.close += diff * LERP;
      const c = animCurrent.current.close;
      candlestickSeriesRef.current.update({
        time: t.time as UTCTimestamp,
        open: t.open,
        high: Math.max(t.high, c),
        low: Math.min(t.low, c),
        close: c,
      });
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
      if (animCurrent.current.close === 0) animCurrent.current.close = targetClose;

      // Update target — the lerp loop will smoothly chase it
      animTarget.current = { time: lastTime, open: o, high: h, low: l, close: targetClose, vol };

      // Volume update is immediate
      volumeSeriesRef.current.update({
        time: lastTime as UTCTimestamp,
        value: vol,
        color: targetClose >= o ? "rgba(14,203,129,0.15)" : "rgba(246,70,93,0.15)",
      });

      // Kick off the lerp loop (no-op if already running)
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

      const isSymbolOrIntervalChange = prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval;
      if (chartRef.current && isSymbolOrIntervalChange) {
        chartRef.current.timeScale().fitContent();
        chartRef.current.timeScale().scrollToPosition(8, false);
      }
      // Reset animation state on full reload
      animCurrent.current.close = 0;
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

  // 3. Live Price tick updates for non-1m timeframes using lastPrice prop
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0 || interval === "1m" || lastPrice <= 0) return;

    const last = data[data.length - 1];
    const lastTime = last.openTime / 1000;
    const o = parseFloat(last.open);
    const targetClose = lastPrice;
    const h = Math.max(parseFloat(last.high), targetClose);
    const l = Math.min(parseFloat(last.low), targetClose);
    const vol = parseFloat(last.volume);

    if (animCurrent.current.close === 0) animCurrent.current.close = targetClose;

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
            shape:    s.type === "high" ? "arrowDown" : "arrowUp",
            color:    s.type === "high" ? "#71717a" : "#71717a",
            size:     0.6,
            text:     "",
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

    // Bollinger Bands
    if (indicatorCfg.bb) {
      const { upper, middle, lower } = calcBB(closes, indicatorCfg.bbPeriod, indicatorCfg.bbMult);
      addOrUpdate("bb-upper",  upper,  "rgba(6,182,212,0.70)");
      addOrUpdate("bb-middle", middle, "rgba(6,182,212,0.40)", true);
      addOrUpdate("bb-lower",  lower,  "rgba(6,182,212,0.70)");
    } else {
      ["bb-upper", "bb-middle", "bb-lower"].forEach(removeKey);
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

  }, [indicatorCfg, data, interval]);

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
            toast.success(`Price alert created at $${roundedPrice.toFixed(2)}!`);
          }}
          className="absolute z-30 w-5 h-5 bg-[#1c1c1f] hover:bg-[#f59e0b] text-[#e4e4e7] hover:text-black border border-[#3f3f46] rounded-full flex items-center justify-center cursor-pointer transition-all shadow-lg active:scale-95"
          style={{
            top: `${hoveredCrosshair.y}px`,
            right: "55px",
            transform: "translate(50%, -50%)",
          }}
          title={`Create Price Alert at $${hoveredCrosshair.price.toFixed(2)}`}
        >
          <Plus size={10} strokeWidth={3} />
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

// ─── Order Book Component ───
const OrderBook = ({ symbol, tickerData, markPrice }: { symbol: string; tickerData: any; markPrice?: number }) => {
  const [activeTab, setActiveTab] = useState<"book" | "telemetry">("book");
  const [depth, setDepth] = useState<any>(null);

  const { data: initialDepth } = trpc.market.orderBook.useQuery(
    { symbol, limit: 20 },
    { staleTime: Infinity }
  );

  const { data: liveState } = trpc.market.liveState.useQuery(
    { symbol },
    { refetchInterval: 1000, enabled: activeTab === "telemetry" }
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
  const rawBids = (depth && Array.isArray(depth.bids) ? depth.bids.slice(0, 10) : []) as [string, string][];
  const rawAsks = (depth && Array.isArray(depth.asks) ? depth.asks.slice(0, 10) : []) as [string, string][];

  const maxBidSize = Math.max(...rawBids.map(([, q]) => parseFloat(q)), 1);
  const maxAskSize = Math.max(...rawAsks.map(([, q]) => parseFloat(q)), 1);

  const spread = rawBids[0] && rawAsks[0]
    ? parseFloat(rawAsks[0][0]) - parseFloat(rawBids[0][0])
    : 0;
  const spreadPct = rawBids[0] ? (spread / parseFloat(rawBids[0][0])) * 100 : 0;

  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const lastPriceColor = tickerData && parseFloat(tickerData.priceChange) >= 0 ? "hsl(var(--janus-up-bright))" : "hsl(var(--janus-down-bright))";

  return (
    <div className="flex flex-col h-full text-[10px]">
      {/* Price header: Futures + Mark */}
      <div className="px-3 py-2 border-b border-[#27272a]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[#71717a]">Order Book</span>
          {spread > 0 && (
            <span className="text-[#52525b]">Spread {spread.toFixed(2)} ({spreadPct.toFixed(3)}%)</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[9px] text-[#71717a]">Futures</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: lastPriceColor }}>
              {lastPrice > 0 ? <AnimatedNumber value={lastPrice} decimals={2} duration={150} /> : "--"}
            </div>
          </div>
          {markPrice && (
            <div>
              <div className="text-[9px] text-[#71717a]">Mark</div>
              <div className="text-sm font-bold tabular-nums text-[#f59e0b]">
                {markPrice.toFixed(2)}
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
          {/* Column headers */}
          <div className="grid grid-cols-3 px-2 py-1 border-b border-[#27272a]/50 text-[9px] text-[#52525b]">
            <span>BID QTY</span>
            <span className="text-center">PRICE</span>
            <span className="text-right">ASK QTY</span>
          </div>

          {/* Rows: bid | price | ask */}
          <div className="flex-1 overflow-auto scrollbar-thin">
            {Array.from({ length: Math.max(rawBids.length, rawAsks.length) }).map((_, i) => {
              const bid = rawBids[i];
              const ask = rawAsks[i];
              const bidSize = bid ? parseFloat(bid[1]) : 0;
              const askSize = ask ? parseFloat(ask[1]) : 0;
              const bidW = bid ? (bidSize / maxBidSize) * 100 : 0;
              const askW = ask ? (askSize / maxAskSize) * 100 : 0;

              return (
                <div key={i} className="grid grid-cols-3 items-center py-0.5 px-2 hover:bg-[#27272a]/30">
                  {/* Bid qty + bar */}
                  <div className="relative flex items-center justify-start">
                    <div className="absolute inset-y-0 right-0 bg-j-up-bright/15 rounded-l" style={{ width: `${bidW}%` }} />
                    <span className="relative tabular-nums text-j-up-bright">
                      {bid ? bidSize.toFixed(3) : ""}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="text-center tabular-nums">
                    {bid ? (
                      <span className="text-j-up-bright font-medium">{parseFloat(bid[0]).toFixed(2)}</span>
                    ) : ask ? (
                      <span className="text-j-down-bright font-medium">{parseFloat(ask[0]).toFixed(2)}</span>
                    ) : ""}
                  </div>

                  {/* Ask qty + bar */}
                  <div className="relative flex items-center justify-end">
                    <div className="absolute inset-y-0 left-0 bg-j-down-bright/15 rounded-r" style={{ width: `${askW}%` }} />
                    <span className="relative tabular-nums text-j-down-bright">
                      {ask ? askSize.toFixed(3) : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto p-3 flex flex-col gap-3.5 scrollbar-thin">
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
            const regimeColor = regime === "HIGH" ? "text-j-down border-j-down" : regime === "LOW" ? "text-[#3b82f6] border-[#3b82f6]" : "text-[#a1a1aa] border-[#27272a]";
            const regimeBg = regime === "HIGH" ? "bg-j-down/10 animate-pulse" : regime === "LOW" ? "bg-[#3b82f6]/10" : "bg-[#27272a]/20";

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
                <div className="grid grid-cols-2 gap-2">
                  <div className={cn("flex flex-col gap-1 p-2 rounded border text-center transition-all", regimeColor, regimeBg)}>
                    <span className="text-[8px] uppercase tracking-wider text-[#71717a] font-medium">Volatility Regime</span>
                    <span className="text-xs font-black tracking-widest">{regime}</span>
                  </div>
                  <div className="flex flex-col gap-1 p-2 rounded border border-[#27272a] bg-[#27272a]/10 text-center">
                    <span className="text-[8px] uppercase tracking-wider text-[#71717a] font-medium">Net Liquidity Delta</span>
                    <span className={cn("text-xs font-bold tabular-nums", netDelta >= 0 ? "text-j-up-bright" : "text-j-down-bright")}>
                      {netDelta >= 0 ? "+" : ""}{netDelta.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Imbalance scale */}
                <div className="p-2.5 rounded border border-[#27272a] bg-[#1c1c1f]/40">
                  <div className="flex justify-between items-center mb-1 text-[8px] uppercase text-[#71717a] font-semibold">
                    <span>Seller Pressure</span>
                    <span className={cn("font-bold text-[9px] tabular-nums", imb >= 0 ? "text-j-up-bright" : "text-j-down-bright")}>
                      OFI: {imb >= 0 ? "+" : ""}{imb.toFixed(2)}
                    </span>
                    <span>Buyer Pressure</span>
                  </div>
                  <div className="relative h-2 rounded bg-[#27272a]/40 overflow-hidden mb-1 flex">
                    <div className="h-full bg-j-down-bright/40" style={{ width: "50%" }} />
                    <div className="h-full bg-j-up-bright/40" style={{ width: "50%" }} />
                    {/* Imbalance Marker */}
                    <div className="absolute top-0 bottom-0 w-1 bg-[#ffffff] shadow-[0_0_4px_rgba(255,255,255,0.8)] transition-all duration-300" style={{ left: `${imbPct}%`, transform: 'translateX(-50%)' }} />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b]">
                    <span>100% ASKS</span>
                    <span>MID</span>
                    <span>100% BIDS</span>
                  </div>
                </div>

                {/* Sweep Indicator */}
                <div className="p-2.5 rounded border border-[#27272a] bg-[#1c1c1f]/40 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[8px] uppercase text-[#71717a] font-semibold">
                    <span className="flex items-center gap-1">
                      <Zap size={9} className={cn(sweep > 50 ? "text-j-down animate-bounce" : "text-[#52525b]")} />
                      Tape Sweep Intensity
                    </span>
                    <span className={cn("font-bold tabular-nums text-[9px]", sweep > 75 ? "text-j-down" : sweep > 40 ? "text-[#f59e0b]" : "text-[#e4e4e7]")}>
                      {sweep.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#27272a]/50 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        sweep > 75 ? "bg-j-down" : sweep > 40 ? "bg-[#f59e0b]" : "bg-[#3b82f6]"
                      )}
                      style={{ width: `${sweep}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b]">
                    <span>STABLE</span>
                    <span className={cn(sweep > 50 && "text-j-down font-bold")}>
                      {sweep > 75 ? "AGGRESSIVE BREAKOUT" : sweep > 40 ? "PRESSURE SWEEP" : "ORDER FLOW CALM"}
                    </span>
                  </div>
                </div>

                {/* Absorption Indicator */}
                <div className="p-2.5 rounded border border-[#27272a] bg-[#1c1c1f]/40 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[8px] uppercase text-[#71717a] font-semibold">
                    <span className="flex items-center gap-1">
                      <Sparkles size={9} className={cn(absorb > 50 ? "text-j-up-bright" : "text-[#52525b]")} />
                      Micro Limit Absorption
                    </span>
                    <span className={cn("font-bold tabular-nums text-[9px]", absorb > 75 ? "text-j-up-bright" : absorb > 40 ? "text-[#f59e0b]" : "text-[#e4e4e7]")}>
                      {absorb.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#27272a]/50 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        absorb > 75 ? "bg-j-up-bright" : absorb > 40 ? "bg-[#8b5cf6]" : "bg-[#71717a]"
                      )}
                      style={{ width: `${absorb}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[7px] text-[#52525b]">
                    <span>NO WALL</span>
                    <span className={cn(absorb > 50 && "text-j-up-bright font-bold")}>
                      {absorb > 75 ? "HEAVY BLOCK ABSORPTION" : absorb > 40 ? "WALL RESISTING" : "TAPING DIRECTLY"}
                    </span>
                  </div>
                </div>

                {/* Liquidity Added & Removed Stats */}
                <div className="grid grid-cols-2 gap-2 text-[8px] text-[#71717a] font-semibold mt-1">
                  <div className="p-2 rounded border border-[#27272a]/50 bg-[#27272a]/5">
                    <div className="mb-0.5 uppercase">Liquidity Added</div>
                    <div className="text-[10px] text-j-up-bright font-bold tabular-nums">
                      +{(metrics.liquidityAdded || 0).toFixed(1)}
                    </div>
                  </div>
                  <div className="p-2 rounded border border-[#27272a]/50 bg-[#27272a]/5">
                    <div className="mb-0.5 uppercase">Liquidity Removed</div>
                    <div className="text-[10px] text-j-down-bright font-bold tabular-nums">
                      -{(metrics.liquidityRemoved || 0).toFixed(1)}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

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
              {parseFloat(trade.price).toFixed(2)}
            </span>
            <span className="text-[#71717a] tabular-nums">
              {parseFloat(trade.qty).toFixed(4)}
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
const TickerStrip = () => {
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
    <div className="flex items-center gap-6 px-4 py-1.5 border-b border-[#27272a] bg-[#09090b] overflow-x-auto scrollbar-thin">
      {supportedSymbols.map((symbol) => (
        <TickerStreamSubscriber key={symbol} symbol={symbol} onUpdate={handleTickerUpdate} />
      ))}
      {tickerList.map((t: any) => (
        <div key={t.symbol} className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-[#71717a] font-medium">{t.symbol}</span>
          <span className="text-[10px] tabular-nums text-[#f4f4f5]">
            <AnimatedNumber value={parseFloat(t.lastPrice)} decimals={2} duration={150} />
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
        </div>
      ))}
    </div>
  );
}

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
      <TickerStrip />

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
                  <AnimatedNumber value={lastPrice} decimals={2} duration={150} />
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
