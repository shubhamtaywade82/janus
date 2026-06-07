import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./AnimatedNumber";
import { getPriceDecimals } from "@/utils/precision";

const TickerStreamSubscriber = ({ symbol, onUpdate }: { symbol: string; onUpdate: (symbol: string, data: any) => void; }) => {
  const onDataRef = useRef((data: any) => onUpdate(symbol, data));
  useEffect(() => { onDataRef.current = (data: any) => onUpdate(symbol, data); }, [onUpdate, symbol]);
  trpc.market.tickerStream.useSubscription({ symbol }, { onData: (data: any) => onDataRef.current(data) });
  return null;
};

export const TickerStrip = ({ activeSymbol, onSelectSymbol }: { activeSymbol: string; onSelectSymbol: (symbol: string) => void; }) => {
  const [tickersMap, setTickersMap] = useState<Record<string, any>>({});
  const { data: initialTickers } = trpc.market.ticker24h.useQuery({}, { staleTime: Infinity });

  useEffect(() => {
    if (Array.isArray(initialTickers)) {
      const map: Record<string, any> = {};
      initialTickers.forEach(t => { map[t.symbol] = t; });
      setTickersMap(map);
    }
  }, [initialTickers]);

  const supportedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
  const handleTickerUpdate = useCallback((symbol: string, data: any) => {
    setTickersMap((prev) => ({ ...prev, [symbol]: { ...prev[symbol], ...data } }));
  }, []);

  const tickerList = supportedSymbols.map((s) => tickersMap[s]).filter(Boolean);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[#27272a] bg-[#09090b] overflow-x-auto scrollbar-thin">
      {supportedSymbols.map((symbol) => <TickerStreamSubscriber key={symbol} symbol={symbol} onUpdate={handleTickerUpdate} />)}
      {tickerList.map((t: any) => {
        const isActive = t.symbol === activeSymbol;
        return (
          <button key={t.symbol} onClick={() => onSelectSymbol(t.symbol)} className={cn("flex items-center gap-2 flex-shrink-0 px-2 py-0.5 rounded transition-all hover:bg-[#27272a]/30 border text-left", isActive ? "border-[#f59e0b] bg-[#f59e0b]/5" : "border-transparent")}>
            <span className={cn("text-[10px] font-semibold", isActive ? "text-[#f59e0b]" : "text-[#71717a]")}>{t.symbol}</span>
            <span className="text-[10px] tabular-nums text-[#f4f4f5]"><AnimatedNumber value={parseFloat(t.lastPrice)} decimals={getPriceDecimals(t.symbol)} duration={150} /></span>
            <span className={cn("text-[10px] tabular-nums", parseFloat(t.priceChangePercent) >= 0 ? "text-j-up" : "text-j-down")}>{parseFloat(t.priceChangePercent) >= 0 ? "+" : ""}{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
          </button>
        );
      })}
    </div>
  );
};
