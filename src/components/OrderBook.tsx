import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./AnimatedNumber";
import { formatPrice, getPriceDecimals } from "@/utils/precision";

interface OrderBookProps {
  symbol: string;
  tickerData: any;
  markPrice?: number;
  liquidityEvents: any[];
  onLiquidityEvent: (event: any) => void;
}

export const OrderBook = ({ symbol, tickerData, markPrice, liquidityEvents, onLiquidityEvent }: OrderBookProps) => {
  const [activeTab, setActiveTab] = useState<"book" | "telemetry">("book");
  const [depth, setDepth] = useState<any>(null);
  const [visualMode, setVisualMode] = useState<"vol" | "depth">("vol");

  const decimals = getPriceDecimals(symbol);
  const defaultStep = parseFloat(Math.pow(10, -decimals).toFixed(decimals));
  const [priceStep, setPriceStep] = useState<number>(defaultStep);

  useEffect(() => {
    const dec = getPriceDecimals(symbol);
    setPriceStep(parseFloat(Math.pow(10, -dec).toFixed(dec)));
  }, [symbol]);

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

  const { data: initialDepth } = trpc.market.orderBook.useQuery({ symbol, limit: 100 }, { staleTime: Infinity });
  const { data: liveState } = trpc.market.liveState.useQuery({ symbol }, { refetchInterval: 1000, enabled: activeTab === "telemetry" });

  const depthInput = useMemo(() => ({ symbol }), [symbol]);
  const onLiquidityEventRef = useRef(onLiquidityEvent);
  useEffect(() => { onLiquidityEventRef.current = onLiquidityEvent; }, [onLiquidityEvent]);

  trpc.market.liquidityEventStream.useSubscription(depthInput, { onData: (event: any) => onLiquidityEventRef.current(event) });

  useEffect(() => { if (initialDepth) setDepth(initialDepth); }, [initialDepth, symbol]);
  trpc.market.orderBookStream.useSubscription(depthInput, { onData: (data: any) => setDepth(data) });

  const rawBids = (depth?.bids || []) as [string, string][];
  const rawAsks = (depth?.asks || []) as [string, string][];

  const bids = useMemo(() => aggregateOrderBook(rawBids, priceStep, true).slice(0, 20), [rawBids, priceStep]);
  const asks = useMemo(() => aggregateOrderBook(rawAsks, priceStep, false).slice(0, 20), [rawAsks, priceStep]);

  const { bidsWithSum, asksWithSum, totalBidVolume, totalAskVolume, maxQty } = useMemo(() => {
    let bSum = 0, aSum = 0;
    let maxQ = 0;
    const bWS = bids.map(([p, q]) => {
      const s = parseFloat(q);
      bSum += s;
      if (s > maxQ) maxQ = s;
      return { price: p, qty: s, sum: bSum };
    });
    const aWS = asks.map(([p, q]) => {
      const s = parseFloat(q);
      aSum += s;
      if (s > maxQ) maxQ = s;
      return { price: p, qty: s, sum: aSum };
    });
    return { bidsWithSum: bWS, asksWithSum: aWS, totalBidVolume: bSum, totalAskVolume: aSum, maxQty: maxQ || 1 };
  }, [bids, asks]);

  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const isPriceUp = tickerData && parseFloat(tickerData.priceChange) >= 0;
  const lastPriceColor = isPriceUp ? "hsl(var(--janus-up-bright))" : "hsl(var(--janus-down-bright))";
  const totalVol = totalBidVolume + totalAskVolume;
  const bidPct = totalVol > 0 ? (totalBidVolume / totalVol) * 100 : 50;

  const getEventForPrice = (priceStr: string, _isBid: boolean) => {
    const price = parseFloat(priceStr);
    if (isNaN(price)) return null;

    const activeEvents = liquidityEvents.filter(ev => {
      if (ev.symbol !== symbol) return false;
      if (Date.now() - ev.timestamp > 120000) return false; // 2 minutes active window

      // Check void ranges
      if (ev.type === "LIQUIDITY_VOID") {
        const range = ev.data?.range;
        if (range && price >= range.low && price <= range.high) return true;
      }

      // Extract price level
      let eventPrice = ev.data?.level;
      if (eventPrice === undefined) {
        const match = ev.message.match(/\$(\d+\.?\d*)/);
        if (match) eventPrice = parseFloat(match[1]);
      }

      if (eventPrice !== undefined) {
        return Math.abs(price - eventPrice) < priceStep * 0.99;
      }

      return false;
    });

    if (activeEvents.length === 0) return null;
    return activeEvents.sort((a, b) => b.timestamp - a.timestamp)[0];
  };

  const getEventLabel = (ev: any): string => {
    if (!ev) return "";
    const type = ev.type;
    if (type === "BS_LIQUIDITY_CREATED" || type === "SS_LIQUIDITY_CREATED") return "pool";
    if (type === "LIQUIDITY_STACK") return "stack";
    if (type === "LIQUIDITY_VOID") return "void";
    if (type === "LIQUIDITY_PULL") return "pull";
    if (type === "LIQUIDITY_FILL") return "fill";
    if (type === "LIQUIDITY_RUN") return "run";
    if (type === "INDUCEMENT") return "trap";
    if (type === "RESTING_LIQ_ADDED") return "+liq";
    if (type === "RESTING_LIQ_REMOVED") return "-liq";
    if (type === "VALUE_AREA_ACCEPTANCE") return "vaa";
    if (type === "VALUE_AREA_REJECTION") return "var";
    if (type.includes("EXHAUSTION")) return "exh";
    return type.toLowerCase().replace(/_/g, " ").slice(0, 5);
  };

  const latestEvent = useMemo(() => {
    const active = liquidityEvents.filter(ev => ev.symbol === symbol && Date.now() - ev.timestamp < 60000);
    if (active.length === 0) return null;
    return active.sort((a, b) => b.timestamp - a.timestamp)[0];
  }, [liquidityEvents, symbol]);

  return (
    <div className="flex flex-col h-full text-[10px]">
      <div className="px-3 py-2 border-b border-[#27272a]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[#71717a]">Order Book</span>
            <select value={priceStep} onChange={(e) => setPriceStep(parseFloat(e.target.value))} className="bg-[#18181b] border border-[#27272a] rounded px-1 py-0.5 text-[9px] text-[#f4f4f5] h-5">
              {aggregationOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            {activeTab === "book" && (
              <div className="flex items-center bg-[#18181b] border border-[#27272a]/80 rounded p-0.5 h-5 ml-1 select-none">
                <button
                  onClick={() => setVisualMode("vol")}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[8px] font-mono lowercase tracking-wider h-full flex items-center justify-center transition-all",
                    visualMode === "vol" ? "bg-[#27272a] text-[#f4f4f5]" : "text-[#71717a] hover:text-[#a1a1aa]"
                  )}
                >
                  vol
                </button>
                <button
                  onClick={() => setVisualMode("depth")}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[8px] font-mono lowercase tracking-wider h-full flex items-center justify-center transition-all",
                    visualMode === "depth" ? "bg-[#27272a] text-[#f4f4f5]" : "text-[#71717a] hover:text-[#a1a1aa]"
                  )}
                >
                  depth
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div><div className="text-[9px] text-[#71717a]">Futures</div><div className="text-sm font-bold tabular-nums" style={{ color: lastPriceColor }}>{lastPrice > 0 ? <AnimatedNumber value={lastPrice} decimals={getPriceDecimals(symbol)} duration={150} /> : "--"}</div></div>
          {markPrice && <div><div className="text-[9px] text-[#71717a]">Mark</div><div className="text-sm font-bold tabular-nums text-[#f59e0b]">{formatPrice(markPrice, symbol)}</div></div>}
        </div>
      </div>

      <div className="flex border-b border-[#27272a]">
        <button onClick={() => setActiveTab("book")} className={cn("flex-1 py-1.5 font-bold border-b-2", activeTab === "book" ? "text-[#f4f4f5] border-[#f59e0b]" : "text-[#71717a] border-transparent")}>Depth Book</button>
        <button onClick={() => setActiveTab("telemetry")} className={cn("flex-1 py-1.5 font-bold border-b-2 flex items-center justify-center gap-1", activeTab === "telemetry" ? "text-[#f4f4f5] border-[#f59e0b]" : "text-[#71717a] border-transparent")}><Activity size={10} /> Flow Telemetry</button>
      </div>

      {activeTab === "book" ? (
        <>
          <div className="px-3 py-1 flex items-center justify-between text-[8px] font-bold bg-[#18181b]/20 border-b border-[#27272a]/30">
            <span className="text-j-up-bright">BIDS {bidPct.toFixed(0)}%</span>
            <div className="flex-1 mx-2 h-1 rounded overflow-hidden flex bg-zinc-800">
              <div className="bg-j-up-bright h-full" style={{ width: `${bidPct}%` }} /><div className="bg-j-down-bright h-full" style={{ width: `${100 - bidPct}%` }} />
            </div>
            <span className="text-j-down-bright">ASKS {(100-bidPct).toFixed(0)}%</span>
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Main side-by-side headers */}
            <div className="grid grid-cols-2 border-b border-[#27272a]/30 bg-[#18181b]/20 py-1.5 font-mono text-[9px] select-none lowercase tracking-wider font-bold">
              <div className="text-j-up-bright border-r border-[#27272a] text-center">
                bid
              </div>
              <div className="text-j-down-bright text-center">
                ask
              </div>
            </div>

            {/* Sub-headers */}
            <div className="grid grid-cols-2 border-b border-[#27272a]/20 bg-[#18181b]/10 py-0.5 text-center select-none text-[8px] text-[#71717a] font-mono lowercase tracking-wider">
              <div className="grid grid-cols-2 px-3 border-r border-[#27272a]">
                <span className="text-left font-semibold">amt</span>
                <span className="text-right font-semibold">price</span>
              </div>
              <div className="grid grid-cols-2 px-3">
                <span className="text-left font-semibold">price</span>
                <span className="text-right font-semibold">amt</span>
              </div>
            </div>

            {/* Side-by-side rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#27272a]/5">
              {Array.from({ length: Math.max(bidsWithSum.length, asksWithSum.length) }).map((_, i) => {
                return (() => {
                  const bid = bidsWithSum[i];
                  const ask = asksWithSum[i];
                  const bidEvent = bid ? getEventForPrice(bid.price, true) : null;
                  const askEvent = ask ? getEventForPrice(ask.price, false) : null;
                  return (
                    <div key={i} className="grid grid-cols-2 hover:bg-[#27272a]/20 transition-colors py-0.5 text-[9px]">
                      {/* Bids side (Amt Price) */}
                      <div className="relative grid grid-cols-2 px-3 border-r border-[#27272a]">
                        {bid && (
                          <>
                            <div
                              className="absolute inset-y-0 right-0 bg-j-up-bright pointer-events-none transition-all duration-300"
                              style={{
                                width: `${
                                  visualMode === "vol"
                                    ? (bid.qty / maxQty) * 100
                                    : totalBidVolume > 0
                                    ? (bid.sum / totalBidVolume) * 100
                                    : 0
                                }%`,
                                opacity: 0.04 + (visualMode === "vol" ? (bid.qty / maxQty) : (bid.sum / totalBidVolume)) * 0.26
                              }}
                            />
                            <span className="relative text-left font-mono text-zinc-300 flex items-center gap-1">
                              {bid.qty.toFixed(1)}
                              {bidEvent && (
                                <span className={cn(
                                  "px-1 py-0.2 rounded-[3px] text-[6px] font-sans font-black uppercase tracking-wide leading-none",
                                  bidEvent.type.includes("LIQUIDITY_CREATED") || bidEvent.type.includes("POOL")
                                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse"
                                    : bidEvent.type.includes("REMOVED") || bidEvent.type.includes("PULL")
                                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                )}>
                                  {getEventLabel(bidEvent)}
                                </span>
                              )}
                            </span>
                            <span className="relative text-right font-mono text-j-up-bright font-medium">{formatPrice(bid.price, symbol)}</span>
                          </>
                        )}
                      </div>

                      {/* Asks side (Price Amt) */}
                      <div className="relative grid grid-cols-2 px-3">
                        {ask && (
                          <>
                            <div
                              className="absolute inset-y-0 left-0 bg-j-down-bright pointer-events-none transition-all duration-300"
                              style={{
                                width: `${
                                  visualMode === "vol"
                                    ? (ask.qty / maxQty) * 100
                                    : totalAskVolume > 0
                                    ? (ask.sum / totalAskVolume) * 100
                                    : 0
                                }%`,
                                opacity: 0.04 + (visualMode === "vol" ? (ask.qty / maxQty) : (ask.sum / totalAskVolume)) * 0.26
                              }}
                            />
                            <span className="relative text-left font-mono text-j-down-bright font-medium">{formatPrice(ask.price, symbol)}</span>
                            <span className="relative text-right font-mono text-zinc-300 flex items-center justify-end gap-1">
                              {askEvent && (
                                <span className={cn(
                                  "px-1 py-0.2 rounded-[3px] text-[6px] font-sans font-black uppercase tracking-wide leading-none",
                                  askEvent.type.includes("LIQUIDITY_CREATED") || askEvent.type.includes("POOL")
                                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse"
                                    : askEvent.type.includes("REMOVED") || askEvent.type.includes("PULL")
                                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                )}>
                                  {getEventLabel(askEvent)}
                                </span>
                              )}
                              {ask.qty.toFixed(1)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })();
              })}
            </div>

            {/* Bottom event banner */}
            {latestEvent && (
              <div className="px-3 py-1 border-t border-white/[0.06] bg-[#18181b]/60 flex items-center justify-between select-none">
                <span className="text-[7px] text-[#71717a] uppercase tracking-wider font-mono font-bold">feed alert</span>
                <span className={cn(
                  "text-[8px] font-sans font-bold flex items-center gap-1.5 animate-pulse",
                  latestEvent.priority === "SSS" ? "text-amber-500" : "text-zinc-300"
                )}>
                  {latestEvent.message}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto p-1.5 space-y-1 bg-[#09090b]">
           {liveState ? (
             <div className="space-y-2">
               <div className="grid grid-cols-2 gap-1">
                 <div className="p-2 border border-[#27272a] rounded bg-[#18181b]/30 text-center">
                   <div className="text-[7px] text-[#71717a] uppercase">Regime</div>
                   <div className="text-sm font-black">{liveState.metrics.volatilityRegime}</div>
                 </div>
                 <div className="p-2 border border-[#27272a] rounded bg-[#18181b]/30 text-center">
                   <div className="text-[7px] text-[#71717a] uppercase">Net Delta</div>
                   <div className={cn("text-sm font-bold", (liveState.metrics.liquidityAdded - liveState.metrics.liquidityRemoved) >= 0 ? "text-j-up-bright" : "text-j-down-bright")}>{(liveState.metrics.liquidityAdded - liveState.metrics.liquidityRemoved).toFixed(1)}</div>
                 </div>
               </div>
               {/* Simplified event tape */}
               <div className="rounded border border-[#27272a] overflow-hidden">
                 <div className="px-2 py-1 bg-[#18181b] text-[8px] font-bold text-[#71717a]">EVENT TAPE</div>
                 <div className="p-1 space-y-0.5 max-h-[150px] overflow-y-auto">
                   {liquidityEvents.map((ev, i) => <div key={i} className="text-[9px] flex justify-between bg-white/5 px-1.5 py-0.5 rounded">
                     <span className={ev.priority === "SSS" ? "text-[#f59e0b]" : "text-[#a1a1aa]"}>{ev.type}</span>
                     <span className="text-[#52525b]">{ev.message}</span>
                   </div>)}
                 </div>
               </div>
             </div>
           ) : <RefreshCw size={16} className="animate-spin m-auto" />}
        </div>
      )}
    </div>
  );
};

function aggregateOrderBook(levels: [string, string][], step: number, isBid: boolean): [string, string][] {
  const groups: Record<string, number> = {};
  for (const [pStr, qStr] of levels) {
    const p = parseFloat(pStr), q = parseFloat(qStr);
    if (isNaN(p) || isNaN(q)) continue;
    const groupedPrice = isBid ? Math.floor(p / step) * step : Math.ceil(p / step) * step;
    const decimals = step < 1 ? Math.round(-Math.log10(step)) : 0;
    const key = groupedPrice.toFixed(decimals);
    groups[key] = (groups[key] || 0) + q;
  }
  return Object.entries(groups).map(([p, q]) => [p, String(q)] as [string, string]).sort((a, b) => isBid ? parseFloat(b[0]) - parseFloat(a[0]) : parseFloat(a[0]) - parseFloat(b[0]));
}
