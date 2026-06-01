import { useState, useEffect, useRef, useCallback, useMemo, memo, useLayoutEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  AlertTriangle,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Position Row ───
const PositionRow = ({ position, livePrice }: { position: any; livePrice?: number }) => {
  const currentPrice = livePrice ?? parseFloat(position.currentPrice || "0");
  const entryPrice = parseFloat(position.entryPrice || "0");
  const size = parseFloat(position.size || "0");
  const marginCurrency = position.marginCurrency || "USDT";

  const rawPnl = position.side === "long"
    ? (currentPrice - entryPrice) * size
    : (entryPrice - currentPrice) * size;
  const pnl = rawPnl;
  const isProfit = pnl >= 0;

  const priceFlash = useFlash(currentPrice);
  const pnlFlashRow = useFlash(pnl);
  const marginMode = position.marginMode || "isolated";
  const liqDistance = position.liquidationPrice && currentPrice > 0
    ? Math.abs(currentPrice - parseFloat(position.liquidationPrice))
    : 0;
  const liqPercent = position.liquidationPrice && currentPrice > 0
    ? (liqDistance / currentPrice) * 100
    : 0;

  return (
    <tr className="border-b border-[#27272a] hover:bg-[#18181b] transition-colors">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              position.side === "long" ? "bg-[#22c55e]" : "bg-[#ef4444]"
            )}
          />
          <span className="text-xs font-medium text-[#f4f4f5]">{position.symbol}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            position.side === "long"
              ? "bg-[#22c55e]/10 text-[#22c55e]"
              : "bg-[#ef4444]/10 text-[#ef4444]"
          )}
        >
          {position.side.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
        {parseFloat(position.entryPrice).toFixed(2)}
      </td>
      <td className={cn("px-3 py-2 text-xs text-[#f4f4f5] tabular-nums rounded", priceFlash)}>
        {currentPrice.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {parseFloat(position.size).toFixed(4)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {position.leverage}x
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className={cn(
            "text-[9px] px-1 py-0.5 rounded",
            marginMode === "cross"
              ? "bg-[#3b82f6]/10 text-[#3b82f6]"
              : "bg-[#71717a]/10 text-[#71717a]"
          )}>
            {marginMode === "cross" ? "CROSS" : "ISO"}
          </span>
          <span className={cn(
            "text-[9px] px-1 py-0.5 rounded",
            marginCurrency === "INR"
              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
              : "bg-[#22c55e]/10 text-[#22c55e]"
          )}>
            {marginCurrency}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {parseFloat(position.margin || "0").toFixed(2)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {position.maintenanceMargin ? parseFloat(position.maintenanceMargin).toFixed(2) : "--"}
      </td>
      <td className="px-3 py-2">
        <div className={cn("flex items-center gap-1 text-xs tabular-nums rounded px-1 -mx-1", isProfit ? "text-[#22c55e]" : "text-[#ef4444]", pnlFlashRow)}>
          {isProfit ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {isProfit ? "+" : ""}
          {pnl.toFixed(4)}
        </div>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            liqPercent < 5
              ? "bg-[#ef4444]/10 text-[#ef4444]"
              : liqPercent < 15
              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
              : "bg-[#22c55e]/10 text-[#22c55e]"
          )}
          title={`Liq: ${position.liquidationPrice || "--"}`}
        >
          <Shield size={10} className="inline mr-0.5" />
          {liqPercent.toFixed(1)}%
        </span>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            position.status === "open"
              ? "bg-[#22c55e]/10 text-[#22c55e]"
              : position.status === "closed"
              ? "bg-[#27272a] text-[#71717a]"
              : "bg-[#ef4444]/10 text-[#ef4444]"
          )}
        >
          {position.status.toUpperCase()}
        </span>
      </td>
    </tr>
  );
}

// ─── Flash on value change ───
function useFlash(value: number, duration = 600): "flash-up" | "flash-down" | "" {
  const [flash, setFlash] = useState<"flash-up" | "flash-down" | "">("");
  const prev = useRef(value);
  useLayoutEffect(() => {
    if (prev.current === value) return;
    const dir = value > prev.current ? "flash-up" : "flash-down";
    prev.current = value;
    setFlash(dir);
    const t = setTimeout(() => setFlash(""), duration);
    return () => clearTimeout(t);
  }, [value, duration]);
  return flash;
}

// ─── Per-symbol ticker subscription ───
// memo + stable optsRef → prevents re-subscription on every parent re-render
const SymbolTicker = memo(({ symbol, onPrice }: { symbol: string; onPrice: (sym: string, price: number) => void }) => {
  const onPriceRef = useRef(onPrice);
  onPriceRef.current = onPrice;

  // Keep options object stable — never recreated after mount
  const optsRef = useRef({
    onData(t: any) {
      if (t?.lastPrice) onPriceRef.current(symbol, parseFloat(t.lastPrice));
    },
  });

  trpc.market.tickerStream.useSubscription({ symbol }, optsRef.current);
  return null;
});

// ─── Main Portfolio Page ───
export default function Portfolio() {
  const [statusFilter, setStatusFilter] = useState<string>("open");

  // Use portfolioStream subscription for live push updates
  const [portfolio, setPortfolio] = useState<any>(null);
  const portfolioRef = useRef<any>(null);

  // Initial fetch
  const { data: initialPortfolio } = trpc.trading.portfolio.useQuery(
    { userId: 1 },
    { staleTime: Infinity }
  );
  useEffect(() => {
    if (initialPortfolio && !portfolioRef.current) {
      setPortfolio(initialPortfolio);
      portfolioRef.current = initialPortfolio;
    }
  }, [initialPortfolio]);

  // Stable callback ref — prevents re-subscription on every render
  const prevPositionCount = useRef<number | null>(null);
  const onPortfolioData = useRef((data: any) => {
    const prev = prevPositionCount.current;
    const next = data?.openPositionsCount ?? 0;
    if (prev !== null && next !== prev) {
      if (next > prev) {
        toast.success(`Position opened`, { description: `${next} open position${next !== 1 ? "s" : ""}` });
      } else {
        toast.info(`Position closed`, { description: `${next} open position${next !== 1 ? "s" : ""}` });
      }
    }
    prevPositionCount.current = next;
    setPortfolio(data);
    portfolioRef.current = data;
  });

  const portfolioStreamOpts = useRef({
    onData: (data: any) => onPortfolioData.current(data),
  });

  trpc.trading.portfolioStream.useSubscription({ userId: 1 }, portfolioStreamOpts.current);

  const { data: conversion } = trpc.trading.currencyConversion.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  );

  // Query historical positions only when viewing non-open filters
  const { data: dbPositions } = trpc.trading.positions.useQuery(
    { userId: 1, status: statusFilter as any },
    { enabled: statusFilter !== "open", refetchInterval: 10000 }
  );

  const openPositions: any[] = portfolio?.positions || [];
  const symbols = useMemo(
    () => [...new Set(openPositions.map((p: any) => p.symbol as string))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openPositions.map((p: any) => p.symbol).join(",")]
  );

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const handlePrice = useCallback((sym: string, price: number) => {
    setLivePrices((prev) => prev[sym] === price ? prev : { ...prev, [sym]: price });
  }, []);

  const allPositions = statusFilter === "open" ? openPositions : (dbPositions || []);

  // Recalculate totals using live prices
  const usdtInrRate = conversion?.conversion_price ?? 89.0;
  const liveTotalUnrealizedPnl = openPositions.reduce((sum: number, p: any) => {
    const lp = livePrices[p.symbol] ?? parseFloat(p.currentPrice || "0");
    const entry = parseFloat(p.entryPrice || "0");
    const size = parseFloat(p.size || "0");
    const raw = p.side === "long" ? (lp - entry) * size : (entry - lp) * size;
    // PnL currency = quote of symbol (ETHUSDT → USDT, never INR for current pairs)
    // marginCurrency (INR) ≠ quote currency — margin is just collateral
    const quoteIsInr = (p.symbol as string).endsWith("INR");
    return sum + (quoteIsInr ? raw / usdtInrRate : raw);
  }, 0);

  const walletBase = parseFloat((portfolio as any)?.walletUsdt || "0")
    || ((portfolio?.totalEquity || 0) - parseFloat(portfolio?.totalUnrealizedPnl || "0"));
  const totalEquityUsdt = walletBase + liveTotalUnrealizedPnl;

  const totalPnl = liveTotalUnrealizedPnl + parseFloat(portfolio?.totalRealizedPnl || "0");
  const isProfit = totalPnl >= 0;

  // Risk warning toast — fire once when threshold crossed
  const riskWarningFired = useRef(false);
  useEffect(() => {
    if (totalEquityUsdt > 0 && liveTotalUnrealizedPnl < -(totalEquityUsdt * 0.1)) {
      if (!riskWarningFired.current) {
        riskWarningFired.current = true;
        toast.error("Risk Warning", {
          description: `Unrealized loss exceeds 10% of account equity. Current drawdown: ${((liveTotalUnrealizedPnl / totalEquityUsdt) * 100).toFixed(1)}%`,
          duration: 10000,
        });
      }
    } else {
      riskWarningFired.current = false;
    }
  }, [liveTotalUnrealizedPnl, totalEquityUsdt]);

  const pnlFlash = useFlash(liveTotalUnrealizedPnl);
  const marginFlash = useFlash(parseFloat(portfolio?.totalMargin || "0"));
  const equityFlash = useFlash(totalEquityUsdt
  );

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet size={18} className="text-[#3b82f6]" />
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">Portfolio</h2>
            <p className="text-[10px] text-[#71717a]">Position tracking and risk metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {["open", "closed", "liquidated"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded text-xs transition-colors capitalize",
                statusFilter === s
                  ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30"
                  : "bg-[#18181b] text-[#71717a] border border-[#27272a] hover:text-[#f4f4f5]"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards — CoinDCX style */}
      {(() => {
        const walletBalanceUsdt = walletBase;
        const walletBalanceInr = walletBalanceUsdt * usdtInrRate;
        const currentValueUsdt = totalEquityUsdt;
        const currentValueInr = currentValueUsdt * usdtInrRate;
        const pnlUsdt = liveTotalUnrealizedPnl;
        const pnlInr = pnlUsdt * usdtInrRate;
        const pnlPct = walletBalanceUsdt > 0 ? (pnlUsdt / walletBalanceUsdt) * 100 : 0;
        const availFree = parseFloat((portfolio as any)?.availableInr || "0");
        const lockedMgn = parseFloat((portfolio as any)?.lockedInr || "0");
        const walletCcy = (portfolio as any)?.walletCurrency ?? "INR";
        const rate = parseFloat((portfolio as any)?.usdtInrRate || String(usdtInrRate));
        return (
          <div className="grid grid-cols-3 gap-3">
            {/* Wallet Balance */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={14} className="text-[#3b82f6]" />
                <span className="text-[10px] text-[#71717a]">Wallet Balance</span>
              </div>
              <div className={cn("text-xl font-bold text-[#f4f4f5] tabular-nums rounded px-1 -mx-1", marginFlash)}>
                {walletBalanceUsdt.toFixed(4)} USDT
              </div>
              <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">
                ₹{walletBalanceInr.toFixed(2)} · Rate ₹{rate.toFixed(2)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[9px]">
                <span className="text-[#22c55e]">Available ₹{availFree.toFixed(2)}</span>
                <span className="text-[#f59e0b]">Locked ₹{lockedMgn.toFixed(2)}</span>
              </div>
            </div>

            {/* Current Value (Equity) */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <PieChart size={14} className="text-[#f59e0b]" />
                <span className="text-[10px] text-[#71717a]">Current Value</span>
              </div>
              <div className={cn("text-xl font-bold text-[#f4f4f5] tabular-nums rounded px-1 -mx-1", equityFlash)}>
                {currentValueUsdt.toFixed(4)} USDT
              </div>
              <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">
                ₹{currentValueInr.toFixed(2)}
              </div>
              <div className="mt-2 text-[9px] text-[#71717a]">
                {portfolio?.openPositionsCount || 0} open position{portfolio?.openPositionsCount !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Active PnL */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                {isProfit
                  ? <TrendingUp size={14} className="text-[#22c55e]" />
                  : <TrendingDown size={14} className="text-[#ef4444]" />}
                <span className="text-[10px] text-[#71717a]">Active PnL</span>
              </div>
              <div className={cn("text-xl font-bold tabular-nums rounded px-1 -mx-1", isProfit ? "text-[#22c55e]" : "text-[#ef4444]", pnlFlash)}>
                {pnlUsdt >= 0 ? "+" : ""}{pnlUsdt.toFixed(4)} USDT
              </div>
              <div className={cn("text-[10px] mt-1 tabular-nums", isProfit ? "text-[#22c55e]/70" : "text-[#ef4444]/70")}>
                {pnlInr >= 0 ? "+" : ""}₹{pnlInr.toFixed(2)}
              </div>
              <div className={cn("mt-1.5 text-sm font-bold tabular-nums", isProfit ? "text-[#22c55e]" : "text-[#ef4444]")}>
                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
              </div>
            </div>
          </div>
        );
      })()}

      {/* Risk Warning — trigger when PnL > 10% of total wallet equity */}
      {portfolio && totalEquityUsdt > 0 && liveTotalUnrealizedPnl < -(totalEquityUsdt * 0.1) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30">
          <AlertTriangle size={14} className="text-[#ef4444]" />
          <span className="text-xs text-[#ef4444]">
            Warning: Unrealized losses exceed 50% of total margin. Consider reducing positions.
          </span>
        </div>
      )}

      {/* Positions Table */}
      <div className="flex-1 bg-[#18181b] border border-[#27272a] rounded-lg overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-[#27272a] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#f4f4f5]">
            {statusFilter === "open" ? "Open Positions" : statusFilter === "closed" ? "Closed Positions" : "Liquidated Positions"}
          </span>
          <span className="text-[10px] text-[#71717a]">
            {allPositions?.length || 0} positions
          </span>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#27272a]">
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Symbol</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Side</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Entry</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Current</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Size</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Lev</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Mode</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Margin</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Maint.</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">PnL</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Liq%</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {allPositions?.map((pos: any) => (
                <PositionRow key={pos.id} position={pos} livePrice={livePrices[pos.symbol]} />
              ))}
              {(!allPositions || allPositions.length === 0) && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-xs text-[#71717a]">
                    <Target size={20} className="mx-auto mb-2 opacity-30" />
                    No {statusFilter} positions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Trades */}
      {portfolio && portfolio.recentTrades.length > 0 && (
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-[#27272a]">
            <span className="text-xs font-semibold text-[#f4f4f5]">Recent Trades</span>
          </div>
          <div className="max-h-32 overflow-auto scrollbar-thin">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#27272a]">
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Time</th>
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Symbol</th>
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Side</th>
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Price</th>
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Size</th>
                  <th className="px-3 py-1 text-left text-[10px] text-[#71717a] font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.recentTrades.map((trade: any) => (
                  <tr key={trade.id} className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30">
                    <td className="px-3 py-1 text-[10px] text-[#52525b]">
                      {new Date(trade.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-1 text-[10px] text-[#f4f4f5]">{trade.symbol}</td>
                    <td className="px-3 py-1">
                      <span className={cn(
                        "text-[10px] px-1 rounded",
                        trade.side === "buy" ? "text-[#22c55e] bg-[#22c55e]/10" : "text-[#ef4444] bg-[#ef4444]/10"
                      )}>
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-[10px] text-[#f4f4f5] tabular-nums">
                      {parseFloat(trade.price).toFixed(2)}
                    </td>
                    <td className="px-3 py-1 text-[10px] text-[#71717a] tabular-nums">
                      {parseFloat(trade.size).toFixed(4)}
                    </td>
                    <td className="px-3 py-1 text-[10px] text-[#71717a] tabular-nums">
                      {parseFloat(trade.total).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Hidden ticker subscriptions — one component per open symbol */}
      {symbols.map((sym) => (
        <SymbolTicker key={sym} symbol={sym} onPrice={handlePrice} />
      ))}
    </div>
  );
}
