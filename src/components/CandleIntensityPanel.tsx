import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";
import { INTENSITY_MODES, type IntensityMode } from "@/lib/chart/candle-intensity";

interface Props {
  onChange: (mode: IntensityMode) => void;
}

const STORAGE_KEY = "janus_candle_intensity_mode";

export function CandleIntensityPanel({ onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<IntensityMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return (saved as IntensityMode) || "off";
    } catch {
      return "off";
    }
  });

  // Emit on mount & change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    onChange(mode);
  }, [mode, onChange]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  const activeMode = INTENSITY_MODES.find((m) => m.mode === mode) || INTENSITY_MODES[0];

  return (
    <div ref={panelRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors",
          expanded
            ? "bg-[#18181b] text-[#f4f4f5] border-[#27272a]"
            : mode !== "off"
              ? "text-[#f59e0b] border-[#27272a] hover:text-[#fbbf24]"
              : "text-[#71717a] border-[#27272a] hover:text-[#f4f4f5]"
        )}
        title="Candle intensity heatmap"
      >
        <Flame size={11} />
        <span>Heat</span>
        {mode !== "off" && (
          <span className="text-[#f59e0b] tabular-nums text-[8px] font-bold">{activeMode.icon}</span>
        )}
      </button>

      {/* Dropdown */}
      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#09090b] border border-[#27272a] rounded-lg shadow-xl p-2 w-52">
          <div className="text-[9px] text-[#52525b] uppercase tracking-wide px-1 mb-1.5">
            Candle Intensity
          </div>
          <div className="text-[8px] text-[#3f3f46] px-1 mb-2">
            Color candles by metric strength
          </div>
          {INTENSITY_MODES.map((item) => {
            const isActive = mode === item.mode;
            return (
              <button
                key={item.mode}
                onClick={() => {
                  setMode(item.mode);
                  setExpanded(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] transition-colors mb-0.5",
                  isActive
                    ? "bg-[#18181b] text-[#f4f4f5]"
                    : "text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b]/50"
                )}
              >
                <span className="text-sm flex-shrink-0 w-5 text-center">{item.icon}</span>
                <div className="flex flex-col items-start gap-0">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[8px] text-[#52525b]">{item.description}</span>
                </div>
                {isActive && (
                  <span className="ml-auto text-[8px] font-bold text-[#f59e0b] px-1 rounded bg-[#f59e0b]/10">
                    ACTIVE
                  </span>
                )}
              </button>
            );
          })}

          {/* Gradient preview */}
          {mode !== "off" && (
            <div className="mt-2 pt-2 border-t border-[#27272a]">
              <div className="text-[8px] text-[#52525b] mb-1 px-1">Intensity scale</div>
              <div className="flex gap-1 px-1">
                <div className="flex-1 flex flex-col gap-0.5">
                  <div
                    className="h-3 rounded"
                    style={{
                      background: "linear-gradient(to right, hsl(174,55%,22%), hsl(160,70%,32%), hsl(148,80%,42%), hsl(142,90%,50%), hsl(130,100%,55%))",
                    }}
                  />
                  <span className="text-[7px] text-[#52525b] text-center">Bullish low → high</span>
                </div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <div
                    className="h-3 rounded"
                    style={{
                      background: "linear-gradient(to right, hsl(0,45%,25%), hsl(355,60%,32%), hsl(350,75%,42%), hsl(345,88%,50%), hsl(330,100%,55%))",
                    }}
                  />
                  <span className="text-[7px] text-[#52525b] text-center">Bearish low → high</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
