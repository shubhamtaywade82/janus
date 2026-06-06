import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";

const fmt = (n: number, d = 2) => (n ?? 0).toFixed(d);
const pnlColor = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-[#a1a1aa]");

interface Bucket { trades: number; wins: number; losses: number; pnl: number; }

function AttributionTable({ title, data }: { title: string; data: Record<string, Bucket> }) {
  const rows = Object.entries(data).sort((a, b) => b[1].pnl - a[1].pnl);
  return (
    <div className="rounded border border-[#27272a] bg-[#0f0f11] p-2">
      <div className="text-[10px] font-bold uppercase text-[#71717a] mb-1">{title}</div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-[#52525b]">
            <th className="text-left font-normal">name</th>
            <th className="text-right font-normal">trades</th>
            <th className="text-right font-normal">win%</th>
            <th className="text-right font-normal">PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="text-[#52525b] py-1">no closed trades</td></tr>}
          {rows.map(([k, b]) => (
            <tr key={k} className="border-t border-[#18181b]">
              <td className="text-[#f4f4f5] py-0.5 truncate max-w-[120px]">{k}</td>
              <td className="text-right text-[#a1a1aa]">{b.trades}</td>
              <td className="text-right text-[#a1a1aa]">{b.trades ? ((b.wins / b.trades) * 100).toFixed(0) : "—"}</td>
              <td className={cn("text-right tabular-nums", pnlColor(b.pnl))}>{b.pnl >= 0 ? "+" : ""}{fmt(b.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SystemReportPanel() {
  const [windowN, setWindowN] = useState<number | undefined>(undefined); // undefined = all
  const { data } = trpc.performance.systemReport.useQuery(
    { isPaper: true, lastNTrades: windowN },
    { refetchInterval: 30_000 }
  );

  const h = data?.headline;

  const stat = (label: string, value: string, color?: string) => (
    <div className="rounded border border-[#27272a] bg-[#0f0f11] p-2">
      <div className="text-[9px] uppercase text-[#71717a]">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", color ?? "text-[#f4f4f5]")}>{value}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-bold text-[#f4f4f5]">System Performance Report</span>
        <div className="ml-auto flex gap-1">
          {[50, 100, undefined].map((n) => (
            <button
              key={String(n)}
              onClick={() => setWindowN(n)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] border",
                windowN === n ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "bg-[#18181b] text-[#71717a] border-[#27272a]"
              )}
            >
              {n ? `last ${n}` : "all"}
            </button>
          ))}
        </div>
      </div>

      {!h ? (
        <div className="text-[10px] text-[#52525b]">No closed trades yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {stat("trades", String(h.trades))}
            {stat("win rate", h.trades ? `${(h.winRate * 100).toFixed(1)}%` : "—")}
            {stat("net PnL", `${h.totalPnl >= 0 ? "+" : ""}${fmt(h.totalPnl)}`, pnlColor(h.totalPnl))}
            {stat("expectancy", `${h.expectancy >= 0 ? "+" : ""}${fmt(h.expectancy)}`, pnlColor(h.expectancy))}
            {stat("profit factor", h.profitFactor == null ? "∞" : fmt(h.profitFactor))}
            {stat("max DD", fmt(h.maxDrawdown), "text-amber-400")}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {stat("avg win", `+${fmt(h.avgWin)}`, "text-emerald-400")}
            {stat("avg loss", `-${fmt(h.avgLoss)}`, "text-red-400")}
            {stat("avg hold", `${fmt(h.avgHoldMinutes, 0)}m`)}
            {stat("wins / losses", `${h.wins} / ${h.losses}`)}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <AttributionTable title="By source" data={data!.bySource} />
            <AttributionTable title="By strategy" data={data!.byStrategy} />
            <AttributionTable title="By symbol" data={data!.bySymbol} />
          </div>

          {data!.brainQuality.total > 0 && (
            <div className="rounded border border-[#27272a] bg-[#0f0f11] p-2 flex flex-wrap gap-2 text-[10px]">
              <span className="text-[#71717a] font-bold uppercase">Brain:</span>
              <span className="text-[#a1a1aa]">{data!.brainQuality.total} decisions</span>
              <span className="text-emerald-400">{data!.brainQuality.enter} enter</span>
              <span className="text-[#a1a1aa]">{data!.brainQuality.hold} hold</span>
              <span className="text-emerald-400">{data!.brainQuality.executed} executed</span>
              <span className="text-amber-400">{data!.brainQuality.vetoedByGate} vetoed</span>
              <span className="text-[#52525b]">{data!.brainQuality.shadowLogged} shadow</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
