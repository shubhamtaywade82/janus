import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Activity, TrendingUp, Zap, AlertTriangle, RefreshCw } from "lucide-react";

type RegimeType = "ranging_tight" | "ranging" | "reversal" | "intraday_trend" | "swing_trend" | "high_volatility";
type StrategyType = "scalping_micro" | "scalping" | "bb_reversion" | "momentum_reversal" | "intraday" | "swing" | "grid" | "ml_sizing";

const REGIME_CFG: Record<RegimeType, { label: string; color: string; icon: React.ReactNode }> = {
  ranging_tight:   { label: "RANGING",   color: "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/10", icon: <Zap size={9} /> },
  ranging:         { label: "RANGING",   color: "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/10", icon: <Zap size={9} /> },
  reversal:        { label: "REVERSAL",  color: "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10", icon: <RefreshCw size={9} /> },
  intraday_trend:  { label: "TREND 1H",  color: "text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/10", icon: <Activity size={9} /> },
  swing_trend:     { label: "TREND 4H",  color: "text-[#3b82f6] border-[#3b82f6]/30 bg-[#3b82f6]/10", icon: <TrendingUp size={9} /> },
  high_volatility: { label: "HIGH VOL",  color: "text-[#ef4444] border-[#ef4444]/30 bg-[#ef4444]/10", icon: <AlertTriangle size={9} /> },
};

const STRATEGY_LABEL: Record<StrategyType, string> = {
  scalping_micro:     "Micro Scalp",
  scalping:           "Scalping",
  bb_reversion:       "BB Revert",
  momentum_reversal:  "Mom. Reversal",
  intraday:           "Intraday",
  swing:              "Swing",
  grid:               "Grid",
  ml_sizing:          "ML Sizing",
};

export function RegimeIndicator() {
  const [switchLog, setSwitchLog] = useState<{ from: string; to: string } | null>(null);

  const { data: status } = trpc.signal.regimeStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  trpc.signal.regimeStream.useSubscription(undefined, {
    onData: (data: unknown) => {
      const d = data as { from: string; to: string; regime: string };
      setSwitchLog(d);
      setTimeout(() => setSwitchLog(null), 10_000);
    },
  });

  const regime = (status?.regime ?? "intraday_trend") as RegimeType;
  const strategy = (status?.activeStrategy ?? "intraday") as StrategyType;
  const cfg = REGIME_CFG[regime] ?? REGIME_CFG.intraday_trend;

  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold", cfg.color)}>
        {cfg.icon}
        <span>{cfg.label}</span>
      </div>
      <span className="text-[9px] text-[#3f3f46]">→</span>
      <span className="text-[9px] font-medium text-[#a1a1aa]">
        {STRATEGY_LABEL[strategy] ?? strategy}
      </span>
      {switchLog && (
        <span className="text-[9px] text-[#f59e0b] animate-pulse ml-0.5">
          ↻ {STRATEGY_LABEL[switchLog.from as StrategyType] ?? switchLog.from}→{STRATEGY_LABEL[switchLog.to as StrategyType] ?? switchLog.to}
        </span>
      )}
    </div>
  );
}
