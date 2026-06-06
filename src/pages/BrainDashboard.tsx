import { useState, useEffect, useRef } from "react";
import { Brain, Zap, GitBranch, Lightbulb, RefreshCw, Play, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, Target, Shield, Clock, Terminal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function BrainDashboard() {
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"episodes" | "strategies" | "reflections">("episodes");
  const [logs, setLogs] = useState<string[]>([]);
  const [logStatus, setLogStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const terminalEndRef = useRef<HTMLDivElement>(null);

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
      const data = await res.json();
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

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto scrollbar-thin">
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

        <div className="flex items-center gap-2">
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
        </div>
      </div>

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

      {/* Live Brain Console Logs */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-lg flex flex-col h-[260px] shrink-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a] bg-[#0c0c0e]">
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
          <button
            onClick={() => setLogs([])}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Clear logs"
          >
            <Trash2 size={12} />
          </button>
        </div>

        <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-1 bg-[#09090b]">
          {logs.length === 0 ? (
            <div className="text-zinc-600 italic">Listening for live logs...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="leading-5 whitespace-pre-wrap border-l border-zinc-800 pl-2 hover:bg-zinc-950 transition-colors">
                {log}
              </div>
            ))
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
}
