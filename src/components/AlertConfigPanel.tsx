import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Bell, BellOff } from "lucide-react";
import type { AlertConfig } from "@/lib/chart/alert-engine";
import { ALERT_DEFAULTS } from "@/lib/chart/alert-engine";

const INDICATOR_ALERTS: { key: keyof AlertConfig; label: string; desc: string }[] = [
  { key: "emaCross",       label: "EMA Cross",        desc: "EMA 9 × 21 crossover" },
  { key: "bbBreakout",     label: "BB Breakout",       desc: "Close outside Bollinger Bands" },
  { key: "superTrendFlip", label: "SuperTrend Flip",   desc: "ST direction change" },
  { key: "rsiExtreme",     label: "RSI 70/30",         desc: "RSI enters/exits overbought/oversold" },
  { key: "vwapCross",      label: "VWAP Cross",        desc: "Price crosses VWAP" },
];

const SMC_ALERTS: { key: keyof AlertConfig; label: string; desc: string }[] = [
  { key: "bosSignal",   label: "BOS",         desc: "New Break of Structure" },
  { key: "chochSignal", label: "CHoCH",        desc: "Change of Character (reversal)" },
  { key: "obTouch",     label: "OB Touch",     desc: "Price enters an Order Block" },
  { key: "fvgFill",     label: "FVG Fill",     desc: "Fair Value Gap being filled" },
  { key: "liqSweep",    label: "Liq Sweep",    desc: "Equal Highs/Lows swept" },
];

interface Props { onChange: (cfg: AlertConfig) => void; }

export function AlertConfigPanel({ onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [cfg, setCfg] = useState<AlertConfig>(() => {
    try {
      const s = localStorage.getItem("janus_alert_cfg");
      return s ? { ...ALERT_DEFAULTS, ...JSON.parse(s) } : ALERT_DEFAULTS;
    } catch { return ALERT_DEFAULTS; }
  });

  useEffect(() => {
    localStorage.setItem("janus_alert_cfg", JSON.stringify(cfg));
    onChange(cfg);
  }, [cfg, onChange]);

  const flip = (key: keyof AlertConfig) =>
    setCfg((c) => ({ ...c, [key]: !c[key] }));

  const activeCount = Object.values(cfg).filter(Boolean).length;

  const Row = ({ key, label, desc }: { key: keyof AlertConfig; label: string; desc: string }) => (
    <button key={key} onClick={() => flip(key)}
      className={cn(
        "w-full flex items-center justify-between px-2 py-1 rounded text-left transition-colors mb-0.5",
        cfg[key] ? "bg-[#18181b]" : "hover:bg-[#18181b]/50"
      )}
    >
      <div>
        <div className={cn("text-[10px] font-medium", cfg[key] ? "text-[#f4f4f5]" : "text-[#52525b]")}>
          {label}
        </div>
        <div className="text-[8px] text-[#3f3f46]">{desc}</div>
      </div>
      <div className={cn(
        "text-[8px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ml-2",
        cfg[key]
          ? "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30"
          : "bg-transparent text-[#3f3f46] border-[#27272a]"
      )}>
        {cfg[key] ? "ON" : "OFF"}
      </div>
    </button>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors",
          activeCount > 0
            ? "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/5"
            : "text-[#71717a] border-[#27272a] hover:text-[#f4f4f5]",
          expanded && "bg-[#18181b]"
        )}
        title="Alert conditions"
      >
        {activeCount > 0 ? <Bell size={11} /> : <BellOff size={11} />}
        <span>Alerts</span>
        {activeCount > 0 && <span className="tabular-nums">{activeCount}</span>}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#09090b] border border-[#27272a] rounded-lg shadow-xl p-3 w-52">
          <div className="text-[9px] text-[#52525b] uppercase tracking-wide mb-2">Alert Conditions</div>

          <div className="text-[9px] text-[#3b82f6] mb-1 px-1">Indicators</div>
          {INDICATOR_ALERTS.map((a) => <Row key={a.key} {...a} />)}

          <div className="text-[9px] text-[#a855f7] mt-2 mb-1 px-1">SMC / ICT</div>
          {SMC_ALERTS.map((a) => <Row key={a.key} {...a} />)}

          <div className="border-t border-[#27272a] mt-2 pt-2 flex gap-2">
            <button onClick={() => setCfg(ALERT_DEFAULTS)}
              className="text-[9px] text-[#52525b] hover:text-[#f4f4f5]">reset</button>
            <button onClick={() => setCfg(Object.fromEntries(Object.keys(ALERT_DEFAULTS).map(k => [k, false])) as AlertConfig)}
              className="text-[9px] text-[#52525b] hover:text-[#f4f4f5]">all off</button>
          </div>
        </div>
      )}
    </div>
  );
}
