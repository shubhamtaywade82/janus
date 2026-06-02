import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { createChart, ColorType, LineStyle } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Target, Zap } from "lucide-react";

interface EquityPoint {
  snapshotAt: string | Date;
  totalEquityUsdt: string;
  openPositionCount: number | null;
}

function MiniEquityCurve({ data }: { data: EquityPoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || data.length < 2) return;

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 80,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#52525b" },
      grid: { vertLines: { visible: false }, horzLines: { color: "#18181b" } },
      rightPriceScale: { borderVisible: false, visible: true, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addLineSeries({
      color: "#22c55e",
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const points = data
      .map((d) => ({
        time: Math.floor(new Date(d.snapshotAt).getTime() / 1000) as number,
        value: parseFloat(d.totalEquityUsdt),
      }))
      .sort((a, b) => a.time - b.time);

    series.setData(points as any);
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [data]);

  return <div ref={chartRef} className="w-full h-20" />;
}

export function PerformanceDashboard({ userId = 1 }: { userId?: number }) {
  const { data: metrics } = trpc.autoExecutor.metrics.useQuery({ userId }, {
    refetchInterval: 30_000,
  });

  const { data: equityCurve } = trpc.autoExecutor.equityCurve.useQuery(
    { userId, limit: 200 },
    { refetchInterval: 30_000 }
  );

  if (!metrics) return null;

  const winPct = metrics.totalTrades > 0
    ? (metrics.winRate * 100).toFixed(1)
    : "—";

  const pfDisplay = metrics.profitFactor === Infinity
    ? "∞"
    : metrics.profitFactor > 0
    ? metrics.profitFactor.toFixed(2)
    : "—";

  const streakColor = metrics.currentStreak > 0 ? "text-[#22c55e]" : metrics.currentStreak < 0 ? "text-[#ef4444]" : "text-[#71717a]";
  const streakLabel = metrics.currentStreak > 0
    ? `+${metrics.currentStreak}W`
    : metrics.currentStreak < 0
    ? `${metrics.currentStreak}L`
    : "—";

  return (
    <div className="space-y-3">
      {/* Equity curve */}
      {equityCurve && equityCurve.length >= 2 && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[#f4f4f5]">Equity Curve</span>
            <span className="text-[10px] text-[#52525b]">{equityCurve.length} points</span>
          </div>
          <MiniEquityCurve data={equityCurve as EquityPoint[]} />
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Win Rate" value={`${winPct}%`} sub={`${metrics.winCount}W / ${metrics.lossCount}L`}
          icon={<Target size={11} />} color={parseFloat(winPct) >= 50 ? "green" : "red"} />
        <StatCard label="Profit Factor" value={pfDisplay}
          sub={`${metrics.totalTrades} trades`} icon={<TrendingUp size={11} />}
          color={metrics.profitFactor >= 1.5 ? "green" : metrics.profitFactor >= 1 ? "yellow" : "red"} />
        <StatCard label="Avg Win" value={`$${metrics.avgWin.toFixed(2)}`}
          sub={`Max $${metrics.largestWin.toFixed(2)}`} icon={<Zap size={11} />} color="green" />
        <StatCard label="Streak" value={streakLabel}
          sub={`Avg loss $${metrics.avgLoss.toFixed(2)}`} icon={<TrendingDown size={11} />}
          color={metrics.currentStreak >= 0 ? "green" : "red"} />
      </div>

      {/* Per-strategy breakdown */}
      {Object.keys(metrics.byStrategy).length > 0 && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-[#27272a]">
            <span className="text-[10px] font-semibold text-[#f4f4f5]">By Strategy</span>
          </div>
          <table className="w-full text-[9px]">
            <thead>
              <tr className="border-b border-[#27272a]">
                {["Strategy", "Trades", "W/L", "PnL"].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left text-[#52525b] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.byStrategy).map(([strat, data]) => (
                <tr key={strat} className="border-b border-[#18181b] hover:bg-[#18181b]">
                  <td className="px-3 py-1.5 text-[#a1a1aa] capitalize">{strat.replace("_", " ")}</td>
                  <td className="px-3 py-1.5 text-[#f4f4f5] tabular-nums">{data.trades}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    <span className="text-[#22c55e]">{data.wins}</span>
                    <span className="text-[#52525b]">/</span>
                    <span className="text-[#ef4444]">{data.losses}</span>
                  </td>
                  <td className={cn("px-3 py-1.5 tabular-nums font-medium", data.pnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}>
                    {data.pnl >= 0 ? "+" : ""}{data.pnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, sub, icon, color
}: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  color: "green" | "red" | "yellow";
}) {
  const textColor = color === "green" ? "text-[#22c55e]" : color === "red" ? "text-[#ef4444]" : "text-[#f59e0b]";
  return (
    <div className="bg-[#09090b] border border-[#27272a] rounded-lg p-2.5">
      <div className="flex items-center gap-1 mb-1 text-[#52525b]">
        {icon}
        <span className="text-[9px]">{label}</span>
      </div>
      <div className={cn("text-sm font-semibold tabular-nums", textColor)}>{value}</div>
      <div className="text-[9px] text-[#52525b] tabular-nums">{sub}</div>
    </div>
  );
}
