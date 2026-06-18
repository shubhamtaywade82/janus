import { useState } from "react";
import type { AdaptiveSupertrendParams } from "@/lib/adaptive-supertrend";
import { AST_COLORS as C } from "./theme";

function buildPineScript(params: AdaptiveSupertrendParams): string {
  return `// ===================================================
// Adaptive Supertrend Strategy — Crypto Futures v6
// Tuned: ATR=${params.atrPeriod} | ER=${params.erLength} | Smooth=${params.smoothLength}
//        MinF=${params.minFactor} | MaxF=${params.maxFactor}
// ===================================================
//@version=6
strategy(
    title="Adaptive ST Futures v6", shorttitle="AST_F_v6",
    overlay=true, initial_capital=10000,
    default_qty_type=strategy.percent_of_equity,
    default_qty_value=10, margin_long=100, margin_short=100,
    process_orders_on_close=true
)

// ── Inputs ──────────────────────────────────────────
var string G_ST = "Adaptive Supertrend"
atrPeriod    = input.int(${params.atrPeriod},  "ATR Window",       minval=1, group=G_ST)
minFactor    = input.float(${params.minFactor},"Min Multiplier",   step=0.1, group=G_ST)
maxFactor    = input.float(${params.maxFactor},"Max Multiplier",   step=0.1, group=G_ST)

var string G_ER = "Efficiency Engine"
erLength     = input.int(${params.erLength},   "ER Window",        minval=2, group=G_ER)
smoothLength = input.int(${params.smoothLength},"EMA Smooth",      minval=1, group=G_ER)

// ── Kaufman Efficiency Ratio ─────────────────────────
float netMove    = math.abs(close - close[erLength])
float totalPath  = ta.sma(math.abs(close - close[1]), erLength) * erLength
float er         = totalPath > 0 ? netMove / totalPath : 0.0

// ── Dynamic Multiplier ───────────────────────────────
float rawFactor     = maxFactor - (er * (maxFactor - minFactor))
float smoothedFactor = ta.ema(rawFactor, smoothLength)

// ── Custom Series-Compatible Supertrend ─────────────
f_adaptive_supertrend(series float dyn_factor, int period) =>
    float hl2_src = (high + low) / 2
    float atr_val = ta.atr(period)
    var float f_lower = na
    var float f_upper = na
    var int   st_dir  = 1

    float b_lower = hl2_src - (dyn_factor * atr_val)
    float b_upper = hl2_src + (dyn_factor * atr_val)
    float pfl = not na(f_lower[1]) ? f_lower[1] : b_lower
    float pfu = not na(f_upper[1]) ? f_upper[1] : b_upper

    f_lower := close[1] > pfl ? math.max(b_lower, pfl) : b_lower
    f_upper := close[1] < pfu ? math.min(b_upper, pfu) : b_upper

    int prev_dir = not na(st_dir[1]) ? st_dir[1] : 1
    if   prev_dir ==  1 and close < f_lower => st_dir := -1
    elif prev_dir == -1 and close > f_upper => st_dir :=  1
    else                                      st_dir := prev_dir

    [st_dir == 1 ? f_lower : f_upper, st_dir]

[stLine, stDir] = f_adaptive_supertrend(smoothedFactor, atrPeriod)

// ── Signals ──────────────────────────────────────────
bool isUp    = stDir ==  1
bool isDown  = stDir == -1
bool flipped = ta.change(stDir) != 0

// ── Risk-Sized Position Entry ────────────────────────
float riskDist = math.max(math.abs(close - stLine), syminfo.mintick)
float qty      = (strategy.equity * 0.01) / riskDist
if math.isnan(qty) or qty <= 0
    qty := strategy.default_entry_qty(close)

if isUp  and flipped => strategy.entry("Long",  strategy.long,  qty=qty)
if isDown and flipped => strategy.entry("Short", strategy.short, qty=qty)

if isDown and strategy.position_size > 0 => strategy.close("Long",  comment="ST Exit")
if isUp   and strategy.position_size < 0 => strategy.close("Short", comment="ST Exit")

// ── Visuals ──────────────────────────────────────────
plot(stLine,       "Adaptive ST",      isUp ? color.teal : color.red,  linewidth=2)
plot(smoothedFactor, "Live Factor",    color.purple, display=display.data_window)
plot(er,             "Efficiency (ER)", color.orange, display=display.data_window)

bgcolor(isUp ? color.new(color.teal, 95) : color.new(color.red, 95))
`;
}

interface PineModalProps {
  params: AdaptiveSupertrendParams;
  onClose: () => void;
}

export function PineModal({ params, onClose }: PineModalProps) {
  const script = buildPineScript(params);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-j-border bg-j-surface"
      >
        <div className="flex items-center justify-between border-b border-j-border px-5 py-4">
          <span className="text-sm font-semibold text-j-text">Pine Script v6 — Export</span>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="cursor-pointer rounded-md border border-j-up px-3.5 py-1.5 font-mono text-[11px] text-j-up"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="cursor-pointer rounded-md border border-j-border px-3 py-1.5 text-[11px] text-j-text-3"
            >
              ✕
            </button>
          </div>
        </div>
        <pre className="m-0 flex-1 overflow-auto bg-[#070910] p-5 font-mono text-[11px] leading-relaxed text-[#a5f3cf]">
          {script}
        </pre>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  sub?: string;
}

export function StatCard({ label, value, unit, color, sub }: StatCardProps) {
  return (
    <div className="min-w-[100px] flex-1 rounded-lg border border-j-border bg-j-surface px-4 py-3.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-j-text-3">{label}</div>
      <div
        className="font-mono text-[22px] font-bold leading-none"
        style={{ color: color || C.text }}
      >
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-normal text-j-text-3">{unit}</span>
        )}
      </div>
      {sub && <div className="mt-1.5 text-[10px] text-j-text-3">{sub}</div>}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color?: string;
  unit?: string;
}

export function Slider({ label, value, min, max, step, onChange, color, unit }: SliderProps) {
  return (
    <div className="mb-3.5">
      <div className="mb-1 flex justify-between">
        <span className="text-[11px] text-j-text-2">{label}</span>
        <span className="font-mono text-[11px]" style={{ color: color || C.accent }}>
          {value}
          {unit || ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: color || C.accent }}
      />
    </div>
  );
}
