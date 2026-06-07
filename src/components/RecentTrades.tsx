import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice, formatQty } from "@/utils/precision";

export const RecentTrades = ({ symbol }: { symbol: string }) => {
  const [trades, setTrades] = useState<any[]>([]);

  const { data: initialTrades } = trpc.market.recentTrades.useQuery({ symbol, limit: 20 }, { staleTime: Infinity });

  useEffect(() => { if (initialTrades) setTrades(initialTrades); }, [initialTrades, symbol]);

  const onDataRef = useRef((trade: any) => { setTrades((prev) => [trade, ...prev].slice(0, 20)); });
  useEffect(() => { onDataRef.current = (trade: any) => { setTrades((prev) => [trade, ...prev].slice(0, 20)); }; }, []);

  const recentTradesInput = useMemo(() => ({ symbol }), [symbol]);
  trpc.market.recentTradesStream.useSubscription(recentTradesInput, { onData: (trade: any) => onDataRef.current(trade) });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a]">
        <span className="text-xs text-[#71717a]">Recent Trades</span>
        <Clock size={12} className="text-[#71717a]" />
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {trades?.map((trade, i) => (
          <div key={`${trade.id}-${i}`} className="flex items-center justify-between px-3 py-1 text-xs">
            <span className={cn("tabular-nums", trade.isBuyerMaker ? "text-j-down" : "text-j-up")}>{formatPrice(trade.price, symbol, (trade as any).basePrecision)}</span>
            <span className="text-[#71717a] tabular-nums">{formatQty(trade.qty, symbol, (trade as any).targetPrecision)}</span>
            <span className="text-[#52525b] text-[10px]">{new Date(trade.time).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
