import { useState, useRef, useEffect } from "react";
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

// ─── Score bar ───
const ScoreBar = ({ score, color, label, weight }: { score: number; color: string; label: string; weight: string }) => (
  <div className="flex flex-col gap-1 flex-1">
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#71717a]">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[#52525b]">{weight}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{isNaN(score) ? "--" : score.toFixed(0)}</span>
      </div>
    </div>
    <div className="h-1.5 rounded-full bg-[#27272a] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, isNaN(score) ? 0 : score))}%`, background: color }} />
    </div>
  </div>
);

// ─── Signal Card ───
const SignalCard = ({ signal }: { signal: any }) => {
  const indicators = signal.metadata ? (typeof signal.metadata === "string" ? JSON.parse(signal.metadata) : signal.metadata) : {};
  const regime = getRegime(signal);
  const composite = parseFloat(signal.compositeScore);
  const micro = parseFloat(signal.microScore);
  const intra = parseFloat(signal.intraScore);
  const swing = parseFloat(signal.swingScore);
  const ts = signal.createdAt ? new Date(signal.createdAt) : null;
  const age = ts ? Math.floor((Date.now() - ts.getTime()) / 60000) : null;
  const sym = (signal.symbol || "").replace("B-", "").replace("_", "");
  const rsi = indicators.rsi ?? 50;
  const imbalance = indicators.imbalance ?? 0;

  return (
    <div
      className="rounded-lg border p-3 transition-all hover:brightness-110"
      style={{ background: regime.bg, borderColor: regime.border }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#f4f4f5]">{sym}</span>
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ color: regime.color, background: `${regime.color}22` }}
          >
            {signal.isGated ? <Unlock size={9} /> : <Lock size={9} />}
            {regime.label}
          </span>
        </div>
        <div className="text-right">
          <span className="text-xl font-black tabular-nums" style={{ color: isNaN(composite) ? "#71717a" : regime.color }}>
            {isNaN(composite) ? "--" : composite.toFixed(1)}
          </span>
          <span className="text-[9px] text-[#52525b] ml-0.5">/100</span>
        </div>
      </div>

      {/* Composite bar */}
      <div className="mb-2.5">
        <div className="h-1.5 rounded-full bg-[#27272a] overflow-hidden relative">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, isNaN(composite) ? 0 : composite)}%`, background: regime.color }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/25" style={{ left: "75%" }} />
        </div>
        <div className="flex justify-between text-[9px] text-[#52525b] mt-0.5">
          <span>0</span><span className="text-white/25">Gate 75</span><span>100</span>
        </div>
      </div>

      {/* Score bars */}
      <div className="flex flex-col gap-1.5 mb-2.5">
        <ScoreBar score={micro} color="#3b82f6" label="Micro" weight="20%" />
        <ScoreBar score={intra} color="#8b5cf6" label="Intraday" weight="45%" />
        <ScoreBar score={swing} color="#f59e0b" label="Swing" weight="35%" />
      </div>

      {/* Indicators */}
      <div className="grid grid-cols-3 gap-x-2 border-t border-[#27272a]/50 pt-2">
        <div>
          <div className="text-[9px] text-[#71717a]">Spread</div>
          <div className="text-xs text-[#f4f4f5] tabular-nums">{indicators.spread?.toFixed(4) ?? "--"}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#71717a]">Imbalance</div>
          <div className={cn("text-xs tabular-nums", imbalance >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}>
            {imbalance >= 0 ? "+" : ""}{imbalance.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#71717a]">RSI</div>
          <div className={cn("text-xs tabular-nums", rsi > 70 ? "text-[#ef4444]" : rsi < 30 ? "text-[#22c55e]" : "text-[#f4f4f5]")}>
            {rsi.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#52525b]">
        <span>{ts ? ts.toLocaleTimeString() : "--"}</span>
        <span className={cn(age !== null && age < 2 ? "text-[#22c55e]" : "")}>
          {age !== null ? (age === 0 ? "just now" : `${age}m ago`) : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Market Sentiment Gauge ───
const SentimentGauge = ({ signals }: { signals: any[] }) => {
  if (!signals || signals.length === 0) return null;

  // Compute weighted sentiment: long=+1, short=-1, neutral=0, weighted by composite score
  let weightedSum = 0;
  let totalWeight = 0;
  let bullCount = 0, bearCount = 0, neutCount = 0;

  for (const s of signals) {
    const score = parseFloat(s.compositeScore) || 0;
    const dir = s.direction;
    const regime = getRegime(s);
    totalWeight += score;
    if (regime.label === "BULLISH") { weightedSum += score; bullCount++; }
    else if (regime.label === "BEARISH") { weightedSum -= score; bearCount++; }
    else if (regime.label === "ACCUMULATION") { weightedSum += score * 0.5; neutCount++; }
    else if (regime.label === "DISTRIBUTION") { weightedSum -= score * 0.5; neutCount++; }
    else neutCount++;
    void dir;
  }

  // Normalize to -100..+100
  const raw = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  const sentiment = Math.max(-100, Math.min(100, raw));
  // Map to 0..100 for gauge position
  const pct = (sentiment + 100) / 2;

  const label = sentiment > 30 ? "BULLISH" : sentiment < -30 ? "BEARISH" : "NEUTRAL";
  const color = sentiment > 30 ? "#0ecb81" : sentiment < -30 ? "#f6465d" : "#f59e0b";
  const bgGrad = `linear-gradient(to right, #f6465d 0%, #f59e0b 50%, #0ecb81 100%)`;

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-[#71717a] mb-0.5">Market Sentiment</div>
          <div className="text-2xl font-black tracking-wide" style={{ color }}>{label}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[#71717a] mb-0.5">Score</div>
          <div className="text-2xl font-black tabular-nums" style={{ color }}>
            {sentiment > 0 ? "+" : ""}{sentiment.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Gauge bar */}
      <div className="relative mb-3">
        <div className="h-4 rounded-full overflow-hidden" style={{ background: bgGrad, opacity: 0.3 }} />
        <div className="absolute inset-0 h-4 rounded-full overflow-hidden" style={{ background: bgGrad, clipPath: `inset(0 ${100 - pct}% 0 0 round 9999px)` }} />
        {/* Needle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-[#09090b] shadow-lg transition-all duration-700"
          style={{ left: `calc(${pct}% - 6px)`, background: color }}
        />
        {/* Center line */}
        <div className="absolute top-0 bottom-0 w-px bg-[#52525b]/60" style={{ left: "50%" }} />
      </div>

      {/* Labels */}
      <div className="flex justify-between text-[10px] text-[#52525b] mb-3">
        <span className="text-[#f6465d]">◀ BEARISH</span>
        <span className="text-[#52525b]">NEUTRAL</span>
        <span className="text-[#0ecb81]">BULLISH ▶</span>
      </div>

      {/* Distribution pills */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#0ecb81]/10 text-[#0ecb81]">
          <span className="font-bold">{bullCount}</span> Bull
        </span>
        <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#52525b]/10 text-[#71717a]">
          <span className="font-bold">{neutCount}</span> Neutral
        </span>
        <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#f6465d]/10 text-[#f6465d]">
          <span className="font-bold">{bearCount}</span> Bear
        </span>
        <span className="ml-auto text-[10px] text-[#52525b]">{signals.length} pairs</span>
      </div>
    </div>
  );
};

// ─── Main Signals Page ───
const Signals = () => {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [analyzeTrigger, setAnalyzeTrigger] = useState(0);
  const [analyzeAllTrigger, setAnalyzeAllTrigger] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds

  const { data: signals, isLoading, refetch } = trpc.signal.latest.useQuery(
    { limit: 50 },
    { staleTime: 0 }
  );

  const { data: stats, refetch: refetchStats } = trpc.signal.stats.useQuery(undefined, {
    staleTime: 0,
  });

  const streamOptsRef = useRef({
    onData: (_: any) => {
      refetch();
      refetchStats();
      setLastUpdate(new Date());
    },
  });
  trpc.signal.stream.useSubscription(undefined, streamOptsRef.current);

  // Client-side interval trigger — fires analyzeAll at user-selected rate
  useEffect(() => {
    const id = setInterval(() => {
      setAnalyzeAllTrigger((prev) => prev + 1);
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [refreshInterval]);

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
    setTimeout(() => refetch(), 1500);
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
            <p className="text-[10px] text-[#71717a] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse inline-block" />
              Auto-refresh every {refreshInterval}s
              {lastUpdate && <span className="text-[#52525b]">· {lastUpdate.toLocaleTimeString()}</span>}
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
          {/* Interval selector */}
          <div className="flex items-center gap-1 bg-[#18181b] border border-[#27272a] rounded px-2 py-1">
            <RefreshCw size={10} className="text-[#71717a]" />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-transparent text-[10px] text-[#f4f4f5] outline-none"
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2m</option>
              <option value={300}>5m</option>
            </select>
          </div>
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

      {/* Stats + Gauge Row */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {/* Sentiment Gauge — spans 2 cols */}
          <div className="col-span-2 bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            {signals && signals.length > 0
              ? (() => {
                  let ws = 0, tw = 0, bull = 0, bear = 0, neut = 0;
                  for (const s of signals) {
                    const score = parseFloat(s.compositeScore) || 0;
                    const r = getRegime(s).label;
                    tw += score;
                    if (r === "BULLISH") { ws += score; bull++; }
                    else if (r === "BEARISH") { ws -= score; bear++; }
                    else if (r === "ACCUMULATION") { ws += score * 0.5; neut++; }
                    else if (r === "DISTRIBUTION") { ws -= score * 0.5; neut++; }
                    else neut++;
                  }
                  const sentiment = tw > 0 ? Math.max(-100, Math.min(100, (ws / tw) * 100)) : 0;
                  const pct = (sentiment + 100) / 2;
                  const slabel = sentiment > 30 ? "BULLISH" : sentiment < -30 ? "BEARISH" : "NEUTRAL";
                  const scolor = sentiment > 30 ? "#0ecb81" : sentiment < -30 ? "#f6465d" : "#f59e0b";
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] text-[#71717a]">Market Sentiment</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] tabular-nums text-[#52525b]">{sentiment > 0 ? "+" : ""}{sentiment.toFixed(0)}</span>
                          <span className="text-xs font-bold" style={{ color: scolor }}>{slabel}</span>
                        </div>
                      </div>
                      {/* Gauge bar */}
                      <div className="relative mb-1.5">
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: "linear-gradient(to right,#f6465d,#f59e0b 50%,#0ecb81)", opacity: 0.25 }} />
                        <div className="absolute inset-0 h-3 rounded-full overflow-hidden" style={{ background: "linear-gradient(to right,#f6465d,#f59e0b 50%,#0ecb81)", clipPath: `inset(0 ${100 - pct}% 0 0 round 9999px)` }} />
                        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-[#09090b] transition-all duration-700" style={{ left: `calc(${pct}% - 5px)`, background: scolor }} />
                        <div className="absolute top-0 bottom-0 w-px bg-[#52525b]/50" style={{ left: "50%" }} />
                      </div>
                      <div className="flex justify-between text-[9px] text-[#52525b] mb-2">
                        <span className="text-[#f6465d]">Bear</span>
                        <span>Neutral</span>
                        <span className="text-[#0ecb81]">Bull</span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0ecb81]/10 text-[#0ecb81]">{bull} Bull</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#52525b]/10 text-[#71717a]">{neut} Neutral</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f6465d]/10 text-[#f6465d]">{bear} Bear</span>
                      </div>
                    </>
                  );
                })()
              : <div className="text-[10px] text-[#52525b] flex items-center h-full">No signals yet</div>
            }
          </div>

          {/* Total Signals */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-1">Total Signals</div>
            <div className="text-lg font-bold text-[#f4f4f5] tabular-nums">{stats.total}</div>
            <div className="text-[9px] text-[#71717a]">avg {stats.avgComposite}</div>
            <div className="mt-1 text-[9px] text-[#0ecb81]">{stats.gated} gated · {stats.gatedPercent.toFixed(1)}%</div>
          </div>

          {/* Regime Breakdown */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-2">Regime Breakdown</div>
            <div className="flex flex-col gap-1">
              {([["BULLISH","#0ecb81"],["BEARISH","#f6465d"],["ACCUMULATION","#3b82f6"],["DISTRIBUTION","#f59e0b"]] as [string,string][]).map(([l,c]) => (
                <div key={l} className="flex items-center justify-between">
                  <span className="text-[9px]" style={{ color: c }}>{l.slice(0,5)}</span>
                  <span className="text-[9px] font-bold text-[#f4f4f5] tabular-nums">{regimeCounts[l] || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Low Signal */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-2">Low-Signal</div>
            <div className="flex flex-col gap-1">
              {([["RANGE","#71717a"],["NEUTRAL","#a1a1aa"],["AVOID","#ef4444"]] as [string,string][]).map(([l,c]) => (
                <div key={l} className="flex items-center justify-between">
                  <span className="text-[9px]" style={{ color: c }}>{l.slice(0,5)}</span>
                  <span className="text-[9px] font-bold text-[#f4f4f5] tabular-nums">{regimeCounts[l] || 0}</span>
                </div>
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
