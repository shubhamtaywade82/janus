import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Clock } from "lucide-react";

interface Props {
  userId: number;
}

export function RiskStatus({ userId }: Props) {
  const { data: risk, refetch } = trpc.trading.riskStatus.useQuery(
    { userId },
    { refetchInterval: 10_000 }
  );

  trpc.trading.riskAlertStream.useSubscription(
    { userId },
    {
      onData: (payload: unknown) => {
        const d = payload as { type: string; message: string };
        if (d.type === "drawdown_limit") {
          toast.error("Daily loss limit hit", {
            description: d.message,
            duration: 0, // persist until dismissed
          });
        } else if (d.type === "cooldown") {
          toast.warning("Cooldown activated", {
            description: d.message,
            duration: 20_000,
          });
        }
        refetch();
      },
    }
  );

  if (!risk) return null;

  const drawdownPct = risk.drawdownPct ?? 0;
  const limit = risk.drawdownLimit ?? 5;
  const barWidth = Math.min((drawdownPct / limit) * 100, 100);
  const barColor =
    drawdownPct >= limit * 0.8 ? "bg-[#ef4444]" :
    drawdownPct >= limit * 0.5 ? "bg-[#f59e0b]" :
    "bg-[#22c55e]";

  const isInCooldown = risk.inCooldown && risk.cooldownUntil && Date.now() < risk.cooldownUntil;
  const minsLeft = isInCooldown
    ? Math.ceil((risk.cooldownUntil! - Date.now()) / 60_000)
    : 0;

  return (
    <div className="px-3 py-2 border-b border-[#27272a] space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#52525b] uppercase tracking-wide">Risk</span>
        <div className="flex items-center gap-1 text-[9px]">
          {isInCooldown ? (
            <span className="text-[#f59e0b] flex items-center gap-0.5">
              <Clock size={9} /> {minsLeft}m cooldown
            </span>
          ) : (
            <span className="text-[#22c55e] flex items-center gap-0.5">
              <ShieldCheck size={9} /> active
            </span>
          )}
        </div>
      </div>

      {/* Daily drawdown bar */}
      <div>
        <div className="flex justify-between text-[9px] mb-0.5">
          <span className="text-[#71717a]">Daily loss</span>
          <span className={cn(
            "tabular-nums font-medium",
            drawdownPct >= limit * 0.8 ? "text-[#ef4444]" :
            drawdownPct >= limit * 0.5 ? "text-[#f59e0b]" :
            "text-[#22c55e]"
          )}>
            {drawdownPct.toFixed(2)}% / {limit}%
          </span>
        </div>
        <div className="h-1 bg-[#18181b] rounded overflow-hidden">
          <div
            className={cn("h-full rounded transition-all duration-500", barColor)}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* Trade stats */}
      <div className="flex gap-3 text-[9px]">
        <span className="text-[#52525b]">
          Trades <span className="text-[#a1a1aa]">{risk.tradeCount}</span>
        </span>
        <span className="text-[#52525b]">
          Streak <span className={cn(
            risk.consecutiveLosses >= 2 ? "text-[#f59e0b]" : "text-[#a1a1aa]"
          )}>{risk.consecutiveLosses}L</span>
        </span>
        <span className="text-[#52525b]">
          Max pos <span className="text-[#a1a1aa]">{risk.maxPositionPct}%</span>
        </span>
      </div>

      {isInCooldown && (
        <div className="flex items-center gap-1 text-[9px] text-[#f59e0b] bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded px-2 py-1">
          <ShieldAlert size={9} />
          <span>Cooldown — {minsLeft}m remaining. No new positions.</span>
        </div>
      )}
    </div>
  );
}
