import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import {
  Signal,
  RefreshCw,
  Lock,
  Unlock,
  Zap,
  Activity,
  ChevronRight,
} from "lucide-react";
import { checkKnnAlerts, ALERT_DEFAULTS, type KnnSnapshotLike } from "@/lib/chart/alert-engine";
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
      {indicators.bbUpper === undefined && indicators.rmi === undefined && indicators.rangeHigh === undefined && indicators.predictedHigh === undefined && indicators.bidDepth === undefined ? (
        <div className="flex flex-col gap-1.5 mb-2.5">
          <ScoreBar score={micro} color="#3b82f6" label="Micro" weight="20%" />
          <ScoreBar score={intra} color="#8b5cf6" label="Intraday" weight="45%" />
          <ScoreBar score={swing} color="#f59e0b" label="Swing" weight="35%" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mb-2.5">
          <ScoreBar score={composite} color={regime.color} label="Strategy Confidence" weight="100%" />
        </div>
      )}

      {/* Indicators */}
      {indicators.bbUpper !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#27272a]/50 pt-2 text-[10px] text-zinc-400">
          <div className="flex justify-between">
            <span>BB Upper</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.bbUpper.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>BB Lower</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.bbLower.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>RSI(14)</span>
            <span className={cn("font-mono font-bold", rsi > 70 ? "text-[#f6465d]" : rsi < 30 ? "text-[#0ecb81]" : "text-[#f4f4f5]")}>
              {rsi.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>MACD Hist</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.macdHistogram?.toFixed(4) ?? "--"}</span>
          </div>
        </div>
      ) : indicators.rmi !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#27272a]/50 pt-2 text-[10px] text-zinc-400">
          <div className="flex justify-between">
            <span>RMI</span>
            <span className={cn("font-mono font-bold", indicators.rmi > 70 ? "text-[#f6465d]" : indicators.rmi < 30 ? "text-[#0ecb81]" : "text-[#f4f4f5]")}>
              {indicators.rmi.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Trend EMA</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.trendEma?.toFixed(2) ?? "--"}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span>Regime</span>
            <span className={cn("font-bold uppercase", indicators.isUpTrend ? "text-[#0ecb81]" : "text-[#f6465d]")}>
              {indicators.isUpTrend ? "Uptrend" : "Downtrend"}
            </span>
          </div>
        </div>
      ) : indicators.rangeHigh !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#27272a]/50 pt-2 text-[10px] text-zinc-400">
          <div className="flex justify-between">
            <span>Range High</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.rangeHigh.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Range Low</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.rangeLow.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Mid Price</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.midPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Deviation</span>
            <span className="text-[#f4f4f5] font-mono">{(indicators.deviation * 100).toFixed(2)}%</span>
          </div>
        </div>
      ) : indicators.predictedHigh !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#27272a]/50 pt-2 text-[10px] text-zinc-400">
          <div className="flex justify-between">
            <span>ML Pred High</span>
            <span className="text-[#0ecb81] font-mono font-bold">{indicators.predictedHigh.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>ML Pred Low</span>
            <span className="text-[#f6465d] font-mono font-bold">{indicators.predictedLow.toFixed(2)}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span>Predicted Range</span>
            <span className="text-[#f4f4f5] font-mono font-bold">{indicators.predictedRange.toFixed(2)} USDT</span>
          </div>
        </div>
      ) : indicators.bidDepth !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#27272a]/50 pt-2 text-[10px] text-zinc-400">
          <div className="flex justify-between">
            <span>Bid Depth</span>
            <span className="text-[#0ecb81] font-mono">{indicators.bidDepth.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Ask Depth</span>
            <span className="text-[#f6465d] font-mono">{indicators.askDepth.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Spread</span>
            <span className="text-[#f4f4f5] font-mono">{indicators.spread?.toFixed(4) ?? "--"}</span>
          </div>
          <div className="flex justify-between">
            <span>Imbalance</span>
            <span className={cn("font-mono font-bold", indicators.imbalance >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}>
              {indicators.imbalance >= 0 ? "+" : ""}{indicators.imbalance.toFixed(2)}
            </span>
          </div>
        </div>
      ) : (
        <>
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
          {/* Microstructure Metrics */}
          {indicators.sweepScore !== undefined && (
            <div className="grid grid-cols-3 gap-x-2 border-t border-[#27272a]/30 pt-1.5 mt-1.5">
              <div>
                <div className="text-[8px] text-[#71717a] uppercase font-semibold">Sweep</div>
                <div className={cn("text-xs tabular-nums font-semibold", parseFloat(indicators.sweepScore) > 50 ? "text-[#ef4444]" : "text-[#e4e4e7]")}>
                  {parseFloat(indicators.sweepScore).toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[8px] text-[#71717a] uppercase font-semibold">Absorb</div>
                <div className={cn("text-xs tabular-nums font-semibold", parseFloat(indicators.absorptionScore) > 50 ? "text-[#22c55e]" : "text-[#e4e4e7]")}>
                  {parseFloat(indicators.absorptionScore).toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[8px] text-[#71717a] uppercase font-semibold">Regime</div>
                <div className={cn("text-[10px] font-bold tracking-tight uppercase", 
                  indicators.volatilityRegime === "HIGH" ? "text-[#ef4444]" : 
                  indicators.volatilityRegime === "LOW" ? "text-[#3b82f6]" : "text-[#a1a1aa]"
                )}>
                  {indicators.volatilityRegime || "NORMAL"}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* KNN SuperTrend badge */}
      {indicators.knn && (
        <div className="mt-2 border-t border-[#27272a]/40 pt-2">
          <div className="flex items-center gap-1 flex-wrap">
            {/* KNN bias chip */}
            <span className={cn(
              "inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide",
              indicators.knn.bias === "bullish" ? "bg-[#0ecb81]/15 text-[#0ecb81]" :
              indicators.knn.bias === "bearish" ? "bg-[#f6465d]/15 text-[#f6465d]" :
              "bg-[#71717a]/15 text-[#71717a]"
            )}>
              KNN {indicators.knn.bias}
            </span>
            {/* Confidence pill */}
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded font-bold tabular-nums",
              indicators.knn.confidence >= 75 ? "bg-[#0ecb81]/10 text-[#0ecb81]" :
              indicators.knn.confidence >= 55 ? "bg-[#f59e0b]/10 text-[#f59e0b]" :
              "bg-[#52525b]/10 text-[#52525b]"
            )}>
              {indicators.knn.confidence}%
            </span>
            {/* ST direction */}
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase",
              indicators.knn.stDirection === "bullish" ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-[#ef4444]/10 text-[#ef4444]"
            )}>
              ST {indicators.knn.stDirection}
              {indicators.knn.stFlip && " ↺"}
            </span>
            {/* Regime badge */}
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold ml-auto",
              indicators.knn.regime === "trend" ? "bg-[#3b82f6]/10 text-[#3b82f6]" :
              indicators.knn.regime === "weak_trend" ? "bg-[#8b5cf6]/10 text-[#8b5cf6]" :
              indicators.knn.regime === "range" ? "bg-[#71717a]/10 text-[#71717a]" :
              "bg-[#f59e0b]/10 text-[#f59e0b]"
            )}>
              {indicators.knn.regime?.replace("_", " ")}
            </span>
          </div>
          {/* Rejection orb row */}
          {indicators.knn.rejectionSignal && (
            <div className={cn(
              "mt-1 text-[9px] px-1.5 py-0.5 rounded font-semibold",
              indicators.knn.rejectionType === "bullish_rejection" ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"
            )}>
              Rejection orb • vol×{indicators.knn.volumeScore?.toFixed(1)} • wick/body {indicators.knn.wickToBody?.toFixed(1)}
            </div>
          )}
          {/* Note */}
          <div className="mt-0.5 text-[8px] text-[#52525b] leading-tight italic">
            {indicators.knn.note}
          </div>
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#52525b]">
        <span>{ts ? ts.toLocaleTimeString() : "--"}</span>
        <span className={cn(age !== null && age < 2 ? "text-[#22c55e]" : "")}>
          {age !== null ? (age === 0 ? "just now" : `${age}m ago`) : ""}
        </span>
      </div>
    </div>
  );
}


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
      // Only toast for auto-refresh, not user-triggered (those have their own toasts)
      if (analyzeTrigger === 0 && analyzeAllTrigger === 0) {
        toast("Signals refreshed", { duration: 2000, icon: "📡" });
      }
    },
  });
  trpc.signal.stream.useSubscription(undefined, streamOptsRef.current);

  // KNN SuperTrend alert stream — fires toast alerts on bias flips, rejection orbs, regime changes
  const knnPrevRef = useRef<Record<string, KnnSnapshotLike>>({});
  const knnStreamOptsRef = useRef({
    onData: (data: { symbol: string; snapshot: KnnSnapshotLike }) => {
      try {
        const stored = localStorage.getItem("janus_alert_cfg");
        const cfg = stored ? { ...ALERT_DEFAULTS, ...JSON.parse(stored) } : ALERT_DEFAULTS;
        const prev = knnPrevRef.current[data.symbol] ?? null;
        const alerts = checkKnnAlerts(data.snapshot, prev, cfg, data.symbol);
        knnPrevRef.current[data.symbol] = data.snapshot;

        for (const alert of alerts) {
          const color = alert.direction === "bullish" ? "#0ecb81" : alert.direction === "bearish" ? "#f6465d" : "#a1a1aa";
          toast(alert.message, {
            description: `${alert.symbol} · KNN`,
            duration: 6000,
            style: { borderLeft: `3px solid ${color}` },
          });
        }
      } catch { /* non-fatal */ }
    },
  });
  trpc.signal.knnStream.useSubscription(undefined, knnStreamOptsRef.current);

  // Client-side interval trigger — fires analyzeAll at user-selected rate
  useEffect(() => {
    const id = setInterval(() => {
      setAnalyzeAllTrigger((prev) => prev + 1);
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [refreshInterval]);

  const prevAnalyzing = useRef(false);
  const { isFetching: isAnalyzing } = trpc.signal.analyze.useQuery(
    { symbol: selectedSymbol },
    { enabled: analyzeTrigger > 0 }
  );
  useEffect(() => {
    if (prevAnalyzing.current && !isAnalyzing && analyzeTrigger > 0) {
      toast.success(`Analysis complete — ${selectedSymbol}`, { duration: 3000 });
      refetch();
    }
    prevAnalyzing.current = isAnalyzing;
  }, [isAnalyzing]);

  const prevAnalyzingAll = useRef(false);
  const { isFetching: isAnalyzingAll } = trpc.signal.analyzeAll.useQuery(
    undefined,
    { enabled: analyzeAllTrigger > 0 }
  );
  useEffect(() => {
    if (prevAnalyzingAll.current && !isAnalyzingAll && analyzeAllTrigger > 0) {
      const gated = signals?.filter((s) => s.isGated).length ?? 0;
      toast.success(`All pairs analyzed`, {
        description: gated > 0 ? `${gated} signal${gated !== 1 ? "s" : ""} gated (≥75)` : "No signals gated",
        duration: 4000,
      });
      refetch();
    }
    prevAnalyzingAll.current = isAnalyzingAll;
  }, [isAnalyzingAll]);

  const handleAnalyze = () => setAnalyzeTrigger((prev) => prev + 1);
  const handleAnalyzeAll = () => setAnalyzeAllTrigger((prev) => prev + 1);

  const [sortBy, setSortBy] = useState<"score-desc" | "score-asc" | "symbol" | "regime">("score-desc");
  const [filterRegime, setFilterRegime] = useState<string>("all");
  const [filterGated, setFilterGated] = useState<"all" | "gated" | "ungated">("all");

  const allSignals = signals || [];

  const filteredSorted = allSignals
    .filter((s) => {
      if (filterGated === "gated" && !s.isGated) return false;
      if (filterGated === "ungated" && s.isGated) return false;
      if (filterRegime !== "all" && getRegime(s).label !== filterRegime) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "score-desc") return parseFloat(b.compositeScore) - parseFloat(a.compositeScore);
      if (sortBy === "score-asc") return parseFloat(a.compositeScore) - parseFloat(b.compositeScore);
      if (sortBy === "symbol") return (a.symbol || "").localeCompare(b.symbol || "");
      if (sortBy === "regime") return getRegime(a).label.localeCompare(getRegime(b).label);
      return 0;
    });



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

      {/* Sort + Filter toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Filter: gated */}
        <div className="flex rounded overflow-hidden border border-[#27272a] text-[10px]">
          {(["all","gated","ungated"] as const).map((v) => (
            <button key={v} onClick={() => setFilterGated(v)}
              className={cn("px-2.5 py-1 capitalize transition-colors",
                filterGated === v ? "bg-[#27272a] text-[#f4f4f5]" : "bg-[#18181b] text-[#71717a] hover:text-[#f4f4f5]"
              )}>
              {v === "gated" ? "🔓 Gated" : v === "ungated" ? "🔒 Below" : "All"}
            </button>
          ))}
        </div>

        {/* Filter: regime */}
        <select
          value={filterRegime}
          onChange={(e) => setFilterRegime(e.target.value)}
          className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none"
        >
          <option value="all">All Regimes</option>
          {["BULLISH","BEARISH","ACCUMULATION","DISTRIBUTION","RANGE","NEUTRAL","AVOID"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none"
        >
          <option value="score-desc">Score ↓ High first</option>
          <option value="score-asc">Score ↑ Low first</option>
          <option value="symbol">Symbol A→Z</option>
          <option value="regime">Regime A→Z</option>
        </select>

        <span className="ml-auto text-[10px] text-[#52525b]">{filteredSorted.length} / {allSignals.length} signals</span>
      </div>

      {/* Signal Grid */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {filteredSorted.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredSorted.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-40 text-[#71717a] text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" />
            Loading signals...
          </div>
        )}

        {!isLoading && filteredSorted.length === 0 && allSignals.length > 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-[#71717a]">
            <p className="text-sm">No signals match current filters</p>
          </div>
        )}

        {!isLoading && allSignals.length === 0 && (
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
