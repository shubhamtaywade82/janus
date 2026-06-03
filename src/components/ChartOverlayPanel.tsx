import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";

export interface OverlayToggles {
  swings:       boolean;
  orderBlocks:  boolean;
  fvg:          boolean;
  structure:    boolean;
  liquidity:    boolean;
  displacement: boolean;
  premiumDiscount: boolean;
  obv:          boolean;
}

const DEFAULTS: OverlayToggles = {
  swings:          true,
  orderBlocks:     true,
  fvg:             true,
  structure:       true,
  liquidity:       true,
  displacement:    false,
  premiumDiscount: false,
  obv:             false,
};

const LAYERS: { key: keyof OverlayToggles; label: string; color: string; shortLabel: string }[] = [
  { key: "swings",          label: "Swing H/L",       shortLabel: "SwG",  color: "#71717a" },
  { key: "orderBlocks",     label: "Order Blocks",     shortLabel: "OB",   color: "hsl(var(--janus-up))" },
  { key: "fvg",             label: "Fair Value Gap",   shortLabel: "FVG",  color: "#a855f7" },
  { key: "structure",       label: "BOS / CHoCH",      shortLabel: "STR",  color: "#3b82f6" },
  { key: "liquidity",       label: "EQH / EQL",        shortLabel: "LIQ",  color: "hsl(var(--janus-down))" },
  { key: "displacement",    label: "Displacement",     shortLabel: "DIS",  color: "#f59e0b" },
  { key: "premiumDiscount", label: "Prem / Disc",      shortLabel: "P/D",  color: "#52525b" },
  { key: "obv",             label: "OBV",              shortLabel: "OBV",  color: "#06b6d4" },
];

interface Props {
  onChange: (toggles: OverlayToggles) => void;
}

export function ChartOverlayPanel({ onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [toggles, setToggles] = useState<OverlayToggles>(() => {
    try {
      const saved = localStorage.getItem("janus_chart_overlays");
      return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
    } catch { return DEFAULTS; }
  });

  useEffect(() => {
    localStorage.setItem("janus_chart_overlays", JSON.stringify(toggles));
    onChange(toggles);
  }, [toggles, onChange]);

  const flip = (key: keyof OverlayToggles) => {
    setToggles((t) => ({ ...t, [key]: !t[key] }));
  };

  const activeCount = Object.values(toggles).filter(Boolean).length;

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors",
          expanded
            ? "bg-[#18181b] text-[#f4f4f5] border-[#27272a]"
            : "text-[#71717a] border-[#27272a] hover:text-[#f4f4f5]"
        )}
        title="SMC / ICT overlays"
      >
        <Layers size={11} />
        <span>SMC</span>
        {activeCount > 0 && (
          <span className="text-[#a855f7] tabular-nums">{activeCount}</span>
        )}
      </button>

      {/* Dropdown */}
      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#09090b] border border-[#27272a] rounded-lg shadow-xl p-2 w-44">
          <div className="text-[9px] text-[#52525b] uppercase tracking-wide px-1 mb-1.5">Chart Overlays</div>
          {LAYERS.map((layer) => {
            const on = toggles[layer.key];
            return (
              <button
                key={layer.key}
                onClick={() => flip(layer.key)}
                className={cn(
                  "w-full flex items-center justify-between px-2 py-1 rounded text-[10px] transition-colors mb-0.5",
                  on ? "bg-[#18181b] text-[#f4f4f5]" : "text-[#52525b] hover:text-[#f4f4f5]"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: on ? layer.color : "#3f3f46" }}
                  />
                  <span>{layer.label}</span>
                </div>
                <span className={cn(
                  "text-[8px] font-bold px-1 rounded",
                  on ? "bg-[#27272a] text-[#a1a1aa]" : "text-[#3f3f46]"
                )}>
                  {on ? "ON" : "OFF"}
                </span>
              </button>
            );
          })}
          <div className="border-t border-[#27272a] mt-1.5 pt-1.5 flex gap-1">
            <button
              onClick={() => setToggles(DEFAULTS)}
              className="flex-1 text-[9px] text-[#52525b] hover:text-[#f4f4f5] py-0.5"
            >reset</button>
            <button
              onClick={() => setToggles(Object.fromEntries(LAYERS.map((l) => [l.key, false])) as OverlayToggles)}
              className="flex-1 text-[9px] text-[#52525b] hover:text-[#f4f4f5] py-0.5"
            >clear all</button>
          </div>
        </div>
      )}
    </div>
  );
}
