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

// ─── Types ───
interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ─── Mini Chart Component (Canvas) ───
function MiniChart({ data, width = 800, height = 400 }: { data: KlineData[]; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Calculate bounds
    const prices = data.flatMap((d) => [parseFloat(d.high), parseFloat(d.low)]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    const padding = { top: 20, right: 80, bottom: 30, left: 10 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const candleW = Math.max(2, (chartW / data.length) * 0.7);
    const gap = chartW / data.length;

    // Draw grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Draw candles
    data.forEach((k, i) => {
      const x = padding.left + i * gap + gap / 2;
      const open = parseFloat(k.open);
      const high = parseFloat(k.high);
      const low = parseFloat(k.low);
      const close = parseFloat(k.close);

      const yHigh = padding.top + ((maxPrice - high) / priceRange) * chartH;
      const yLow = padding.top + ((maxPrice - low) / priceRange) * chartH;
      const yOpen = padding.top + ((maxPrice - open) / priceRange) * chartH;
      const yClose = padding.top + ((maxPrice - close) / priceRange) * chartH;

      const isGreen = close >= open;
      ctx.fillStyle = isGreen ? "#22c55e" : "#ef4444";
      ctx.strokeStyle = isGreen ? "#22c55e" : "#ef4444";

      // Wick
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    });

    // Draw price labels on right
    ctx.fillStyle = "#71717a";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i < 5; i++) {
      const price = minPrice + (priceRange / 4) * (4 - i);
      const y = padding.top + (chartH / 4) * i;
      ctx.fillText(price.toFixed(2), width - padding.right + 5, y + 3);
    }

    // Draw volume bars at bottom
    const maxVol = Math.max(...data.map((d) => parseFloat(d.volume)));
    const volH = 40;
    data.forEach((k, i) => {
      const x = padding.left + i * gap + gap / 2;
      const vol = parseFloat(k.volume);
      const vh = (vol / maxVol) * volH;
      const close = parseFloat(k.close);
      const open = parseFloat(k.open);
      ctx.fillStyle = close >= open ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)";
      ctx.fillRect(x - candleW / 2, height - vh - 5, candleW, vh);
    });
  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="w-full"
    />
  );
}

// ─── Order Book Component ───
function OrderBook({ symbol }: { symbol: string }) {
  const { data: depth } = trpc.market.orderBook.useQuery(
    { symbol, limit: 20 },
    { refetchInterval: 2000 }
  );

  const bids = depth && "bids" in depth ? depth.bids.slice(0, 10).reverse() : [];
  const asks = depth && "asks" in depth ? depth.asks.slice(0, 10) : [];

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
function RecentTrades({ symbol }: { symbol: string }) {
  const { data: trades } = trpc.market.recentTrades.useQuery(
    { symbol, limit: 20 },
    { refetchInterval: 3000 }
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
function TickerStrip() {
  const { data: tickers } = trpc.market.ticker24h.useQuery(
    {},
    { refetchInterval: 5000 }
  );

  const tickerList = Array.isArray(tickers) ? tickers.slice(0, 8) : [];

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
export default function Dashboard() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [leverage, setLeverage] = useState(1);
  const [orderSize, setOrderSize] = useState("");

  const { data: klines } = trpc.market.klines.useQuery(
    { symbol: selectedSymbol, interval, limit: 150 },
    { refetchInterval: 5000 }
  );

  const { data: ticker } = trpc.market.ticker24h.useQuery(
    { symbol: selectedSymbol },
    { refetchInterval: 3000 }
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
}
