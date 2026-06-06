import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { createChart, ColorType, LineSeries, AreaSeries } from "lightweight-charts";
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

    const series = chart.addSeries(LineSeries, {
      color: "hsl(var(--janus-up))",
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

function DetailedEquityCurve({ data }: { data: EquityPoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || data.length < 1) return;

    const points = data
      .map((d) => ({
        time: Math.floor(new Date(d.snapshotAt).getTime() / 1000) as number,
        value: parseFloat(d.totalEquityUsdt),
      }))
      .sort((a, b) => a.time - b.time);

    const isNetPositive = points.length > 0 && points[points.length - 1].value >= points[0].value;
    const themeColor = isNetPositive ? "hsl(var(--janus-up))" : "hsl(var(--janus-down))";
    const topColor = isNetPositive ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)";
    const bottomColor = isNetPositive ? "rgba(34, 197, 94, 0.0)" : "rgba(239, 68, 68, 0.0)";

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#18181b", style: 2 },
        horzLines: { color: "#18181b", style: 2 },
      },
      rightPriceScale: {
        borderVisible: false,
        visible: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: "#27272a",
          width: 1,
          style: 3,
          labelVisible: true,
        },
        horzLine: {
          color: "#27272a",
          width: 1,
          style: 3,
          labelVisible: true,
        },
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: themeColor,
      topColor: topColor,
      bottomColor: bottomColor,
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    series.setData(points as any);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current && chart) {
        chart.applyOptions({ width: chartRef.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={chartRef} className="w-full h-[280px]" />;
}

function StatCard({
  label, value, sub, icon, color
}: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  color: "green" | "red" | "yellow";
}) {
  const textColor = color === "green" ? "text-j-up" : color === "red" ? "text-j-down" : "text-[#f59e0b]";
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

function StatCardLarge({
  label, value, sub, icon, color
}: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  color: "green" | "red" | "yellow";
}) {
  const textColor = color === "green" ? "text-j-up" : color === "red" ? "text-j-down" : "text-[#f59e0b]";
  const bgLight = color === "green" ? "bg-j-up/5 border-j-up/10" : color === "red" ? "bg-j-down/5 border-j-down/10" : "bg-[#f59e0b]/5 border-[#f59e0b]/10";
  return (
    <div className={cn("bg-[#09090b] border border-[#27272a] rounded-xl p-4 flex flex-col justify-between hover:border-[#3f3f46] transition-colors shadow-sm", bgLight)}>
      <div className="flex items-center justify-between mb-2 text-[#71717a]">
        <span className="text-xs font-medium">{label}</span>
        <div className="p-1.5 rounded-lg bg-[#18181b] border border-[#27272a] text-[#a1a1aa] flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div>
        <div className={cn("text-2xl font-bold tabular-nums tracking-tight", textColor)}>{value}</div>
        <div className="text-[11px] text-[#71717a] tabular-nums mt-1">{sub}</div>
      </div>
    </div>
  );
}

export function PerformanceDashboard({ userId = 1, isFullPage = false }: { userId?: number; isFullPage?: boolean }) {
  const { data: metrics } = trpc.autoExecutor.metrics.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: equityCurve } = trpc.autoExecutor.equityCurve.useQuery(
    { limit: 200 },
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

  const streakLabel = metrics.currentStreak > 0
    ? `+${metrics.currentStreak}W`
    : metrics.currentStreak < 0
    ? `${metrics.currentStreak}L`
    : "—";

  if (isFullPage) {
    return (
      <div className="flex flex-col gap-4 w-full h-full overflow-y-auto scrollbar-thin">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCardLarge
            label="Win Rate"
            value={`${winPct}%`}
            sub={`${metrics.winCount}W / ${metrics.lossCount}L`}
            icon={<Target size={18} />}
            color={parseFloat(winPct) >= 50 ? "green" : parseFloat(winPct) > 0 ? "red" : "yellow"}
          />
          <StatCardLarge
            label="Profit Factor"
            value={pfDisplay}
            sub={`${metrics.totalTrades} trades`}
            icon={<TrendingUp size={18} />}
            color={metrics.profitFactor >= 1.5 ? "green" : metrics.profitFactor >= 1 ? "yellow" : "red"}
          />
          <StatCardLarge
            label="Avg Win"
            value={`$${metrics.avgWin.toFixed(2)}`}
            sub={`Max $${metrics.largestWin.toFixed(2)}`}
            icon={<Zap size={18} />}
            color="green"
          />
          <StatCardLarge
            label="Streak"
            value={streakLabel}
            sub={`Avg loss $${metrics.avgLoss.toFixed(2)}`}
            icon={<TrendingDown size={18} />}
            color={metrics.currentStreak >= 0 ? "green" : "red"}
          />
        </div>

        {/* Chart & Strategy Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Equity Curve Chart */}
          <div className="lg:col-span-2 bg-[#09090b] border border-[#27272a] rounded-lg p-4 flex flex-col h-[360px]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#f4f4f5]">Equity Curve</h3>
                <p className="text-[10px] text-[#71717a]">Historical account equity snapshots over time</p>
              </div>
              {equityCurve && (
                <span className="text-[10px] bg-[#18181b] border border-[#27272a] px-2 py-1 rounded text-[#71717a] font-medium">
                  {equityCurve.length} points
                </span>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[280px]">
              {equityCurve && equityCurve.length >= 2 ? (
                <DetailedEquityCurve data={equityCurve as EquityPoint[]} />
              ) : (
                <div className="text-center text-xs text-[#71717a]">
                  <TrendingUp size={24} className="mx-auto mb-2 opacity-30" />
                  Not enough snapshots to plot equity curve (minimum 2 required)
                </div>
              )}
            </div>
          </div>

          {/* Strategy Breakdown */}
          <div className="lg:col-span-1 bg-[#09090b] border border-[#27272a] rounded-lg p-4 flex flex-col h-[360px]">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[#f4f4f5]">By Strategy</h3>
              <p className="text-[10px] text-[#71717a]">Performance metrics grouped by strategy</p>
            </div>
            <div className="flex-1 overflow-auto scrollbar-thin">
              {Object.keys(metrics.byStrategy).length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#27272a]">
                      {["Strategy", "Trades", "W/L", "PnL"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[#71717a] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(metrics.byStrategy).map(([strat, data]) => (
                      <tr key={strat} className="border-b border-[#18181b] hover:bg-[#18181b]/50">
                        <td className="px-3 py-2 text-[#a1a1aa] capitalize font-medium">{strat.replace("_", " ")}</td>
                        <td className="px-3 py-2 text-[#f4f4f5] tabular-nums font-medium">{data.trades}</td>
                        <td className="px-3 py-2 tabular-nums font-medium">
                          <span className="text-j-up">{data.wins}</span>
                          <span className="text-[#52525b]">/</span>
                          <span className="text-j-down">{data.losses}</span>
                        </td>
                        <td className={cn("px-3 py-2 tabular-nums font-semibold", data.pnl >= 0 ? "text-j-up" : "text-j-down")}>
                          {data.pnl >= 0 ? "+" : ""}{data.pnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[#71717a]">
                  <Target size={24} className="mb-2 opacity-30 animate-pulse" />
                  No strategy data recorded
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Equity Curve */}
      {equityCurve && equityCurve.length >= 2 && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[#f4f4f5]">Equity Curve</span>
            <span className="text-[10px] text-[#52525b]">{equityCurve.length} points</span>
          </div>
          <MiniEquityCurve data={equityCurve as EquityPoint[]} />
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Win Rate" value={`${winPct}%`} sub={`${metrics.winCount}W / ${metrics.lossCount}L`}
          icon={<Target size={11} />} color={parseFloat(winPct) >= 50 ? "green" : parseFloat(winPct) > 0 ? "red" : "yellow"} />
        <StatCard label="Profit Factor" value={pfDisplay}
          sub={`${metrics.totalTrades} trades`} icon={<TrendingUp size={11} />}
          color={metrics.profitFactor >= 1.5 ? "green" : metrics.profitFactor >= 1 ? "yellow" : "red"} />
        <StatCard label="Avg Win" value={`$${metrics.avgWin.toFixed(2)}`}
          sub={`Max $${metrics.largestWin.toFixed(2)}`} icon={<Zap size={11} />} color="green" />
        <StatCard label="Streak" value={streakLabel}
          sub={`Avg loss $${metrics.avgLoss.toFixed(2)}`} icon={<TrendingDown size={11} />}
          color={metrics.currentStreak >= 0 ? "green" : "red"} />
      </div>

      {/* Per-Strategy Breakdown */}
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
                    <span className="text-j-up">{data.wins}</span>
                    <span className="text-[#52525b]">/</span>
                    <span className="text-j-down">{data.losses}</span>
                  </td>
                  <td className={cn("px-3 py-1.5 tabular-nums font-medium", data.pnl >= 0 ? "text-j-up" : "text-j-down")}>
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
