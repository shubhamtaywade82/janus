import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Position Row ───
function PositionRow({ position }: { position: any }) {
  const pnl = parseFloat(position.unrealizedPnl || "0");
  const isProfit = pnl >= 0;

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
      <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
        {parseFloat(position.currentPrice).toFixed(2)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {parseFloat(position.size).toFixed(4)}
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {position.leverage}x
      </td>
      <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
        {parseFloat(position.margin).toFixed(2)}
      </td>
      <td className="px-3 py-2">
        <div className={cn("flex items-center gap-1 text-xs tabular-nums", isProfit ? "text-[#22c55e]" : "text-[#ef4444]")}>
          {isProfit ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {isProfit ? "+" : ""}
          {pnl.toFixed(4)}
        </div>
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

// ─── Main Portfolio Page ───
export default function Portfolio() {
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const { data: portfolio } = trpc.trading.portfolio.useQuery(
    { userId: 1 },
    { refetchInterval: 5000 }
  );

  const { data: allPositions } = trpc.trading.positions.useQuery(
    { userId: 1, status: statusFilter as any },
    { refetchInterval: 5000 }
  );

  const totalPnl = parseFloat(portfolio?.totalUnrealizedPnl || "0") + parseFloat(portfolio?.totalRealizedPnl || "0");
  const isProfit = totalPnl >= 0;

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

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={14} className="text-[#3b82f6]" />
            <span className="text-[10px] text-[#71717a]">Open Positions</span>
          </div>
          <div className="text-2xl font-bold text-[#f4f4f5] tabular-nums">
            {portfolio?.openPositionsCount || 0}
          </div>
        </div>

        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={14} className="text-[#22c55e]" />
            <span className="text-[10px] text-[#71717a]">Total Margin</span>
          </div>
          <div className="text-2xl font-bold text-[#f4f4f5] tabular-nums">
            ${parseFloat(portfolio?.totalMargin || "0").toFixed(2)}
          </div>
        </div>

        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            {isProfit ? (
              <TrendingUp size={14} className="text-[#22c55e]" />
            ) : (
              <TrendingDown size={14} className="text-[#ef4444]" />
            )}
            <span className="text-[10px] text-[#71717a]">Unrealized PnL</span>
          </div>
          <div className={cn("text-2xl font-bold tabular-nums", isProfit ? "text-[#22c55e]" : "text-[#ef4444]")}>
            {isProfit ? "+" : ""}
            ${parseFloat(portfolio?.totalUnrealizedPnl || "0").toFixed(4)}
          </div>
        </div>

        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <PieChart size={14} className="text-[#f59e0b]" />
            <span className="text-[10px] text-[#71717a]">Total Equity</span>
          </div>
          <div className="text-2xl font-bold text-[#f4f4f5] tabular-nums">
            ${(portfolio?.totalEquity || 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Risk Warning */}
      {portfolio && parseFloat(portfolio.totalUnrealizedPnl) < -parseFloat(portfolio.totalMargin) * 0.5 && (
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
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Margin</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">PnL</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {allPositions?.map((pos) => (
                <PositionRow key={pos.id} position={pos} />
              ))}
              {(!allPositions || allPositions.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-[#71717a]">
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
    </div>
  );
}
