import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import {
  ArrowUpDown,
  Clock,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineStyle } from "lightweight-charts";
import type { UTCTimestamp } from "lightweight-charts";

// ─── Types ───
interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ─── TradingView Lightweight Chart Component ───
const MiniChart = ({ data, positions, lastPrice }: { data: KlineData[]; positions: any[]; lastPrice: number }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hudData, setHudData] = useState<any>(null);
  const [chartInitialized, setChartInitialized] = useState(false);
  const [positionsY, setPositionsY] = useState<Record<number, { entryY: number | null; liqY: number | null }>>({});
  const priceLinesRef = useRef<any[]>([]);

  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const dataRef = useRef<KlineData[]>(data);
  const prevLastTimeRef = useRef<number | null>(null);
  const prevDataLenRef = useRef<number>(0);

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

  // Keep dataRef updated
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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
      },
      rightPriceScale: {
        borderColor: "rgba(39, 39, 42, 0.25)",
      },
      width: container.clientWidth,
      height: container.clientHeight || 450,
    });
    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
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

    setChartInitialized(true);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      setChartInitialized(false);
    };
  }, []);

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
      }));
      const volumeData = data.map((d) => {
        const o = parseFloat(d.open);
        const c = parseFloat(d.close);
        return {
          time: (d.openTime / 1000) as UTCTimestamp,
          value: parseFloat(d.volume),
          color: c >= o ? "rgba(14, 203, 129, 0.15)" : "rgba(246, 70, 93, 0.15)",
        };
      });
      candlestickSeriesRef.current.setData(chartData);
      volumeSeriesRef.current.setData(volumeData);
      if (chartRef.current) chartRef.current.timeScale().fitContent();
      // Reset animation state on full reload
      animCurrent.current.close = 0;
      animLoopRunning.current = false;
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    }

    prevDataLenRef.current = data.length;
    prevLastTimeRef.current = lastTime;

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
  }, [data]);

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
        const color = isLong ? "#0ecb81" : "#f6465d";

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
    <div ref={chartContainerRef} className="w-full h-full relative select-none">
      {/* HUD Info Overlay */}
      {hudData && (
        <div className="absolute top-2 left-4 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-md border border-white/5 pointer-events-none">
          <span className="text-[#a1a1aa]">{hudData.time}</span>
          <span>
            <span className="text-[#71717a] mr-0.5">O</span>
            <span className={hudData.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{hudData.open}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">H</span>
            <span className={hudData.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{hudData.high}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">L</span>
            <span className={hudData.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{hudData.low}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">C</span>
            <span className={hudData.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{hudData.close}</span>
          </span>
          <span>
            <span className="text-[#71717a] mr-0.5">Chg</span>
            <span className={hudData.isGreen ? "text-[#0ecb81]" : "text-[#f6465d]"}>{hudData.pct}</span>
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
                        ? "bg-[#0ecb81]/90 border-[#0ecb81] text-black"
                        : "bg-[#f6465d]/90 border-[#f6465d] text-white"
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
                      right: "8px",
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
                        right: "8px",
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

      {/* Active Position Floating Capsule */}
      {positions && positions.length > 0 && lastPrice > 0 && (
        <div className="absolute top-2 right-4 z-10 flex flex-col gap-1.5 pointer-events-none">
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
                      ? "bg-[#0ecb81]/15 text-[#0ecb81]"
                      : "bg-[#f6465d]/15 text-[#f6465d]"
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
                    isProfit ? "text-[#0ecb81]" : "text-[#f6465d]"
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
  const [depth, setDepth] = useState<any>(null);

  const { data: initialDepth } = trpc.market.orderBook.useQuery(
    { symbol, limit: 20 },
    { staleTime: Infinity }
  );

  useEffect(() => {
    if (initialDepth) setDepth(initialDepth);
  }, [initialDepth, symbol]);

  trpc.market.orderBookStream.useSubscription(
    { symbol },
    { onData: (data) => setDepth(data) }
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
  const lastPriceColor = tickerData && parseFloat(tickerData.priceChange) >= 0 ? "#0ecb81" : "#f6465d";

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
              {lastPrice > 0 ? lastPrice.toFixed(2) : "--"}
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
          // mid price for this row — use bid price if available, else ask
          const rowPrice = bid ? parseFloat(bid[0]) : ask ? parseFloat(ask[0]) : 0;
          void rowPrice;

          return (
            <div key={i} className="grid grid-cols-3 items-center py-0.5 px-2 hover:bg-[#27272a]/30">
              {/* Bid qty + bar */}
              <div className="relative flex items-center justify-start">
                <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/15 rounded-l" style={{ width: `${bidW}%` }} />
                <span className="relative tabular-nums text-[#0ecb81]">
                  {bid ? bidSize.toFixed(3) : ""}
                </span>
              </div>

              {/* Price */}
              <div className="text-center tabular-nums">
                {bid ? (
                  <span className="text-[#0ecb81] font-medium">{parseFloat(bid[0]).toFixed(2)}</span>
                ) : ask ? (
                  <span className="text-[#f6465d] font-medium">{parseFloat(ask[0]).toFixed(2)}</span>
                ) : ""}
              </div>

              {/* Ask qty + bar */}
              <div className="relative flex items-center justify-end">
                <div className="absolute inset-y-0 left-0 bg-[#f6465d]/15 rounded-r" style={{ width: `${askW}%` }} />
                <span className="relative tabular-nums text-[#f6465d]">
                  {ask ? askSize.toFixed(3) : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
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

  trpc.market.recentTradesStream.useSubscription(
    { symbol },
    {
      onData(trade) {
        setTrades((prev) => [trade, ...prev].slice(0, 20));
      },
    }
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
                trade.isBuyerMaker ? "text-[#ef4444]" : "text-[#22c55e]"
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

  for (const symbol of supportedSymbols) {
    trpc.market.tickerStream.useSubscription(
      { symbol },
      {
        onData(data) {
          setTickersMap((prev) => ({
            ...prev,
            [symbol]: data,
          }));
        },
      }
    );
  }

  const tickerList = supportedSymbols.map((s) => tickersMap[s]).filter(Boolean);

  return (
    <div className="flex items-center gap-6 px-4 py-1.5 border-b border-[#27272a] bg-[#09090b] overflow-x-auto scrollbar-thin">
      {tickerList.map((t: any) => (
        <div key={t.symbol} className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-[#71717a] font-medium">{t.symbol}</span>
          <span className="text-[10px] tabular-nums text-[#f4f4f5]">
            {parseFloat(t.lastPrice).toFixed(2)}
          </span>
          <span
            className={cn(
              "text-[10px] tabular-nums",
              parseFloat(t.priceChangePercent) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
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

  const { data: initialKlines } = trpc.market.klines.useQuery(
    { symbol: selectedSymbol, interval, limit: 150 },
    {
      staleTime: interval === "1m" ? Infinity : 0,
      refetchInterval: interval === "1m" ? false : 30_000,
    }
  );

  const { data: initialTicker } = trpc.market.ticker24h.useQuery(
    { symbol: selectedSymbol },
    { staleTime: Infinity }
  );

  useEffect(() => {
    if (initialKlines) {
      // Reset chart update tracking refs on symbol/interval change
      setKlines(initialKlines);
    }
  }, [initialKlines, selectedSymbol, interval]);

  useEffect(() => {
    if (initialTicker && !Array.isArray(initialTicker)) {
      setTicker(initialTicker);
    }
  }, [initialTicker, selectedSymbol]);

  trpc.market.klineStream.useSubscription(
    { symbol: selectedSymbol },
    {
      onData(data: any) {
        // Stream is hardcoded 1m — only patch chart on 1m interval
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
      },
    }
  );

  trpc.market.tickerStream.useSubscription(
    { symbol: selectedSymbol },
    {
      onData(data) {
        setTicker(data);
      },
    }
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

  trpc.trading.portfolioStream.useSubscription(
    { userId: 1 },
    {
      onData: (data: any) => {
        setPortfolio(data);
      },
    }
  );

  const openPositions = portfolio?.positions || [];
  const symbolPositions = openPositions.filter(
    (p: any) => p.symbol === selectedSymbol && p.status === "open"
  );

  const { data: instrInfo } = trpc.trading.instrumentInfo.useQuery(
    { userId: 1, symbol: selectedSymbol },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );

  // Sync leverage to current position leverage when instrument changes
  useEffect(() => {
    if (instrInfo?.currentLeverage) setLeverage(instrInfo.currentLeverage);
  }, [instrInfo?.currentLeverage]);

  const createPosition = trpc.trading.createPosition.useMutation();
  const utils = trpc.useUtils();

  const tickerData = ticker && !Array.isArray(ticker) && !("error" in ticker) ? ticker : null;
  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const priceChange = tickerData ? parseFloat(tickerData.priceChangePercent) : 0;

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
  }, [orderSize, lastPrice, side, leverage, selectedSymbol, createPosition, utils]);

  const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];

  return (
    <div className="flex flex-col h-full">
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
                    priceChange >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  )}
                >
                  {lastPrice.toFixed(2)}
                </span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    priceChange >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
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
                        ? "bg-[#22c55e]/10 text-[#22c55e]"
                        : "text-[#71717a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {int}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
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
              <MiniChart data={klines as KlineData[]} positions={symbolPositions} lastPrice={lastPrice} />
            ) : (
              <div className="flex items-center justify-center h-full text-[#71717a] text-sm">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading market data...
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
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none focus:border-[#22c55e]"
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

          {/* Buy/Sell Tabs */}
          <div className="flex border-b border-[#27272a]">
            <button
              onClick={() => setSide("buy")}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors",
                side === "buy"
                  ? "bg-[#22c55e]/10 text-[#22c55e] border-b-2 border-[#22c55e]"
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
                  ? "bg-[#ef4444]/10 text-[#ef4444] border-b-2 border-[#ef4444]"
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

          {/* Leverage */}
          <div className="px-3 py-2 border-b border-[#27272a]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[#71717a]">
                Leverage
                <span className="text-[#52525b] ml-1">(max {maxLeverage}x)</span>
              </span>
              <span className="text-xs text-[#22c55e] font-medium">{leverage}x</span>
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
                      ? "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30"
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
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#22c55e] tabular-nums"
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
              const margin = leverage > 0 ? notional / leverage : 0;
              const fee = notional * 0.0005;
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
                    <span className="text-[#71717a]">Est. Fee (0.05%)</span>
                    <span className="text-[#71717a] tabular-nums">
                      {fee > 0 ? fee.toFixed(4) : "--"} {marginCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[#71717a]">Notional</span>
                    <span className="text-[#f4f4f5] tabular-nums">
                      {notional > 0 ? `$${notional.toFixed(2)}` : "--"}
                    </span>
                  </div>
                  {belowMin && (
                    <div className="text-[9px] text-[#ef4444] mt-1">
                      Min qty {minQty} · min notional ${minNotional}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Place Order Button */}
          <div className="px-3 py-3">
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
                      ? "bg-[#22c55e] hover:bg-[#16a34a] text-white"
                      : "bg-[#ef4444] hover:bg-[#dc2626] text-white",
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

          {/* Order Book */}
          <div className="flex-1 min-h-0 border-t border-[#27272a] overflow-hidden flex flex-col">
            <OrderBook symbol={selectedSymbol} tickerData={tickerData} />
          </div>

          {/* Recent Trades */}
          <div className="h-48 border-t border-[#27272a] overflow-hidden flex flex-col">
            <RecentTrades symbol={selectedSymbol} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
