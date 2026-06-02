import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Bot, Settings, AlertTriangle, CheckCircle, Activity } from "lucide-react";
import { KillSwitchButton } from "./KillSwitchButton";

const ALL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"];

export function AutoTraderPanel({ userId = 1 }: { userId?: number }) {
  const [expanded, setExpanded] = useState(false);

  const { data: config, refetch } = trpc.autoExecutor.getConfig.useQuery({ userId }, {
    refetchInterval: 15_000,
  });
  const { data: status } = trpc.autoExecutor.status.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const { data: paperWallet } = trpc.autoExecutor.paperWallet.useQuery(
    { userId },
    { refetchInterval: 10_000, enabled: status?.isPaperMode ?? true }
  );

  const resetPaper = trpc.autoExecutor.resetPaperWallet.useMutation({
    onSuccess: () => toast.success("Paper wallet reset"),
  });

  const saveConfig = trpc.autoExecutor.saveConfig.useMutation({
    onSuccess: () => { toast.success("AutoTrader config saved"); refetch(); },
    onError: (err) => toast.error("Save failed", { description: err.message }),
  });

  const [form, setForm] = useState({
    enabled: false,
    targetSymbols: ["BTCUSDT", "ETHUSDT"] as string[],
    defaultSizeUsdt: "50",
    defaultLeverage: 3,
    stopLossPct: "0.015",
    tp1Pct: "0.015",
    useLlmAdvisor: true,
    llmConfidenceThreshold: 70,
    maxTotalPositions: 3,
    paperStartingBalance: "10000",
  });

  // Sync form from DB config
  const synced = config !== undefined;
  if (config && !synced) {
    setForm({
      enabled: config.enabled ?? false,
      targetSymbols: (config.targetSymbols as string[]) ?? ["BTCUSDT", "ETHUSDT"],
      defaultSizeUsdt: config.defaultSizeUsdt ?? "50",
      defaultLeverage: config.defaultLeverage ?? 3,
      stopLossPct: config.stopLossPct ?? "0.015",
      tp1Pct: config.tp1Pct ?? "0.015",
      useLlmAdvisor: config.useLlmAdvisor ?? true,
      llmConfidenceThreshold: config.llmConfidenceThreshold ?? 70,
      maxTotalPositions: config.maxTotalPositions ?? 3,
    });
  }

  const handleSave = () => {
    saveConfig.mutate({ userId, ...form, defaultSizeUsdt: form.defaultSizeUsdt });
  };

  const handleToggle = () => {
    const newEnabled = !(config?.enabled ?? false);
    saveConfig.mutate({ userId, enabled: newEnabled });
  };

  const isEnabled = config?.enabled ?? false;

  return (
    <div className="border border-[#27272a] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#09090b]">
        <Bot size={12} className={isEnabled ? "text-[#22c55e]" : "text-[#52525b]"} />
        <span className="text-[10px] font-semibold text-[#f4f4f5]">AutoTrader</span>

        {/* Enable/disable toggle */}
        <button
          onClick={handleToggle}
          className={cn(
            "ml-1 px-2 py-0.5 rounded text-[9px] font-semibold border transition-all",
            isEnabled
              ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30"
              : "bg-[#18181b] text-[#71717a] border-[#27272a] hover:text-[#f4f4f5]"
          )}
        >
          {isEnabled ? "ON" : "OFF"}
        </button>

        {/* Paper mode badge */}
        {status?.isPaperMode && (
          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30">
            PAPER
          </span>
        )}

        {/* Live stats */}
        {status && (
          <span className="text-[9px] text-[#52525b] ml-1">
            {status.executionsToday}↑ {status.skipsToday}↓
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <KillSwitchButton />
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[#52525b] hover:text-[#f4f4f5] transition-colors"
          >
            <Settings size={11} />
          </button>
        </div>
      </div>

      {/* Last decision */}
      {status?.lastDecision && (
        <div className="px-3 py-1.5 border-t border-[#18181b] bg-[#0a0a0a]">
          <div className="flex items-center gap-1.5 text-[9px]">
            <Activity size={9} className="text-[#52525b]" />
            <span className="text-[#52525b]">{status.lastDecision.symbol}</span>
            <span className={cn("font-medium", status.lastDecision.action === "execute" ? "text-[#22c55e]" : "text-[#71717a]")}>
              {status.lastDecision.action.toUpperCase()}
            </span>
            <span className="text-[#3f3f46] truncate max-w-[120px]">{status.lastDecision.reason}</span>
            <span className="text-[#3f3f46] ml-auto tabular-nums">
              {new Date(status.lastDecision.ts).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* PLACE_ORDERS warning */}
      {isEnabled && (
        <div className="px-3 py-1.5 border-t border-[#f59e0b]/20 bg-[#f59e0b]/5 flex items-center gap-1.5">
          <AlertTriangle size={9} className="text-[#f59e0b] flex-shrink-0" />
          <span className="text-[9px] text-[#f59e0b]">
            Live orders require <code className="bg-[#18181b] px-1 rounded">PLACE_ORDERS=true</code> in .env
          </span>
        </div>
      )}

      {/* Paper wallet stats */}
      {status?.isPaperMode && paperWallet && (
        <div className="px-3 py-2 border-t border-[#27272a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between text-[9px] mb-1">
            <span className="text-[#52525b]">Paper Balance</span>
            <button
              onClick={() => resetPaper.mutate({ userId, newBalance: parseFloat(config?.paperStartingBalance ?? "10000") })}
              className="text-[#52525b] hover:text-[#f4f4f5] underline"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[9px]">
            <div>
              <div className="text-[#52525b]">Free</div>
              <div className="text-[#f4f4f5] tabular-nums font-medium">${Number(paperWallet.balance).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[#52525b]">Locked</div>
              <div className="text-[#f59e0b] tabular-nums">${Number(paperWallet.lockedMargin).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[#52525b]">PnL</div>
              <div className={Number(paperWallet.realizedPnl) >= 0 ? "text-[#22c55e] tabular-nums" : "text-[#ef4444] tabular-nums"}>
                {Number(paperWallet.realizedPnl) >= 0 ? "+" : ""}{Number(paperWallet.realizedPnl).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {expanded && (
        <div className="border-t border-[#27272a] p-3 space-y-3 bg-[#0a0a0a]">
          {/* Target symbols */}
          <div>
            <div className="text-[9px] text-[#71717a] mb-1.5">Target symbols</div>
            <div className="flex flex-wrap gap-1">
              {ALL_SYMBOLS.map((sym) => {
                const selected = form.targetSymbols.includes(sym);
                return (
                  <button
                    key={sym}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        targetSymbols: selected
                          ? f.targetSymbols.filter((s) => s !== sym)
                          : [...f.targetSymbols, sym],
                      }))
                    }
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] border transition-colors",
                      selected
                        ? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30"
                        : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {sym.replace("USDT", "")}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Size + leverage */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Size (USDT)</div>
              <input
                type="number"
                value={form.defaultSizeUsdt}
                onChange={(e) => setForm((f) => ({ ...f, defaultSizeUsdt: e.target.value }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#22c55e]"
              />
            </div>
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Leverage</div>
              <select
                value={form.defaultLeverage}
                onChange={(e) => setForm((f) => ({ ...f, defaultLeverage: parseInt(e.target.value) }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none"
              >
                {[1, 2, 3, 5, 7, 10].map((l) => <option key={l} value={l}>{l}x</option>)}
              </select>
            </div>
          </div>

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Stop Loss %</div>
              <input
                type="number"
                step="0.001"
                value={parseFloat(form.stopLossPct) * 100}
                onChange={(e) => setForm((f) => ({ ...f, stopLossPct: String(parseFloat(e.target.value) / 100) }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#ef4444]"
              />
            </div>
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Take Profit %</div>
              <input
                type="number"
                step="0.001"
                value={parseFloat(form.tp1Pct) * 100}
                onChange={(e) => setForm((f) => ({ ...f, tp1Pct: String(parseFloat(e.target.value) / 100) }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#22c55e]"
              />
            </div>
          </div>

          {/* LLM advisor */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setForm((f) => ({ ...f, useLlmAdvisor: !f.useLlmAdvisor }))}
              className={cn(
                "px-2 py-0.5 rounded text-[9px] border transition-all",
                form.useLlmAdvisor
                  ? "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/30"
                  : "bg-[#18181b] text-[#52525b] border-[#27272a]"
              )}
            >
              LLM {form.useLlmAdvisor ? "ON" : "OFF"}
            </button>
            {form.useLlmAdvisor && (
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[9px] text-[#71717a]">Min confidence</span>
                <input
                  type="range"
                  min={0} max={100}
                  value={form.llmConfidenceThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, llmConfidenceThreshold: parseInt(e.target.value) }))}
                  className="flex-1"
                />
                <span className="text-[9px] text-[#a855f7] tabular-nums w-8">{form.llmConfidenceThreshold}%</span>
              </div>
            )}
          </div>

          {/* Max positions */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#71717a]">Max positions</span>
            {[1, 2, 3, 5].map((n) => (
              <button
                key={n}
                onClick={() => setForm((f) => ({ ...f, maxTotalPositions: n }))}
                className={cn(
                  "px-2 py-0.5 rounded text-[9px] border transition-all",
                  form.maxTotalPositions === n
                    ? "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30"
                    : "bg-[#18181b] text-[#52525b] border-[#27272a]"
                )}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Paper starting balance */}
          <div>
            <div className="text-[9px] text-[#71717a] mb-1">Paper Starting Balance (USDT)</div>
            <input
              type="number"
              value={form.paperStartingBalance}
              onChange={(e) => setForm((f) => ({ ...f, paperStartingBalance: e.target.value }))}
              className="w-full bg-[#18181b] border border-[#f59e0b]/30 rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#f59e0b]"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saveConfig.isPending}
            className="w-full py-1.5 rounded bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 text-[10px] font-semibold hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
          >
            {saveConfig.isPending ? "Saving…" : "Save Config"}
          </button>
        </div>
      )}
    </div>
  );
}
