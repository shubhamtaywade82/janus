import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";
import {
  ArrowUpDown,
  Clock,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from "lightweight-charts";
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
const MiniChart = ({ data }: { data: KlineData[] }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hudData, setHudData] = useState<any>(null);

  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const dataRef = useRef<KlineData[]>(data);

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

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // 2. Update Data when data props change (without destroying chart)
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0) return;

    // Format data
    const chartData = data.map((d) => {
      const time = (d.openTime / 1000) as UTCTimestamp;
      return {
        time,
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
      };
    });

    const volumeData = data.map((d) => {
      const time = (d.openTime / 1000) as UTCTimestamp;
      const open = parseFloat(d.open);
      const close = parseFloat(d.close);
      return {
        time,
        value: parseFloat(d.volume),
        color: close >= open ? "rgba(14, 203, 129, 0.15)" : "rgba(246, 70, 93, 0.15)",
      };
    });

    candlestickSeriesRef.current.setData(chartData);
    volumeSeriesRef.current.setData(volumeData);

    // Initial HUD data
    const last = data[data.length - 1];
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

    // Fit content on initial load only
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data]);

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
    </div>
  );
}

// ─── Order Book Component ───
const OrderBook = ({ symbol }: { symbol: string }) => {
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
    {
      onData(data) {
        setDepth(data);
      },
    }
  );

  const bids = (depth && "bids" in depth ? depth.bids.slice(0, 10).reverse() : []) as [string, string][];
  const asks = (depth && "asks" in depth ? depth.asks.slice(0, 10) : []) as [string, string][];

  const maxBidSize = Math.max(...bids.map(([, q]) => parseFloat(q)), 1);
  const maxAskSize = Math.max(...asks.map(([, q]) => parseFloat(q)), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a]">
        <span className="text-xs text-[#71717a]">Order Book</span>
        <ArrowUpDown size={12} className="text-[#71717a]" />
      </div>

      {/* Asks (Sells) - Red */}
      <div className="flex-1 overflow-hidden">
        {asks.map(([price, qty], i) => {
          const size = parseFloat(qty);
          const width = (size / maxAskSize) * 100;
          return (
            <div
              key={`ask-${i}`}
              className="flex items-center justify-between px-3 py-0.5 text-xs relative"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-[#ef4444]/10"
                style={{ width: `${width}%` }}
              />
              <span className="relative text-[#ef4444] tabular-nums">
                {parseFloat(price).toFixed(2)}
              </span>
              <span className="relative text-[#71717a] tabular-nums">
                {size.toFixed(4)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread */}
      {bids.length > 0 && asks.length > 0 && (
        <div className="flex items-center justify-center py-1 border-y border-[#27272a]">
          <span className="text-xs text-[#a1a1aa] tabular-nums">
            {(parseFloat(asks[0][0]) - parseFloat(bids[bids.length - 1][0])).toFixed(2)}
          </span>
        </div>
      )}

      {/* Bids (Buys) - Green */}
      <div className="flex-1 overflow-hidden">
        {bids.map(([price, qty], i) => {
          const size = parseFloat(qty);
          const width = (size / maxBidSize) * 100;
          return (
            <div
              key={`bid-${i}`}
              className="flex items-center justify-between px-3 py-0.5 text-xs relative"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-[#22c55e]/10"
                style={{ width: `${width}%` }}
              />
              <span className="relative text-[#22c55e] tabular-nums">
                {parseFloat(price).toFixed(2)}
              </span>
              <span className="relative text-[#71717a] tabular-nums">
                {size.toFixed(4)}
              </span>
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
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [leverage, setLeverage] = useState(1);
  const [orderSize, setOrderSize] = useState("");

  const [klines, setKlines] = useState<KlineData[]>([]);
  const [ticker, setTicker] = useState<any>(null);

  const { data: initialKlines } = trpc.market.klines.useQuery(
    { symbol: selectedSymbol, interval, limit: 150 },
    { staleTime: Infinity }
  );

  const { data: initialTicker } = trpc.market.ticker24h.useQuery(
    { symbol: selectedSymbol },
    { staleTime: Infinity }
  );

  useEffect(() => {
    if (initialKlines) setKlines(initialKlines);
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

  const createPosition = trpc.trading.createPosition.useMutation();
  const utils = trpc.useUtils();

  const tickerData = ticker && !Array.isArray(ticker) && !("error" in ticker) ? ticker : null;
  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const priceChange = tickerData ? parseFloat(tickerData.priceChangePercent) : 0;

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
        onSuccess: () => {
          utils.trading.positions.invalidate();
          utils.trading.portfolio.invalidate();
          setOrderSize("");
        },
      }
    );
  }, [orderSize, lastPrice, side, leverage, selectedSymbol, createPosition, utils]);

  const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const leverages = [1, 2, 5, 10, 20, 50, 100];

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
              <MiniChart data={klines as KlineData[]} />
            ) : (
              <div className="flex items-center justify-center h-full text-[#71717a] text-sm">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading market data...
              </div>
            )}
          </div>

          {/* Bottom Section - Order Book + Trades */}
          <div className="h-64 flex border-t border-[#27272a]">
            <div className="flex-1 border-r border-[#27272a]">
              <OrderBook symbol={selectedSymbol} />
            </div>
            <div className="w-56">
              <RecentTrades symbol={selectedSymbol} />
            </div>
          </div>
        </div>

        {/* Right Panel - Trading */}
        <div className="w-72 flex-shrink-0 border-l border-[#27272a] bg-[#09090b] flex flex-col">
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

          {/* Leverage */}
          <div className="px-3 py-2 border-b border-[#27272a]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[#71717a]">Leverage</span>
              <span className="text-xs text-[#22c55e] font-medium">{leverage}x</span>
            </div>
            <div className="flex gap-1">
              {leverages.map((l) => (
                <button
                  key={l}
                  onClick={() => setLeverage(l)}
                  className={cn(
                    "flex-1 py-1 rounded text-[9px] transition-colors",
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
              <span className="text-[10px] text-[#71717a]">Size ({selectedSymbol.replace("USDT", "")})</span>
              <span className="text-[10px] text-[#71717a]">
                @ {lastPrice.toFixed(2)}
              </span>
            </div>
            <input
              type="number"
              value={orderSize}
              onChange={(e) => setOrderSize(e.target.value)}
              placeholder="0.00"
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#22c55e] tabular-nums"
            />
            <div className="flex gap-1 mt-1">
              {["25%", "50%", "75%", "Max"].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setOrderSize(String((0.1 * parseInt(pct)) / 100))}
                  className="flex-1 py-0.5 rounded text-[9px] bg-[#18181b] text-[#71717a] border border-[#27272a] hover:text-[#f4f4f5] transition-colors"
                >
                  {pct}
                </button>
              ))}
            </div>
          </div>

          {/* Order Summary */}
          <div className="px-3 py-2 border-b border-[#27272a]">
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-[#71717a]">Margin Required</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {orderSize && lastPrice
                  ? ((parseFloat(orderSize) * lastPrice) / leverage).toFixed(2)
                  : "0.00"} USDT
              </span>
            </div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-[#71717a]">Est. Fee (0.05%)</span>
              <span className="text-[#71717a] tabular-nums">
                {orderSize && lastPrice
                  ? (parseFloat(orderSize) * lastPrice * 0.0005).toFixed(4)
                  : "0.0000"} USDT
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Total</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {orderSize && lastPrice
                  ? (parseFloat(orderSize) * lastPrice).toFixed(2)
                  : "0.00"} USDT
              </span>
            </div>
          </div>

          {/* Place Order Button */}
          <div className="px-3 py-3 mt-auto">
            <button
              onClick={handlePlaceOrder}
              disabled={!orderSize || createPosition.isPending}
              className={cn(
                "w-full py-2.5 rounded-lg text-xs font-semibold transition-all",
                side === "buy"
                  ? "bg-[#22c55e] hover:bg-[#16a34a] text-white"
                  : "bg-[#ef4444] hover:bg-[#dc2626] text-white",
                (!orderSize || createPosition.isPending) && "opacity-50 cursor-not-allowed"
              )}
            >
              {createPosition.isPending ? (
                <RefreshCw size={14} className="inline animate-spin mr-1" />
              ) : (
                <>{side === "buy" ? <Plus size={14} className="inline mr-1" /> : <Minus size={14} className="inline mr-1" />}</>
              )}
              {side === "buy" ? "Buy / Long" : "Sell / Short"} {selectedSymbol}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
