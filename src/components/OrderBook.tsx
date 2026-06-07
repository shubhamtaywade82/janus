import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Zap, Activity, RefreshCw } from "lucide-react";
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

  const { bidsWithSum, asksWithSum, totalBidVolume, totalAskVolume } = useMemo(() => {
    let bSum = 0, aSum = 0;
    const bWS = bids.map(([p, q]) => { const s = parseFloat(q); bSum += s; return { price: p, qty: s, sum: bSum }; });
    const aWS = asks.map(([p, q]) => { const s = parseFloat(q); aSum += s; return { price: p, qty: s, sum: aSum }; });
    return { bidsWithSum: bWS, asksWithSum: aWS, totalBidVolume: bSum, totalAskVolume: aSum };
  }, [bids, asks]);

  const lastPrice = tickerData ? parseFloat(tickerData.lastPrice) : 0;
  const isPriceUp = tickerData && parseFloat(tickerData.priceChange) >= 0;
  const lastPriceColor = isPriceUp ? "hsl(var(--janus-up-bright))" : "hsl(var(--janus-down-bright))";
  const totalVol = totalBidVolume + totalAskVolume;
  const bidPct = totalVol > 0 ? (totalBidVolume / totalVol) * 100 : 50;

  return (
    <div className="flex flex-col h-full text-[10px]">
      <div className="px-3 py-2 border-b border-[#27272a]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[#71717a]">Order Book</span>
            <select value={priceStep} onChange={(e) => setPriceStep(parseFloat(e.target.value))} className="bg-[#18181b] border border-[#27272a] rounded px-1 py-0.5 text-[9px] text-[#f4f4f5] h-5">
              {aggregationOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
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
          <div className="flex-1 flex flex-col justify-between overflow-hidden">
            <div className="flex-1 overflow-hidden flex flex-col justify-end">
              {asksWithSum.slice().reverse().map((ask, i) => <div key={`ask-${i}`} className="relative grid grid-cols-3 py-0.5 px-3 hover:bg-[#27272a]/30">
                <div className="absolute inset-y-0 right-0 bg-j-down-bright/15" style={{ width: `${(ask.qty/totalAskVolume)*100}%` }} />
                <span className="relative text-j-down-bright">{formatPrice(ask.price, symbol)}</span>
                <span className="relative text-right">{ask.qty.toFixed(1)}</span>
                <span className="relative text-right text-zinc-500">{ask.sum.toFixed(1)}</span>
              </div>)}
            </div>
            <div className="py-1 px-3 border-y border-[#27272a]/50 bg-[#18181b]/50 text-[11px] font-bold" style={{ color: lastPriceColor }}>{lastPrice > 0 ? <AnimatedNumber value={lastPrice} decimals={getPriceDecimals(symbol)} duration={150} /> : "--"}</div>
            <div className="flex-1 overflow-hidden">
              {bidsWithSum.map((bid, i) => <div key={`bid-${i}`} className="relative grid grid-cols-3 py-0.5 px-3 hover:bg-[#27272a]/30">
                <div className="absolute inset-y-0 right-0 bg-j-up-bright/15" style={{ width: `${(bid.qty/totalBidVolume)*100}%` }} />
                <span className="relative text-j-up-bright">{formatPrice(bid.price, symbol)}</span>
                <span className="relative text-right">{bid.qty.toFixed(1)}</span>
                <span className="relative text-right text-zinc-500">{bid.sum.toFixed(1)}</span>
              </div>)}
            </div>
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
