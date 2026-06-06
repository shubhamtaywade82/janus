import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Cpu, Activity, ShieldCheck, Zap } from "lucide-react";

// Read-affecting control surface for the AI Brain: toggle driver/gate/shadow and
// watch the live executor decision feed (incl. brain-driven trades) + gate breakdown.
export function BrainControlPanel() {
  const { data: mode, refetch: refetchMode } = trpc.brain.getBrainMode.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const setMode = trpc.brain.setBrainMode.useMutation({
    onSuccess: () => { toast.success("Brain mode updated"); refetchMode(); },
    onError: (e) => toast.error("Update failed", { description: e.message }),
  });

  const { data: decisions } = trpc.bot.decisions.useQuery(
    { limit: 12 },
    { refetchInterval: 10_000 }
  );
  const { data: stats } = trpc.bot.decisionStats.useQuery({ windowMinutes: 60 }, { refetchInterval: 10_000 });

  const [live, setLive] = useState<any[]>([]);
  trpc.bot.decisionStream.useSubscription(undefined, {
    onData: (d: any) => setLive((prev) => [d, ...prev].slice(0, 12)),
  });
  useEffect(() => { if (decisions) setLive(decisions as any[]); }, [decisions]);

  const toggle = (key: "brainDriverEnabled" | "brainGateEnabled" | "brainShadowMode") => {
    if (!mode) return;
    setMode.mutate({ [key]: !(mode as any)[key] });
  };

  const Toggle = ({ label, active, icon, onClick, danger }: {
    label: string; active: boolean; icon: React.ReactNode; onClick: () => void; danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border transition-colors",
        active
          ? danger
            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
            : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          : "bg-[#18181b] text-[#71717a] border-[#27272a] hover:bg-[#27272a]"
      )}
    >
      {icon}
      {label}: {active ? "ON" : "OFF"}
    </button>
  );

  return (
    <div className="rounded-lg border border-[#27272a] bg-[#0f0f11] p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-purple-400" />
        <span className="text-xs font-bold text-[#f4f4f5]">Brain Participation</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Toggle label="Driver" active={!!mode?.brainDriverEnabled} icon={<Zap size={11} />} onClick={() => toggle("brainDriverEnabled")} />
        <Toggle label="Gate" active={!!mode?.brainGateEnabled} icon={<ShieldCheck size={11} />} onClick={() => toggle("brainGateEnabled")} />
        <Toggle label="Shadow" active={!!mode?.brainShadowMode} icon={<Activity size={11} />} onClick={() => toggle("brainShadowMode")} danger />
      </div>
      <p className="text-[9px] text-[#52525b]">
        Driver = brain opens trades autonomously · Gate = brain vetoes confluence signals · Shadow = log only (no execution)
      </p>

      {/* Gate breakdown */}
      {stats && (
        <div className="flex flex-wrap gap-1.5 text-[9px]">
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">executed {stats.executed}</span>
          <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400">skipped {stats.skipped}</span>
          {stats.byGate.filter((g) => g.action === "skip").map((g) => (
            <span key={g.gate ?? "?"} className="px-2 py-0.5 rounded bg-[#18181b] text-[#a1a1aa] border border-[#27272a]">
              {g.gate ?? "?"}: {g.count}
            </span>
          ))}
        </div>
      )}

      {/* Live decision feed */}
      <div className="flex flex-col gap-1 max-h-48 overflow-auto scrollbar-thin">
        {live.length === 0 && <span className="text-[10px] text-[#52525b]">No decisions yet…</span>}
        {live.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px] py-0.5 border-b border-[#18181b]">
            <span className={cn("font-bold w-14", d.action === "execute" ? "text-emerald-400" : "text-red-400")}>
              {d.action === "execute" ? "EXEC" : "SKIP"}
            </span>
            <span className="text-[#f4f4f5] w-20 truncate">{d.symbol}</span>
            <span className="text-[#52525b] w-16 truncate">{d.gate ?? "-"}</span>
            <span className="text-[#a1a1aa] flex-1 truncate">{d.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
