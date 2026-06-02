import { useState, useEffect, useRef, useCallback, useMemo, memo, useLayoutEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { PerformanceDashboard } from "@/components/PerformanceDashboard";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PieChart,
  AlertTriangle,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Position Row ───
const PositionRow = ({ position, livePrice }: { position: any; livePrice?: number }) => {
  const currentPrice = livePrice ?? parseFloat(position.currentPrice || "0");
  const entryPrice = parseFloat(position.entryPrice || "0");
  const size = parseFloat(position.size || "0");
  const marginCurrency = position.marginCurrency || "USDT";

  // Use live price for real-time PnL when available; fall back to backend-provided value
  const pnl = currentPrice > 0
    ? (position.side === "long"
        ? (currentPrice - entryPrice) * size
        : (entryPrice - currentPrice) * size)
    : parseFloat(position.unrealizedPnl || "0");
  const isProfit = pnl >= 0;
  const roe = parseFloat(position.roe || "0");

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
          {position.isPaper && (
            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30">
              PAPER
            </span>
          )}
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
        {marginCurrency === "INR" ? "₹" : "$"}{parseFloat(position.margin || "0").toFixed(2)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {position.maintenanceMargin 
          ? `${marginCurrency === "INR" ? "₹" : "$"}${parseFloat(position.maintenanceMargin).toFixed(2)}` 
          : "--"}
      </td>
      <td className="px-3 py-2">
        <div className={cn("flex flex-col gap-0.5", isProfit ? "text-[#22c55e]" : "text-[#ef4444]", pnlFlashRow)}>
          <div className="flex items-center gap-1 text-xs tabular-nums rounded px-1 -mx-1">
            {isProfit ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {isProfit ? "+" : ""}{pnl.toFixed(4)}
          </div>
          {roe !== 0 && (
            <span className="text-[9px] tabular-nums opacity-70 px-1 -mx-1">
              ROE {roe >= 0 ? "+" : ""}{roe.toFixed(2)}%
            </span>
          )}
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
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    localStorage.getItem("janus_portfolio_status") ?? "open"
  );

  // Auto-detect paper mode from server env (PLACE_ORDERS=false → default to PAPER view)
  const { data: botStatus } = trpc.autoExecutor.status.useQuery(undefined, { staleTime: 30_000 });
  const defaultMode = botStatus?.isPaperMode ? "paper" : "live";
  const [portfolioMode, setPortfolioMode] = useState<"live" | "paper">(() => {
    const saved = localStorage.getItem("janus_portfolio_mode");
    if (saved === "live" || saved === "paper") return saved;
    return defaultMode;
  });

  const STATIC_RATE = 98;
  const [rateMode, setRateMode] = useState<"live" | "static">(() => {
    const saved = localStorage.getItem("janus_rate_mode");
    return saved === "static" ? "static" : "live";
  });

  // Sync once when botStatus first loads (before user manually toggles)
  const modeSyncedRef = useRef(false);
  useEffect(() => {
    if (botStatus && !modeSyncedRef.current) {
      modeSyncedRef.current = true;
      setPortfolioMode(botStatus.isPaperMode ? "paper" : "live");
    }
  }, [botStatus]);

  // Persist toggle states to localStorage
  useEffect(() => { localStorage.setItem("janus_portfolio_mode", portfolioMode); }, [portfolioMode]);
  useEffect(() => { localStorage.setItem("janus_rate_mode", rateMode); }, [rateMode]);
  useEffect(() => { localStorage.setItem("janus_portfolio_status", statusFilter); }, [statusFilter]);

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

  // Always-on direct DB query for paper positions — independent of portfolioStream
  const { data: allDbOpenPositions } = trpc.trading.positions.useQuery(
    { userId: 1, status: "open" },
    { refetchInterval: 5000 }
  );
  const paperPositions = (allDbOpenPositions || []).filter((p: any) => p.isPaper);
  const livePositionsFromStream: any[] = (portfolio?.positions || []).filter((p: any) => !p.isPaper);

  // Paper wallet stats from auto-executor
  const { data: paperWalletData } = trpc.autoExecutor.paperWallet.useQuery(
    { userId: 1 },
    { refetchInterval: 5000 }
  );

  const openPositions: any[] = portfolio?.positions || [];
  const symbols = useMemo(
    () => [...new Set([
      ...openPositions.map((p: any) => p.symbol as string),
      ...paperPositions.map((p: any) => p.symbol as string),
    ])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [[...openPositions, ...paperPositions].map((p: any) => p.symbol).join(",")]
  );

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const handlePrice = useCallback((sym: string, price: number) => {
    setLivePrices((prev) => prev[sym] === price ? prev : { ...prev, [sym]: price });
  }, []);

  // For "open" tab: switch between live (from stream) and paper (from DB direct query)
  const openLivePositions = livePositionsFromStream;
  const allPositions = statusFilter !== "open"
    ? (dbPositions || [])
    : portfolioMode === "paper"
      ? paperPositions
      : openLivePositions;

  // Query historical positions and trades for tax metrics
  const { data: closedPositions } = trpc.trading.positions.useQuery(
    { userId: 1, status: "closed" },
    { refetchInterval: 30000 }
  );
  const { data: liquidatedPositions } = trpc.trading.positions.useQuery(
    { userId: 1, status: "liquidated" },
    { refetchInterval: 30000 }
  );
  const { data: tradeHistory } = trpc.trading.trades.useQuery(
    { userId: 1 },
    { refetchInterval: 30000 }
  );

  const taxMetrics = useMemo(() => {
    const closed = closedPositions || [];
    const liq = liquidatedPositions || [];
    const history = tradeHistory || [];

    // 1. Calculate 30% VDA Gains (No offsets allowed!)
    let totalGainsUsdt = 0;
    [...closed, ...liq].forEach((pos: any) => {
      const pnl = parseFloat(pos.realizedPnl || "0");
      if (pnl > 0) {
        totalGainsUsdt += pnl;
      }
    });

    const vdaTaxRate = 0.312; // 30% tax + 4% cess = 31.2%
    const estTaxUsdt = totalGainsUsdt * vdaTaxRate;

    // 2. Calculate 1% TDS (applicable on sell/close fills)
    let totalTdsUsdt = 0;
    history.forEach((t: any) => {
      if (t.side === "sell") {
        const value = parseFloat(t.price) * parseFloat(t.size);
        totalTdsUsdt += value * 0.01;
      }
    });

    return {
      totalGainsUsdt,
      estTaxUsdt,
      totalTdsUsdt,
    };
  }, [closedPositions, liquidatedPositions, tradeHistory]);

  // Recalculate totals using live prices
  const liveRate = conversion?.conversion_price ?? 89.0;
  const usdtInrRate = rateMode === "static" ? STATIC_RATE : liveRate;

  // Paper portfolio computed values
  const paperUnrealizedPnl = paperPositions.reduce((sum: number, p: any) => {
    const lp = livePrices[p.symbol] ?? parseFloat(p.currentPrice || "0");
    const entry = parseFloat(p.entryPrice || "0");
    const size = parseFloat(p.size || "0");
    return sum + (p.side === "long" ? (lp - entry) * size : (entry - lp) * size);
  }, 0);
  const paperFreeBalance = parseFloat(String(paperWalletData?.balance ?? 10000));
  const paperLockedMargin = parseFloat(String(paperWalletData?.lockedMargin ?? 0));
  const paperRealizedPnl = parseFloat(String(paperWalletData?.realizedPnl ?? 0));
  const paperStartingBalance = parseFloat(String(paperWalletData?.startingBalance ?? 10000));
  const paperEquity = paperFreeBalance + paperLockedMargin + paperUnrealizedPnl;

  const liveTotalUnrealizedPnl = openPositions.reduce((sum: number, p: any) => {
    if (p.isPaper) return sum;
    const lp = livePrices[p.symbol] ?? 0;
    const entry = parseFloat(p.entryPrice || "0");
    const size = parseFloat(p.size || "0");
    // Use live price for real-time calc; fall back to backend unrealizedPnl (exchange-reported or mark-price based)
    const raw = lp > 0
      ? (p.side === "long" ? (lp - entry) * size : (entry - lp) * size)
      : parseFloat(p.unrealizedPnl || "0");
    // PnL currency = quote of symbol (ETHUSDT → USDT, never INR for current pairs)
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
          <Wallet size={18} className={portfolioMode === "paper" ? "text-[#f59e0b]" : "text-[#3b82f6]"} />
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">Portfolio</h2>
            <p className="text-[10px] text-[#71717a]">
              {portfolioMode === "paper" ? "Paper trading — virtual capital" : "Live account — real positions"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* LIVE / PAPER mode toggle */}
          <div className="flex rounded overflow-hidden border border-[#27272a] text-xs font-semibold">
            <button
              onClick={() => setPortfolioMode("live")}
              className={cn(
                "px-3 py-1.5 transition-colors",
                portfolioMode === "live"
                  ? "bg-[#22c55e]/10 text-[#22c55e]"
                  : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
              )}
            >
              LIVE
            </button>
            <button
              onClick={() => setPortfolioMode("paper")}
              className={cn(
                "px-3 py-1.5 border-l border-[#27272a] transition-colors",
                portfolioMode === "paper"
                  ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                  : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
              )}
            >
              PAPER {paperPositions.length > 0 && <span className="ml-1 opacity-70">({paperPositions.length})</span>}
            </button>
          </div>
          {/* INR rate toggle */}
          <div className="flex rounded overflow-hidden border border-[#27272a] text-[10px] font-medium">
            <button
              onClick={() => setRateMode("live")}
              className={cn(
                "px-2 py-1 transition-colors",
                rateMode === "live"
                  ? "bg-[#22c55e]/10 text-[#22c55e]"
                  : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
              )}
              title="CoinDCX live USDT/INR rate"
            >
              ₹{liveRate.toFixed(2)}
            </button>
            <button
              onClick={() => setRateMode("static")}
              className={cn(
                "px-2 py-1 border-l border-[#27272a] transition-colors",
                rateMode === "static"
                  ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                  : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
              )}
              title="Static rate ₹98/USDT"
            >
              ₹{STATIC_RATE}
            </button>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1">
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
      </div>

      {/* Summary Cards — switches between LIVE and PAPER mode */}
      {portfolioMode === "live" ? (
        // ─── LIVE cards ───
        (() => {
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
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet size={14} className="text-[#3b82f6]" />
                  <span className="text-[10px] text-[#71717a]">Wallet Balance</span>
                </div>
                <div className={cn("text-xl font-bold text-[#f4f4f5] tabular-nums rounded px-1 -mx-1", marginFlash)}>
                  {walletBalanceUsdt.toFixed(4)} USDT
                </div>
                <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">
                  ₹{walletBalanceInr.toFixed(2)} · Rate ₹{usdtInrRate.toFixed(2)}
                  {rateMode === "static" && <span className="ml-1 text-[#f59e0b]">(static)</span>}
                </div>
                <div className="mt-2 flex items-center justify-between text-[9px]">
                  <span className="text-[#22c55e]">Available {walletCcy === "INR" ? `₹${availFree.toFixed(2)}` : `$${availFree.toFixed(2)}`}</span>
                  <span className="text-[#f59e0b]">Locked {walletCcy === "INR" ? `₹${lockedMgn.toFixed(2)}` : `$${lockedMgn.toFixed(2)}`}</span>
                </div>
              </div>
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PieChart size={14} className="text-[#f59e0b]" />
                  <span className="text-[10px] text-[#71717a]">Current Value</span>
                </div>
                <div className={cn("text-xl font-bold text-[#f4f4f5] tabular-nums rounded px-1 -mx-1", equityFlash)}>
                  {currentValueUsdt.toFixed(4)} USDT
                </div>
                <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">₹{currentValueInr.toFixed(2)}</div>
                <div className="mt-2 text-[9px] text-[#71717a]">{portfolio?.livePositionsCount || 0} live positions open</div>
              </div>
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {isProfit ? <TrendingUp size={14} className="text-[#22c55e]" /> : <TrendingDown size={14} className="text-[#ef4444]" />}
                  <span className="text-[10px] text-[#71717a]">Unrealized PnL</span>
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
        })()
      ) : (
        // ─── PAPER cards ───
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#18181b] border border-[#f59e0b]/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet size={14} className="text-[#f59e0b]" />
              <span className="text-[10px] text-[#71717a]">Paper Wallet</span>
              <span className="text-[8px] font-bold px-1 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">VIRTUAL</span>
            </div>
            <div className="text-xl font-bold text-[#f4f4f5] tabular-nums">${paperFreeBalance.toFixed(2)}</div>
            <div className="text-[10px] text-[#52525b] mt-1">Started with ${paperStartingBalance.toFixed(2)}</div>
            <div className="mt-2 flex items-center justify-between text-[9px]">
              <span className="text-[#22c55e]">Free ${paperFreeBalance.toFixed(2)}</span>
              <span className="text-[#f59e0b]">Locked ${paperLockedMargin.toFixed(2)}</span>
            </div>
          </div>
          <div className="bg-[#18181b] border border-[#f59e0b]/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <PieChart size={14} className="text-[#f59e0b]" />
              <span className="text-[10px] text-[#71717a]">Paper Equity</span>
            </div>
            <div className="text-xl font-bold text-[#f4f4f5] tabular-nums">${paperEquity.toFixed(2)}</div>
            <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">
              {paperEquity >= paperStartingBalance
                ? <span className="text-[#22c55e]">+${(paperEquity - paperStartingBalance).toFixed(2)} vs start</span>
                : <span className="text-[#ef4444]">-${(paperStartingBalance - paperEquity).toFixed(2)} vs start</span>}
            </div>
            <div className="mt-2 text-[9px] text-[#71717a]">{paperPositions.length} paper positions open</div>
          </div>
          <div className="bg-[#18181b] border border-[#f59e0b]/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              {paperUnrealizedPnl >= 0 ? <TrendingUp size={14} className="text-[#22c55e]" /> : <TrendingDown size={14} className="text-[#ef4444]" />}
              <span className="text-[10px] text-[#71717a]">Paper PnL</span>
            </div>
            <div className={cn("text-xl font-bold tabular-nums", paperUnrealizedPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}>
              {paperUnrealizedPnl >= 0 ? "+" : ""}{paperUnrealizedPnl.toFixed(4)} USDT
            </div>
            <div className="text-[10px] text-[#52525b] mt-1 tabular-nums">
              Realized: <span className={paperRealizedPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>
                {paperRealizedPnl >= 0 ? "+" : ""}{paperRealizedPnl.toFixed(4)}
              </span>
            </div>
            <div className="mt-1.5 text-[10px] text-[#52525b]">
              Total: <span className={cn("font-medium", (paperUnrealizedPnl + paperRealizedPnl) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}>
                {(paperUnrealizedPnl + paperRealizedPnl) >= 0 ? "+" : ""}{(paperUnrealizedPnl + paperRealizedPnl).toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Indian VDA Tax Estimator Row — live mode only */}
      {portfolioMode === "live" && <div className="grid grid-cols-2 gap-3 mt-3">
        {/* VDA Gains & Estimated Tax Card */}
        <div className="bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-[#ef4444]" />
            <span className="text-[10px] text-[#ef4444] font-semibold uppercase tracking-wide">
              Section 115BBH VDA Tax (India)
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-xl font-bold text-[#ef4444] tabular-nums">
              ₹{(taxMetrics.estTaxUsdt * usdtInrRate).toFixed(2)}
            </div>
            <div className="text-xs text-[#71717a] tabular-nums">
              (${taxMetrics.estTaxUsdt.toFixed(2)} USDT)
            </div>
          </div>
          <div className="text-[10px] text-[#71717a] mt-2 leading-relaxed">
            Estimated <span className="font-semibold text-[#f4f4f5]">31.2% Tax</span> (including 4% cess) on gross profit. 
            <br />
            Gross FY Profits: <span className="text-[#22c55e] font-semibold">₹{(taxMetrics.totalGainsUsdt * usdtInrRate).toFixed(2)}</span> (losses are not offset).
          </div>
        </div>

        {/* 1% TDS Paid Card */}
        <div className="bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Percent size={14} className="text-[#f59e0b]" />
            <span className="text-[10px] text-[#f59e0b] font-semibold uppercase tracking-wide">
              Section 194S TDS Paid (1%)
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-xl font-bold text-[#f59e0b] tabular-nums">
              ₹{(taxMetrics.totalTdsUsdt * usdtInrRate).toFixed(2)}
            </div>
            <div className="text-xs text-[#71717a] tabular-nums">
              (${taxMetrics.totalTdsUsdt.toFixed(2)} USDT)
            </div>
          </div>
          <div className="text-[10px] text-[#71717a] mt-2 leading-relaxed">
            Estimated Tax Deducted at Source (1% of sell/short orders) withheld on exchange transfers.
          </div>
        </div>
      </div>}

      {/* Risk Warning — trigger when PnL < -50% of total margin */}
      {portfolio && parseFloat(portfolio.totalMargin || "0") > 0 && liveTotalUnrealizedPnl < -(parseFloat(portfolio.totalMargin || "0") * 0.5) && (
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
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#f4f4f5]">
              {statusFilter === "open" ? "Open Positions" : statusFilter === "closed" ? "Closed Positions" : "Liquidated Positions"}
            </span>
            {statusFilter === "open" && (
              <div className="flex rounded overflow-hidden border border-[#27272a] text-[10px] font-semibold">
                <button
                  onClick={() => setPortfolioMode("live")}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    portfolioMode === "live"
                      ? "bg-[#22c55e]/10 text-[#22c55e]"
                      : "bg-[#18181b] text-[#52525b] hover:text-[#f4f4f5]"
                  )}
                >
                  LIVE {openLivePositions.length > 0 && `(${openLivePositions.length})`}
                </button>
                <button
                  onClick={() => setPortfolioMode("paper")}
                  className={cn(
                    "px-2.5 py-1 border-l border-[#27272a] transition-colors",
                    portfolioMode === "paper"
                      ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                      : "bg-[#18181b] text-[#52525b] hover:text-[#f4f4f5]"
                  )}
                >
                  PAPER {paperPositions.length > 0 && `(${paperPositions.length})`}
                </button>
              </div>
            )}
          </div>
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
      {/* Performance Dashboard */}
      <PerformanceDashboard userId={1} />

      {/* Hidden ticker subscriptions — one component per open symbol */}
      {symbols.map((sym) => (
        <SymbolTicker key={sym} symbol={sym} onPrice={handlePrice} />
      ))}
    </div>
  );
}
