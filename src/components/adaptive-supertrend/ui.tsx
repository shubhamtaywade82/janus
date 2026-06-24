import { useState, type CSSProperties, type ReactNode } from "react";
import type { AdaptiveSupertrendParams, AdaptiveTrade } from "@/lib/adaptive-supertrend";
import { FEE_RT, SLIP_RT, fmtTime } from "@/lib/adaptive-supertrend";
import { AST_COLORS as C } from "./theme";

function buildPineScript(params: AdaptiveSupertrendParams): string {
  return `// ============================================
// Adaptive Supertrend — Crypto Futures v6
// Params: ATR=${params.atrPeriod} ER=${params.erLength} Sm=${params.smoothLength}
//         minF=${params.minFactor} maxF=${params.maxFactor}
// ============================================
//@version=6
strategy(
    title="Adaptive ST Futures v6", shorttitle="AST_v6",
    overlay=true, initial_capital=10000,
    default_qty_type=strategy.percent_of_equity,
    default_qty_value=10, margin_long=100, margin_short=100,
    commission_type=strategy.commission.percent,
    commission_value=0.04, slippage=2,
    process_orders_on_close=true
)

var G_ST = "Adaptive Supertrend"
atrPeriod    = input.int(${params.atrPeriod},   "ATR Period",    minval=1, group=G_ST)
minFactor    = input.float(${params.minFactor}, "Min Multiplier",step=0.1, group=G_ST)
maxFactor    = input.float(${params.maxFactor}, "Max Multiplier",step=0.1, group=G_ST)

var G_ER = "Efficiency Engine"
erLength     = input.int(${params.erLength},    "ER Window",     minval=2, group=G_ER)
smoothLength = input.int(${params.smoothLength},"EMA Smooth",    minval=1, group=G_ER)

float net    = math.abs(close - close[erLength])
float path   = ta.sma(math.abs(close - close[1]), erLength) * erLength
float er     = path > 0 ? net / path : 0.0

float rawF   = maxFactor - (er * (maxFactor - minFactor))
float dynF   = ta.ema(rawF, smoothLength)

f_ast(series float dyn, int per) =>
    float hl2  = (high + low) / 2
    float atrV = ta.atr(per)
    var float fl = na
    var float fu = na
    var int   d  = 1
    float bL = hl2 - dyn * atrV
    float bU = hl2 + dyn * atrV
    float pfl = not na(fl[1]) ? fl[1] : bL
    float pfu = not na(fu[1]) ? fu[1] : bU
    fl := close[1] > pfl ? math.max(bL, pfl) : bL
    fu := close[1] < pfu ? math.min(bU, pfu) : bU
    int pd = not na(d[1]) ? d[1] : 1
    if   pd ==  1 and close < fl => d := -1
    elif pd == -1 and close > fu => d :=  1
    else                           d := pd
    [d == 1 ? fl : fu, d]

[stLine, stDir] = f_ast(dynF, atrPeriod)

bool isUp    = stDir ==  1
bool isDown  = stDir == -1
bool flipped = ta.change(stDir) != 0

float stopDist = math.max(math.abs(close - stLine), syminfo.mintick)
float qty      = (strategy.equity * 0.01) / stopDist
if math.isnan(qty) or qty <= 0
    qty := strategy.default_entry_qty(close)

if isUp  and flipped => strategy.entry("Long",  strategy.long,  qty=qty)
if isDown and flipped => strategy.entry("Short", strategy.short, qty=qty)

if isDown and strategy.position_size > 0 => strategy.close("Long",  comment="ST▼")
if isUp   and strategy.position_size < 0 => strategy.close("Short", comment="ST▲")

plot(stLine, "Adaptive ST",    isUp ? color.teal : color.red, linewidth=2)
plot(dynF,   "Live Factor",    color.purple, display=display.data_window)
plot(er,     "Efficiency (ER)",color.orange, display=display.data_window)
bgcolor(isUp ? color.new(color.teal,96) : color.new(color.red,96))
`;
}

interface PineModalProps {
  params: AdaptiveSupertrendParams;
  onClose: () => void;
}

export function PineModal({ params, onClose }: PineModalProps) {
  const [copied, setCopied] = useState(false);
  const script = buildPineScript(params);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[740px] flex-col overflow-hidden rounded-xl border border-[#1a2035] bg-[#0d1018]"
      >
        <div className="flex items-center justify-between border-b border-[#1a2035] px-[18px] py-3">
          <span className="text-xs font-bold text-[#dde3f0]">Pine Script v6 Export</span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(script);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="cursor-pointer rounded-md border border-[#00d4aa] px-3.5 py-1.5 font-mono text-[11px] text-[#00d4aa]"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="cursor-pointer rounded-md border border-[#1a2035] px-3 py-1.5 text-[11px] text-[#5a6480]"
            >
              ✕
            </button>
          </div>
        </div>
        <pre className="m-0 flex-1 overflow-auto bg-[#060810] p-[14px_18px] font-mono text-[10.5px] leading-relaxed text-[#7dd3b0]">
          {script}
        </pre>
      </div>
    </div>
  );
}

interface PillProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string;
}

export function Pill({ children, active, onClick, color }: PillProps) {
  const c = color || C.accent;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 5,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "monospace",
        fontWeight: active ? 700 : 400,
        background: active ? `${c}22` : "transparent",
        border: `1px solid ${active ? `${c}66` : C.border}`,
        color: active ? c : C.sub,
        transition: "all 0.12s",
      }}
    >
      {children}
    </button>
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
    <div className="mb-3">
      <div className="mb-1 flex justify-between">
        <span className="text-[10px]" style={{ color: C.label }}>
          {label}
        </span>
        <span className="font-mono text-[10px]" style={{ color: color || C.accent }}>
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
        onChange={(e) => onChange(+e.target.value)}
        className="w-full cursor-pointer"
        style={{ accentColor: color || C.accent }}
      />
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  color?: string;
  mono?: boolean;
}

export function StatRow({ label, value, color, mono }: StatRowProps) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[10px]" style={{ color: C.sub }}>
        {label}
      </span>
      <span
        className="text-[11px] font-semibold"
        style={{ fontFamily: mono ? "monospace" : undefined, color: color || C.text }}
      >
        {value}
      </span>
    </div>
  );
}

interface PanelProps {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function Panel({ title, children, style }: PanelProps) {
  return (
    <div
      className="mb-2.5 overflow-hidden rounded-[10px] border border-[#1a2035] bg-[#0d1018]"
      style={style}
    >
      {title && (
        <div
          className="border-b border-[#1a2035] px-3.5 py-2 text-[10px] uppercase tracking-wider"
          style={{ color: C.label }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

interface TradeLogProps {
  trades: AdaptiveTrade[];
}

export function TradeLog({ trades }: TradeLogProps) {
  const [page, setPage] = useState(0);
  const PAGE = 20;
  const total = trades.length;
  const slice = trades.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(total / PAGE);

  if (!total) {
    return (
      <div className="p-5 text-center text-[11px]" style={{ color: C.sub }}>
        No trades in current dataset
      </div>
    );
  }

  const TH = ({ children, right }: { children: ReactNode; right?: boolean }) => (
    <th
      className="border-b border-[#1a2035] bg-[#111520] px-2.5 py-1.5 text-[9px] font-semibold tracking-wider"
      style={{ color: C.sub, textAlign: right ? "right" : "left" }}
    >
      {children}
    </th>
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <TH>#</TH>
              <TH>Dir</TH>
              <TH>Entry</TH>
              <TH>Exit</TH>
              <TH right>Entry $</TH>
              <TH right>Exit $</TH>
              <TH right>Raw%</TH>
              <TH right>Net%</TH>
              <TH right>Bars</TH>
              <TH right>Equity</TH>
            </tr>
          </thead>
          <tbody>
            {slice.map((t) => (
              <tr
                key={t.n}
                className="border-b border-[#1a2035]/10"
                style={{ background: t.n % 2 === 0 ? "#11152099" : "transparent" }}
              >
                <td className="px-2.5 py-1 font-mono" style={{ color: C.sub }}>
                  {t.n}
                </td>
                <td className="px-2.5 py-1">
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                    style={{
                      background: t.dir === "Long" ? `${C.accent}22` : `${C.red}22`,
                      color: t.dir === "Long" ? C.accent : C.red,
                    }}
                  >
                    {t.dir}
                  </span>
                </td>
                <td className="px-2.5 py-1 text-[9px]" style={{ color: C.sub }}>
                  {fmtTime(t.entryTime)}
                </td>
                <td className="px-2.5 py-1 text-[9px]" style={{ color: C.sub }}>
                  {fmtTime(t.exitTime)}
                </td>
                <td className="px-2.5 py-1 text-right font-mono" style={{ color: C.label }}>
                  {(+t.entryPrice).toFixed(2)}
                </td>
                <td className="px-2.5 py-1 text-right font-mono" style={{ color: C.label }}>
                  {(+t.exitPrice).toFixed(2)}
                </td>
                <td
                  className="px-2.5 py-1 text-right font-mono"
                  style={{ color: +t.rawPnlPct >= 0 ? C.accent : C.red }}
                >
                  {t.rawPnlPct}%
                </td>
                <td
                  className="px-2.5 py-1 text-right font-mono font-bold"
                  style={{ color: +t.netPnlPct >= 0 ? C.accent : C.red }}
                >
                  {t.netPnlPct}%
                </td>
                <td className="px-2.5 py-1 text-right font-mono" style={{ color: C.sub }}>
                  {t.bars}
                </td>
                <td className="px-2.5 py-1 text-right font-mono" style={{ color: C.text }}>
                  ${(+t.equity).toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex justify-center gap-1.5 p-2.5">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="rounded border px-2.5 py-0.5 text-[10px] disabled:cursor-default"
            style={{
              borderColor: C.border,
              color: page === 0 ? C.border : C.sub,
              cursor: page === 0 ? "default" : "pointer",
            }}
          >
            ←
          </button>
          <span className="text-[10px] leading-[22px]" style={{ color: C.sub }}>
            {page + 1}/{pages} · {total} trades
          </span>
          <button
            onClick={() => setPage(Math.min(pages - 1, page + 1))}
            disabled={page === pages - 1}
            className="rounded border px-2.5 py-0.5 text-[10px] disabled:cursor-default"
            style={{
              borderColor: C.border,
              color: page === pages - 1 ? C.border : C.sub,
              cursor: page === pages - 1 ? "default" : "pointer",
            }}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

export function FeeNote() {
  return (
    <div className="mt-2 text-[9px] leading-snug" style={{ color: C.sub }}>
      Fee {(FEE_RT * 100).toFixed(2)}% + slip {(SLIP_RT * 100).toFixed(2)}%/RT
      <br />
      1% equity risk/trade
    </div>
  );
}
