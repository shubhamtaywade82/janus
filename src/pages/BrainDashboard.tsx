import { useState, useEffect, useRef, useMemo } from "react";
import { Brain, Zap, GitBranch, Lightbulb, RefreshCw, Terminal, Trash2, PanelRight, ChevronDown, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

export default function BrainDashboard() {
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"episodes" | "strategies" | "reflections">("episodes");
  const [logs, setLogs] = useState<string[]>([]);
  const [logStatus, setLogStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  // Signal trigger state
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerSymbol, setTriggerSymbol] = useState("B-BTC_USDT");
  const [triggerDirection, setTriggerDirection] = useState<"long" | "short">("long");
  const [triggerScore, setTriggerScore] = useState(85);
  const [triggerSl, setTriggerSl] = useState("1.5");
  const [triggerTp, setTriggerTp] = useState("1.5");
  const [triggerTrailing, setTriggerTrailing] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState<any>(null);
  // Mode state
  const [tradingMode, setTradingMode] = useState<"paper" | "live" | "unknown">("unknown");

  // Capital mode and values
  const [capitalMode, setCapitalMode] = useState<"pct" | "fixed">("pct");
  const [triggerCapitalPct, setTriggerCapitalPct] = useState(30);
  const [triggerCapitalFixed, setTriggerCapitalFixed] = useState("50");
  const [triggerLeverage, setTriggerLeverage] = useState("10");

  // Fetch paper wallet details if in paper mode
  const { data: paperWalletData } = trpc.autoExecutor.paperWallet.useQuery(
    undefined,
    { enabled: tradingMode === "paper", refetchInterval: 5000 }
  );

  // Fetch live portfolio details if in live mode
  const { data: livePortfolioData } = trpc.trading.portfolio.useQuery(
    undefined,
    { enabled: tradingMode === "live", refetchInterval: 5000 }
  );

  const usdtInrRate = livePortfolioData ? parseFloat(livePortfolioData.usdtInrRate || "89.0") : 89.0;
  const isPaper = tradingMode === "paper";

  const availableEquity = useMemo(() => {
    if (isPaper) {
      return paperWalletData?.equity ?? 10000;
    } else {
      return livePortfolioData?.totalEquity ?? 0;
    }
  }, [isPaper, paperWalletData, livePortfolioData]);

  const availableToTrade = useMemo(() => {
    if (isPaper) {
      return paperWalletData?.balance ?? 10000;
    } else {
      if (!livePortfolioData) return 0;
      const rawAvail = parseFloat(livePortfolioData.availableInr || "0");
      const isCcyInr = livePortfolioData.walletCurrency === "INR";
      return isCcyInr ? rawAvail / usdtInrRate : rawAvail;
    }
  }, [isPaper, paperWalletData, livePortfolioData, usdtInrRate]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const SYMBOLS = [
    { value: "B-BTC_USDT", label: "BTC/USDT" },
    { value: "B-ETH_USDT", label: "ETH/USDT" },
    { value: "B-SOL_USDT", label: "SOL/USDT" },
    { value: "B-BNB_USDT", label: "BNB/USDT" },
    { value: "B-XRP_USDT", label: "XRP/USDT" },
    { value: "B-ADA_USDT", label: "ADA/USDT" },
    { value: "B-DOGE_USDT", label: "DOGE/USDT" },
    { value: "B-AVAX_USDT", label: "AVAX/USDT" },
  ];

  const fetchMode = async () => {
    try {
      const res = await fetch("/api/brain/mode");
      if (res.ok) {
        const data = await res.json();
        setTradingMode(data.mode);
      }
    } catch { /* ignore */ }
  };

  const fetchBrainData = async () => {
    setIsLoading(true);
    try {
      const [episodesRes, reflectionsRes, strategiesRes] = await Promise.all([
        fetch("/api/brain/episodes?limit=20"),
        fetch("/api/brain/reflections?limit=20"),
        fetch("/api/brain/strategies")
      ]);

      if (episodesRes.ok) setEpisodes(await episodesRes.json());
      if (reflectionsRes.ok) setReflections(await reflectionsRes.json());
      if (strategiesRes.ok) setStrategies(await strategiesRes.json());
    } catch (error) {
      console.error("Failed to fetch brain data:", error);
      toast.error("Failed to fetch Autonomous Brain data.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBrainData();
    fetchMode();
  }, []);

  useEffect(() => {
    setLogStatus("connecting");
    const eventSource = new EventSource("/api/brain/logs/stream");

    eventSource.onopen = () => {
      setLogStatus("connected");
    };

    eventSource.onmessage = (event) => {
      if (event.data && event.data !== "ping") {
        setLogs((prev) => {
          const newLogs = [...prev, event.data];
          if (newLogs.length > 500) newLogs.shift();
          return newLogs;
        });
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      setLogStatus("disconnected");
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const handleManualDecide = async () => {
    toast.info("Triggering Brain evaluation...");
    try {
      const res = await fetch("/api/brain/decide?symbol=BTCUSDT", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      await res.json();
      toast.success("Evaluation complete!");
      fetchBrainData();
    } catch (e) {
      toast.error("Brain evaluation failed.");
    }
  };

  const handleEvolve = async () => {
    toast.info("Triggering Evolution...");
    try {
      const res = await fetch("/api/brain/evolution/run", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      toast.success("Evolution process completed!");
      fetchBrainData();
    } catch (e) {
      toast.error("Brain evolution failed.");
    }
  };

  const handleTriggerSignal = async () => {
    const capitalValue = capitalMode === "pct"
      ? (availableEquity * triggerCapitalPct) / 100
      : parseFloat(triggerCapitalFixed || "0");

    if (!capitalValue || isNaN(capitalValue) || capitalValue <= 0) {
      toast.error("Invalid Capital amount");
      return;
    }

    setTriggerLoading(true);
    setTriggerResult(null);
    try {
      const res = await fetch("/api/brain/trigger-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: triggerSymbol,
          direction: triggerDirection,
          compositeScore: triggerScore,
          sizeUsdt: capitalValue,
          leverage: triggerLeverage ? parseInt(triggerLeverage) : undefined,
          stopLossPct: triggerSl ? parseFloat(triggerSl) : undefined,
          takeProfitPct: triggerTp ? parseFloat(triggerTp) : undefined,
          disableTrailing: !triggerTrailing, // if triggerTrailing is false, disableTrailing is true
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerResult(data);
        toast.success(`Signal triggered: ${data.symbol} ${data.direction} (${data.mode} mode)`);
        fetchBrainData();
      } else {
        toast.error(`Trigger failed: ${data.error}`);
        setTriggerResult({ error: data.error });
      }
    } catch (e: any) {
      toast.error("Signal trigger request failed.");
      setTriggerResult({ error: e.message });
    } finally {
      setTriggerLoading(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto scrollbar-thin">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-purple-500 animate-pulse" />
          <div>
            <h1 className="text-base font-bold text-[#f4f4f5]">Autonomous Brain</h1>
            <p className="text-[10px] text-[#71717a]">
              AI Orchestrator, Reflection, Memory, and Evolution Hub
            </p>
          </div>
        </div>
          {/* Mode Badge */}
          <span className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
            tradingMode === "paper" 
              ? "bg-amber-500/10 text-amber-400 border-amber-500/30" 
              : tradingMode === "live"
              ? "bg-red-500/10 text-red-400 border-red-500/30 animate-pulse"
              : "bg-zinc-800 text-zinc-500 border-zinc-700"
          )}>
            {tradingMode === "paper" ? "📋 Paper Mode" : tradingMode === "live" ? "🔴 Live Mode" : "Loading..."}
          </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTriggerOpen(!triggerOpen)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors border font-semibold",
              triggerOpen 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
                : "bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] border-[#27272a]"
            )}
          >
            <Send size={12} />
            Trigger Signal
            <ChevronDown size={10} className={cn("transition-transform", triggerOpen && "rotate-180")} />
          </button>
          <button
            onClick={handleManualDecide}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-xs transition-colors border border-purple-500/30 font-semibold"
          >
            <Zap size={12} />
            Force Decide (BTCUSDT)
          </button>
          
          <button
            onClick={handleEvolve}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] text-xs transition-colors border border-[#27272a] font-semibold"
          >
            <GitBranch size={12} className="text-blue-400" />
            Trigger Evolution
          </button>

          <button
            onClick={fetchBrainData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] text-xs transition-colors disabled:opacity-50 border border-[#27272a] font-semibold"
          >
            <RefreshCw size={11} className={cn(isLoading && "animate-spin")} />
            Refresh
          </button>

          <div className="h-5 w-px bg-[#27272a] mx-1"></div>

          <button
            onClick={() => setIsLogPanelOpen(!isLogPanelOpen)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors border font-semibold",
              isLogPanelOpen 
                ? "bg-purple-500/10 text-purple-400 border-purple-500/30" 
                : "bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] border-[#27272a]"
            )}
          >
            <PanelRight size={14} />
            Logs
          </button>
        </div>
      </div>

      {/* Signal Trigger Panel */}
      {triggerOpen && (
        <div className="bg-[#18181b] border border-emerald-500/20 rounded-lg p-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 mb-3">
            <Send size={14} className="text-emerald-400" />
            <span className="text-xs font-bold text-zinc-200">Manual Signal Injection</span>
            <span className="text-[10px] text-zinc-500 ml-auto">
              Fires through the full 8-gate pipeline → Brain → Governor → Execution
            </span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {/* Symbol */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Symbol</label>
              <select
                value={triggerSymbol}
                onChange={(e) => setTriggerSymbol(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none"
              >
                {SYMBOLS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {/* Direction */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Direction</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setTriggerDirection("long")}
                  className={cn(
                    "flex-1 px-2 py-1.5 rounded text-xs font-bold border transition-colors",
                    triggerDirection === "long"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-[#09090b] text-zinc-500 border-[#27272a] hover:text-zinc-300"
                  )}
                >
                  ↗ Long
                </button>
                <button
                  onClick={() => setTriggerDirection("short")}
                  className={cn(
                    "flex-1 px-2 py-1.5 rounded text-xs font-bold border transition-colors",
                    triggerDirection === "short"
                      ? "bg-red-500/15 text-red-400 border-red-500/30"
                      : "bg-[#09090b] text-zinc-500 border-[#27272a] hover:text-zinc-300"
                  )}
                >
                  ↘ Short
                </button>
              </div>
            </div>
            {/* Score */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">
                Score: <span className="text-zinc-300">{triggerScore}</span>
              </label>
              <input
                type="range"
                min="50"
                max="100"
                value={triggerScore}
                onChange={(e) => setTriggerScore(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            </div>
            {/* Capital */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] text-zinc-500 font-bold uppercase">Capital (USDT)</label>
                <div className="flex rounded overflow-hidden border border-[#27272a] text-[9px] font-bold">
                  <button
                    type="button"
                    onClick={() => setCapitalMode("pct")}
                    className={cn(
                      "px-1.5 py-0.5 transition-colors",
                      capitalMode === "pct"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setCapitalMode("fixed")}
                    className={cn(
                      "px-1.5 py-0.5 border-l border-[#27272a] transition-colors",
                      capitalMode === "fixed"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-[#09090b] text-[#52525b] hover:text-[#f4f4f5]"
                    )}
                  >
                    $
                  </button>
                </div>
              </div>
              {capitalMode === "pct" ? (
                <div className="flex items-center gap-1">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={triggerCapitalPct}
                      onChange={(e) => setTriggerCapitalPct(Math.min(100, Math.max(1, parseInt(e.target.value) || 0)))}
                      className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none tabular-nums"
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] text-zinc-500 font-semibold">%</span>
                  </div>
                  <span className="text-[9px] text-zinc-500 font-medium truncate max-w-[55px]" title={`≈ $${((availableEquity * triggerCapitalPct) / 100).toFixed(2)}`}>
                    ≈${((availableEquity * triggerCapitalPct) / 100).toFixed(0)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    value={triggerCapitalFixed}
                    onChange={(e) => setTriggerCapitalFixed(e.target.value)}
                    className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none tabular-nums"
                    placeholder="50"
                  />
                  <span className="text-[9px] text-zinc-500 font-medium whitespace-nowrap">
                    ≈{availableEquity > 0 ? ((parseFloat(triggerCapitalFixed || "0") / availableEquity) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              )}
            </div>
            {/* Trailing Toggle */}
            <div className="flex items-center gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none mt-auto">
                <input
                  type="checkbox"
                  checked={triggerTrailing}
                  onChange={(e) => setTriggerTrailing(e.target.checked)}
                  className="rounded bg-[#09090b] border-[#27272a] text-emerald-500 focus:ring-emerald-500 focus:ring-opacity-50"
                />
                <span className="text-[10px] text-zinc-400 font-bold uppercase">Enable Trailing</span>
              </label>
            </div>

            {/* Row 2: Stop Loss % */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Stop Loss %</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={triggerSl}
                onChange={(e) => setTriggerSl(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none"
                placeholder="1.5"
              />
            </div>
            {/* Take Profit % */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Take Profit %</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={triggerTp}
                onChange={(e) => setTriggerTp(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none"
                placeholder="1.5"
              />
            </div>
            {/* Leverage */}
            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Leverage</label>
              <input
                type="number"
                min="1"
                max="125"
                value={triggerLeverage}
                onChange={(e) => setTriggerLeverage(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-200 focus:border-emerald-500/50 outline-none"
                placeholder="10"
              />
            </div>
            {/* Spacer */}
            <div></div>
            {/* Fire Button */}
            <div className="flex flex-col justify-end">
              <button
                onClick={handleTriggerSignal}
                disabled={triggerLoading}
                className="w-full px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-bold transition-colors border border-emerald-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {triggerLoading ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <Zap size={11} />
                )}
                {triggerLoading ? "Processing..." : "Fire Signal"}
              </button>
            </div>
          </div>
          {/* Result */}
          {triggerResult && (
            <div className={cn(
              "mt-3 p-2.5 rounded border text-xs font-mono",
              triggerResult.error
                ? "bg-red-500/5 border-red-500/20 text-red-400"
                : "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
            )}>
              {triggerResult.error ? (
                <span>❌ {triggerResult.error}</span>
              ) : (
                <div className="space-y-1">
                  <div>✅ {triggerResult.message}</div>
                  <div className="text-zinc-500">Signal ID: {triggerResult.signalId} | Mode: <span className="text-zinc-300 uppercase">{triggerResult.mode}</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#27272a] pb-2">
        <button
          onClick={() => setActiveTab("episodes")}
          className={cn(
            "px-4 py-1.5 text-xs font-bold rounded-t-lg transition-colors border-b-2",
            activeTab === "episodes" ? "border-purple-500 text-purple-400 bg-purple-500/5" : "border-transparent text-zinc-500 hover:text-zinc-300"
          )}
        >
          Episodes (Decisions)
        </button>
        <button
          onClick={() => setActiveTab("reflections")}
          className={cn(
            "px-4 py-1.5 text-xs font-bold rounded-t-lg transition-colors border-b-2",
            activeTab === "reflections" ? "border-yellow-500 text-yellow-500 bg-yellow-500/5" : "border-transparent text-zinc-500 hover:text-zinc-300"
          )}
        >
          Reflections & Rules
        </button>
        <button
          onClick={() => setActiveTab("strategies")}
          className={cn(
            "px-4 py-1.5 text-xs font-bold rounded-t-lg transition-colors border-b-2",
            activeTab === "strategies" ? "border-blue-500 text-blue-400 bg-blue-500/5" : "border-transparent text-zinc-500 hover:text-zinc-300"
          )}
        >
          Evolved Strategies
        </button>
      </div>

      {/* Content */}
      {isLoading && episodes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20 text-zinc-400">
          <RefreshCw size={24} className="animate-spin text-purple-500" />
          <div className="text-xs font-semibold">Loading Brain state...</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-2 pb-4 space-y-4">
          
          {/* Episodes Tab */}
          {activeTab === "episodes" && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {episodes.length === 0 ? (
                <div className="col-span-full py-10 text-center text-xs text-zinc-500">No episodes recorded yet.</div>
              ) : (
                episodes.map((ep) => (
                  <div key={ep.id} className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start border-b border-[#27272a] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {ep.marketSymbol}
                        </span>
                        <span className="text-xs font-semibold text-zinc-400">{new Date(ep.timestamp).toLocaleString()}</span>
                      </div>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-black uppercase border",
                        ep.actualAction?.status === "governor_approved" ? "bg-j-up-bright/10 text-j-up-bright border-j-up-bright/30" 
                        : ep.actualAction?.status === "shadow_logged" ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                        : "bg-zinc-800 text-zinc-500 border-zinc-700"
                      )}>
                        {ep.actualAction?.status?.replace("_", " ") || "Simulated"}
                      </span>
                    </div>

                    <div className="text-xs">
                      <div className="text-zinc-500 mb-1 font-semibold text-[10px] uppercase">Reasoning</div>
                      <div className="text-zinc-300 bg-[#09090b] p-2 rounded border border-[#27272a] max-h-32 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words">
                        {ep.reasoning || "No reasoning recorded."}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a]">
                        <div className="text-zinc-500 mb-1 font-semibold text-[10px] uppercase">Proposed Action</div>
                        <pre className="text-zinc-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                          {ep.proposedAction ? JSON.stringify(ep.proposedAction, null, 2) : "None"}
                        </pre>
                      </div>
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a]">
                        <div className="text-zinc-500 mb-1 font-semibold text-[10px] uppercase">Governor Feedback</div>
                        <div className="text-zinc-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-words">
                          {ep.governorJson?.approved ? (
                            <span className="text-j-up-bright font-bold">Approved</span>
                          ) : (
                            <span className="text-j-down-bright font-bold">Rejected: {ep.governorJson?.reason || "N/A"}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {ep.outcomePnl !== null && ep.outcomePnl !== undefined && (
                      <div className="pt-2 border-t border-[#27272a] flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-semibold">Outcome PnL</span>
                        <span className={cn(
                          "font-black",
                          Number(ep.outcomePnl) > 0 ? "text-j-up-bright" : Number(ep.outcomePnl) < 0 ? "text-j-down-bright" : "text-zinc-400"
                        )}>
                          ${Number(ep.outcomePnl).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Reflections Tab */}
          {activeTab === "reflections" && (
            <div className="grid grid-cols-1 gap-4">
              {reflections.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-500">No reflections found.</div>
              ) : (
                reflections.map((ref) => (
                  <div key={ref.id} className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex gap-4">
                    <div className="flex-shrink-0 pt-1">
                      <Lightbulb className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-zinc-400 mb-2">
                        Reflection from Episode #{ref.episodeId} • {new Date(ref.appliedAt).toLocaleString()}
                      </div>
                      <div className="text-sm font-semibold text-zinc-200 mb-2 leading-relaxed">
                        "{ref.lesson}"
                      </div>
                      <div className="bg-[#09090b] p-2.5 rounded border border-yellow-500/20 text-xs text-yellow-500/90 font-mono break-all">
                        <strong>Generated Rule:</strong> {ref.ruleCreated}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Strategies Tab */}
          {activeTab === "strategies" && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {strategies.length === 0 ? (
                <div className="col-span-full py-10 text-center text-xs text-zinc-500">No strategies evolved yet.</div>
              ) : (
                strategies.map((strat) => (
                  <div key={strat.id} className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3 relative overflow-hidden">
                    {strat.active && (
                      <div className="absolute top-0 right-0 px-2 py-1 bg-blue-500 text-white text-[9px] font-black uppercase rounded-bl-lg z-10">
                        Active
                      </div>
                    )}
                    
                    <div className="border-b border-[#27272a] pb-2">
                      <h3 className="text-sm font-bold text-blue-400">{strat.name}</h3>
                      <p className="text-[10px] text-zinc-500 mt-1">{strat.description}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a]">
                        <div className="text-zinc-500 mb-1 text-[9px] uppercase font-bold">Sharpe</div>
                        <div className="font-mono text-zinc-200">{Number(strat.sharpRatio).toFixed(2)}</div>
                      </div>
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a]">
                        <div className="text-zinc-500 mb-1 text-[9px] uppercase font-bold">Win Rate</div>
                        <div className="font-mono text-zinc-200">{(Number(strat.winRate) * 100).toFixed(1)}%</div>
                      </div>
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a]">
                        <div className="text-zinc-500 mb-1 text-[9px] uppercase font-bold">Total PnL</div>
                        <div className={cn(
                          "font-mono font-bold",
                          Number(strat.totalPnl) > 0 ? "text-j-up-bright" : Number(strat.totalPnl) < 0 ? "text-j-down-bright" : "text-zinc-400"
                        )}>
                          ${Number(strat.totalPnl).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto pt-2 border-t border-[#27272a]">
                      <div className="text-zinc-500 mb-1 text-[10px] uppercase font-bold">Core Parameters</div>
                      <div className="bg-[#09090b] p-2 rounded border border-[#27272a] text-[10px] font-mono text-zinc-400 max-h-24 overflow-y-auto">
                        {JSON.stringify(strat.parameters, null, 2)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      )}
      </div>

      {/* Expandable Live Brain Console Logs Sidebar */}
      {isLogPanelOpen && (
        <div className="w-[450px] shrink-0 border-l border-[#27272a] bg-[#0c0c0e] flex flex-col h-full">
          <div className="flex items-center justify-between px-3 py-3 border-b border-[#27272a] bg-[#0c0c0e]">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-purple-400" />
              <span className="text-xs font-bold text-zinc-300">Live Brain & Agent Logs</span>
              <div className="flex items-center gap-1.5 ml-2">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  logStatus === "connected" ? "bg-green-500 animate-pulse" :
                  logStatus === "connecting" ? "bg-yellow-500 animate-pulse" :
                  "bg-red-500"
                )} />
                <span className="text-[10px] text-zinc-500 capitalize">{logStatus}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLogs([])}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Clear logs"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-1 bg-[#09090b]">
            {logs.length === 0 ? (
              <div className="text-zinc-600 italic">Listening for live logs...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="leading-5 whitespace-pre-wrap border-l border-zinc-800 pl-2 hover:bg-zinc-950 transition-colors break-all">
                  {log}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
