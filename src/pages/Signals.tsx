import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  Signal,
  Activity,
  Zap,
  RefreshCw,
  ChevronRight,
  Lock,
  Unlock,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Market Regime Classifier ───
type Regime = "BULLISH" | "BEARISH" | "ACCUMULATION" | "DISTRIBUTION" | "RANGE" | "AVOID" | "NEUTRAL";

function getRegime(signal: any): { label: Regime; color: string; bg: string; border: string } {
  const composite = parseFloat(signal.compositeScore);
  const swing = parseFloat(signal.swingScore);
  const intra = parseFloat(signal.intraScore);
  const indicators = signal.metadata
    ? typeof signal.metadata === "string" ? JSON.parse(signal.metadata) : signal.metadata
    : {};
  const rsi: number = indicators.rsi ?? 50;
  const adx: number = indicators.trendStrength ?? 20;
  const imbalance: number = indicators.imbalance ?? 0;

  if (signal.isGated && signal.direction === "long") {
    return { label: "BULLISH",      color: "#0ecb81", bg: "rgba(14,203,129,0.08)",  border: "rgba(14,203,129,0.3)"  };
  }
  if (signal.isGated && signal.direction === "short") {
    return { label: "BEARISH",      color: "#f6465d", bg: "rgba(246,70,93,0.08)",   border: "rgba(246,70,93,0.3)"   };
  }
  // Non-gated regimes
  if (composite < 40) {
    return { label: "AVOID",        color: "#ef4444", bg: "rgba(239,68,68,0.06)",   border: "rgba(239,68,68,0.2)"   };
  }
  if (adx < 18 && Math.abs(imbalance) < 0.15) {
    return { label: "RANGE",        color: "#71717a", bg: "rgba(113,113,122,0.06)", border: "rgba(113,113,122,0.2)" };
  }
  if (rsi < 38 && swing > 48 && intra < 50) {
    return { label: "ACCUMULATION", color: "#3b82f6", bg: "rgba(59,130,246,0.06)",  border: "rgba(59,130,246,0.2)"  };
  }
  if (rsi > 62 && swing < 52 && intra > 50) {
    return { label: "DISTRIBUTION", color: "#f59e0b", bg: "rgba(245,158,11,0.06)",  border: "rgba(245,158,11,0.2)"  };
  }
  return   { label: "NEUTRAL",      color: "#a1a1aa", bg: "rgba(161,161,170,0.05)", border: "rgba(161,161,170,0.15)"};
}

// ─── Score Ring Component ───
const ScoreRing = ({ score, label, color }: { score: number; label: string; color: string }) => {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke="#27272a"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold tabular-nums" style={{ color }}>
            {score.toFixed(0)}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-[#71717a]">{label}</span>
    </div>
  );
}

// ─── Signal Card ───
const SignalCard = ({ signal }: { signal: any }) => {
  const indicators = signal.metadata ? (typeof signal.metadata === "string" ? JSON.parse(signal.metadata) : signal.metadata) : {};
  const regime = getRegime(signal);

  return (
    <div
      className="rounded-lg border p-3 transition-all"
      style={{ background: regime.bg, borderColor: regime.border }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#f4f4f5]">{signal.symbol.replace("B-", "").replace("_", "")}</span>
          <span
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold"
            style={{ color: regime.color, background: `${regime.color}18` }}
          >
            {signal.isGated ? <Unlock size={9} /> : <Lock size={9} />}
            {regime.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Target size={10} style={{ color: regime.color }} />
          <span className="text-lg font-bold tabular-nums" style={{ color: regime.color }}>
            {parseFloat(signal.compositeScore).toFixed(1)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-around mb-2">
        <ScoreRing score={parseFloat(signal.microScore)} label="Micro" color="#3b82f6" />
        <ScoreRing score={parseFloat(signal.intraScore)} label="Intra" color="#8b5cf6" />
        <ScoreRing score={parseFloat(signal.swingScore)} label="Swing" color="#f59e0b" />
      </div>

      {indicators && (
        <div className="grid grid-cols-3 gap-1 text-[9px] text-[#71717a]">
          <div className="flex justify-between">
            <span>Spread</span>
            <span className="text-[#f4f4f5] tabular-nums">{indicators.spread?.toFixed(4) || "--"}</span>
          </div>
          <div className="flex justify-between">
            <span>Imbal</span>
            <span
              className={cn(
                "tabular-nums",
                (indicators.imbalance || 0) > 0 ? "text-[#22c55e]" : "text-[#ef4444]"
              )}
            >
              {(indicators.imbalance || 0) > 0 ? "+" : ""}
              {(indicators.imbalance || 0).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>RSI</span>
            <span className="text-[#f4f4f5] tabular-nums">{(indicators.rsi || 50).toFixed(1)}</span>
          </div>
        </div>
      )}

      <div className="mt-2 text-[9px] text-[#52525b]">
        {new Date(signal.createdAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ─── Main Signals Page ───
const Signals = () => {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [analyzeTrigger, setAnalyzeTrigger] = useState(0);
  const [analyzeAllTrigger, setAnalyzeAllTrigger] = useState(0);

  const { data: signals, isLoading, refetch } = trpc.signal.latest.useQuery(
    { limit: 50 },
    { refetchInterval: 10000 }
  );

  const { data: stats } = trpc.signal.stats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { isFetching: isAnalyzing } = trpc.signal.analyze.useQuery(
    { symbol: selectedSymbol },
    { enabled: analyzeTrigger > 0 }
  );

  const { isFetching: isAnalyzingAll } = trpc.signal.analyzeAll.useQuery(
    undefined,
    { enabled: analyzeAllTrigger > 0 }
  );

  const handleAnalyze = () => {
    setAnalyzeTrigger((prev) => prev + 1);
    setTimeout(() => refetch(), 2000);
  };

  const handleAnalyzeAll = () => {
    setAnalyzeAllTrigger((prev) => prev + 1);
    setTimeout(() => refetch(), 3000);
  };

  const gatedSignals = signals?.filter((s) => s.isGated) || [];
  const neutralSignals = signals?.filter((s) => !s.isGated) || [];

  const regimeCounts = signals?.reduce((acc: Record<string, number>, s) => {
    const r = getRegime(s).label;
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {}) ?? {};

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Signal size={18} className="text-[#22c55e]" />
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">Confluence Signal Engine</h2>
            <p className="text-[10px] text-[#71717a]">
              Multi-timeframe analysis with 75-point threshold gating
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none"
          >
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
            <option value="XRPUSDT">XRPUSDT</option>
          </select>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#22c55e]/10 text-[#22c55e] text-xs hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
            Analyze
          </button>
          <button
            onClick={handleAnalyzeAll}
            disabled={isAnalyzingAll}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#18181b] text-[#71717a] text-xs hover:text-[#f4f4f5] transition-colors disabled:opacity-50 border border-[#27272a]"
          >
            <Activity size={12} />
            All Pairs
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-1">Total Signals</div>
            <div className="text-lg font-bold text-[#f4f4f5] tabular-nums">{stats.total}</div>
            <div className="text-[9px] text-[#71717a]">avg {stats.avgComposite}</div>
          </div>
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-1">Gated (≥75)</div>
            <div className="text-lg font-bold text-[#0ecb81] tabular-nums">{stats.gated}</div>
            <div className="text-[9px] text-[#71717a]">{stats.gatedPercent.toFixed(1)}% pass rate</div>
          </div>
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-2">Regime Breakdown</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {[
                ["BULLISH", "#0ecb81"],
                ["BEARISH", "#f6465d"],
                ["ACCUMULATION", "#3b82f6"],
                ["DISTRIBUTION", "#f59e0b"],
              ].map(([label, color]) => (
                <span key={label} className="text-[9px] tabular-nums" style={{ color }}>
                  {label.slice(0, 4)} {regimeCounts[label] || 0}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-2">Low-Signal</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {[
                ["RANGE", "#71717a"],
                ["NEUTRAL", "#a1a1aa"],
                ["AVOID", "#ef4444"],
              ].map(([label, color]) => (
                <span key={label} className="text-[9px] tabular-nums" style={{ color }}>
                  {label.slice(0, 5)} {regimeCounts[label] || 0}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-[#71717a]">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
          Microstructure (20%)
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
          Intraday (45%)
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
          Swing (35%)
        </div>
        <div className="flex items-center gap-1">
          <ChevronRight size={10} />
          Gate Threshold: 75
        </div>
      </div>

      {/* Signal Grid */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {gatedSignals.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Unlock size={12} className="text-[#22c55e]" />
              <span className="text-xs font-semibold text-[#22c55e]">Gated Signals (Execution Ready)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {gatedSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          </div>
        )}

        {neutralSignals.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} className="text-[#71717a]" />
              <span className="text-xs font-semibold text-[#71717a]">Neutral Signals (Below Threshold)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {neutralSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-40 text-[#71717a] text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" />
            Loading signals...
          </div>
        )}

        {!isLoading && (!signals || signals.length === 0) && (
          <div className="flex flex-col items-center justify-center h-40 text-[#71717a]">
            <Signal size={24} className="mb-2 opacity-30" />
            <p className="text-sm">No signals generated yet</p>
            <p className="text-[10px]">Click "Analyze" to generate confluence signals</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Signals;
