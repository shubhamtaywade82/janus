import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Bot, Settings, AlertTriangle, Activity } from "lucide-react";
import { KillSwitchButton } from "./KillSwitchButton";

const ALL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"];

export function AutoTraderPanel(_props: { userId?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [synced, setSynced] = useState(false);

  const { data: config, refetch } = trpc.autoExecutor.getConfig.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const { data: status } = trpc.autoExecutor.status.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const { data: conversion } = trpc.trading.currencyConversion.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  );
  const usdtInrRate = conversion?.conversion_price ?? 89.0;

  const { data: paperWallet, refetch: refetchPaperWallet } = trpc.autoExecutor.paperWallet.useQuery(
    undefined,
    { refetchInterval: 10_000, enabled: status?.isPaperMode ?? true }
  );

  const resetPaper = trpc.autoExecutor.resetPaperWallet.useMutation({
    onSuccess: () => { toast.success("Paper wallet reset"); refetchPaperWallet(); },
    onError: (err) => toast.error("Reset failed", { description: err.message }),
  });

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const depositPaper = trpc.autoExecutor.depositPaperFunds.useMutation({
    onSuccess: () => {
      toast.success("Deposit successful");
      refetchPaperWallet();
      setDepositOpen(false);
      setDepositAmount("");
    },
    onError: (err) => toast.error("Deposit failed", { description: err.message }),
  });

  const handleDeposit = () => {
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    depositPaper.mutate({ amount });
  };

  const saveConfig = trpc.autoExecutor.saveConfig.useMutation({
    onSuccess: () => { toast.success("AutoTrader config saved"); refetch(); },
    onError: (err) => toast.error("Save failed", { description: err.message }),
  });

  const [form, setForm] = useState({
    enabled: false,
    targetSymbols: ["BTCUSDT", "ETHUSDT"] as string[],
    defaultSizeUsdt: "50",
    defaultLeverage: 5,
    capitalAllocationPct: "0.250",   // 25%
    useStrategyLeverage: true,
    stopLossPct: "0.015",
    tp1Pct: "0.015",
    useLlmAdvisor: true,
    llmConfidenceThreshold: 70,
    maxTotalPositions: 3,
    paperStartingBalance: "100000",
    paperCurrency: "INR" as "USDT" | "INR",
    trailingStopEnabled: true,
    riskRewardRatio: "2.00",
  });

  // Sync form from DB config
  useEffect(() => {
    if (config && !synced) {
      setForm({
        enabled: config.enabled ?? false,
        targetSymbols: (config.targetSymbols as string[]) ?? ["BTCUSDT", "ETHUSDT"],
        defaultSizeUsdt: config.defaultSizeUsdt ?? "50",
        defaultLeverage: config.defaultLeverage ?? 3,
        capitalAllocationPct: config.capitalAllocationPct ?? "0.250",
        useStrategyLeverage: config.useStrategyLeverage ?? true,
        stopLossPct: config.stopLossPct ?? "0.015",
        tp1Pct: config.tp1Pct ?? "0.015",
        useLlmAdvisor: config.useLlmAdvisor ?? true,
        llmConfidenceThreshold: config.llmConfidenceThreshold ?? 70,
        maxTotalPositions: config.maxTotalPositions ?? 3,
        paperStartingBalance: config.paperStartingBalance ?? "100000",
        paperCurrency: (config.paperCurrency as "USDT" | "INR") ?? "INR",
        trailingStopEnabled: config.trailingStopEnabled ?? true,
        riskRewardRatio: config.riskRewardRatio ?? "2.00",
      });
      setSynced(true);
    }
  }, [config, synced]);

  const handleSave = () => {
    saveConfig.mutate({ ...form, defaultSizeUsdt: form.defaultSizeUsdt });
  };

  const handleToggle = () => {
    const newEnabled = !(config?.enabled ?? false);
    saveConfig.mutate({ enabled: newEnabled });
  };

  const isEnabled = config?.enabled ?? false;

  return (
    <div className="border border-[#27272a] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#09090b]">
        <Bot size={12} className={isEnabled ? "text-j-up" : "text-[#52525b]"} />
        <span className="text-[10px] font-semibold text-[#f4f4f5]">AutoTrader</span>

        {/* Enable/disable toggle */}
        <button
          onClick={handleToggle}
          className={cn(
            "ml-1 px-2 py-0.5 rounded text-[9px] font-semibold border transition-all",
            isEnabled
              ? "bg-j-up/10 text-j-up border-j-up/30"
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
            <span className={cn("font-medium", status.lastDecision.action === "execute" ? "text-j-up" : "text-[#71717a]")}>
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
      {status?.isPaperMode && paperWallet && (() => {
        const isPaperCcyInr = paperWallet.currency === "INR";
        const balanceVal = Number(paperWallet.balance);
        const lockedVal = Number(paperWallet.lockedMargin);
        const realizedVal = Number(paperWallet.realizedPnl);

        const balanceInr = isPaperCcyInr ? balanceVal : balanceVal * usdtInrRate;
        const balanceUsdt = isPaperCcyInr ? balanceVal / usdtInrRate : balanceVal;

        const lockedInr = isPaperCcyInr ? lockedVal : lockedVal * usdtInrRate;
        const lockedUsdt = isPaperCcyInr ? lockedVal / usdtInrRate : lockedVal;

        const realizedInr = isPaperCcyInr ? realizedVal : realizedVal * usdtInrRate;
        const realizedUsdt = isPaperCcyInr ? realizedVal / usdtInrRate : realizedVal;

        return (
          <div className="px-3 py-2 border-t border-[#27272a] bg-[#0a0a0a]">
            <div className="flex items-center justify-between text-[9px] mb-1">
              <span className="text-[#52525b]">Paper Balance</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDepositOpen((v) => !v)}
                  className="text-[#52525b] hover:text-[#f4f4f5] underline text-[8px]"
                >
                  + Deposit
                </button>
                <button
                  onClick={() => resetPaper.mutate({ newBalance: parseFloat(config?.paperStartingBalance ?? "100000") })}
                  className="text-[#52525b] hover:text-[#f4f4f5] underline text-[8px]"
                >
                  Reset
                </button>
              </div>
            </div>
            {depositOpen && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <input
                  type="number"
                  min="0"
                  placeholder="Amount in ₹"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-1.5 py-0.5 text-[8px] text-[#f4f4f5] outline-none focus:border-[#52525b]"
                />
                <button
                  onClick={handleDeposit}
                  disabled={depositPaper.isPending}
                  className="px-1.5 py-0.5 rounded text-[8px] border border-[#27272a] text-[#f4f4f5] hover:bg-[#18181b] disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-[8px] leading-tight">
              <div>
                <div className="text-[#52525b]">Free</div>
                <div className="text-[#f4f4f5] tabular-nums font-semibold" title={`${balanceUsdt.toFixed(2)} USDT`}>
                  ₹{balanceInr.toFixed(2)}
                </div>
                <div className="text-[#52525b]/70 tabular-nums">
                  {balanceUsdt.toFixed(2)} USDT
                </div>
                {paperWallet.totalDeposited != null && (
                  <div className="text-[#52525b]/70 tabular-nums mt-0.5">
                    Deposited: ₹{Number(paperWallet.totalDeposited).toFixed(2)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[#52525b]">Locked</div>
                <div className="text-[#f59e0b] tabular-nums font-semibold" title={`${lockedUsdt.toFixed(2)} USDT`}>
                  ₹{lockedInr.toFixed(2)}
                </div>
                <div className="text-[#52525b]/70 tabular-nums">
                  {lockedUsdt.toFixed(2)} USDT
                </div>
              </div>
              <div>
                <div className="text-[#52525b]">PnL</div>
                <div className={cn("tabular-nums font-semibold", realizedUsdt >= 0 ? "text-j-up" : "text-j-down")} title={`${realizedUsdt.toFixed(2)} USDT`}>
                  {realizedInr >= 0 ? "+" : ""}₹{realizedInr.toFixed(2)}
                </div>
                <div className={cn("tabular-nums opacity-75", realizedUsdt >= 0 ? "text-j-up" : "text-j-down")}>
                  {realizedUsdt >= 0 ? "+" : ""}{realizedUsdt.toFixed(2)} USDT
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Settings panel */}
      {expanded && (
        <div className="border-t border-[#27272a] p-3 space-y-3 bg-[#0a0a0a] max-h-[400px] overflow-y-auto scrollbar-thin">
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
                        ? "bg-j-up/10 text-j-up border-j-up/30"
                        : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                    )}
                  >
                    {sym.replace("USDT", "")}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Capital allocation + size */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">
                Allocation % of balance
                <span className="ml-1 text-j-up">{(parseFloat(form.capitalAllocationPct) * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={1} max={50} step={1}
                value={Math.round(parseFloat(form.capitalAllocationPct) * 100)}
                onChange={(e) => setForm((f) => ({ ...f, capitalAllocationPct: String(parseInt(e.target.value) / 100) }))}
                className="w-full"
              />
              <div className="flex justify-between text-[8px] text-[#3f3f46]">
                <span>1%</span><span>25%</span><span>50%</span>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Max trade size (USDT cap)</div>
              <input
                type="number"
                value={form.defaultSizeUsdt}
                onChange={(e) => setForm((f) => ({ ...f, defaultSizeUsdt: e.target.value }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-j-up"
              />
              <div className="text-[8px] text-[#52525b] mt-0.5">uses min(% cap, this)</div>
            </div>
          </div>

          {/* Leverage mode */}
          <div>
            <div className="text-[9px] text-[#71717a] mb-1.5">Leverage</div>
            <div className="flex gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, useStrategyLeverage: true }))}
                className={cn(
                  "flex-1 py-1 rounded text-[9px] border transition-colors",
                  form.useStrategyLeverage
                    ? "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30"
                    : "bg-[#18181b] text-[#52525b] border-[#27272a]"
                )}
              >
                Auto per strategy
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, useStrategyLeverage: false }))}
                className={cn(
                  "flex-1 py-1 rounded text-[9px] border transition-colors",
                  !form.useStrategyLeverage
                    ? "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30"
                    : "bg-[#18181b] text-[#52525b] border-[#27272a]"
                )}
              >
                Fixed {form.defaultLeverage}x
              </button>
            </div>
            {!form.useStrategyLeverage && (
              <div className="flex gap-1 mt-1.5">
                {[5, 7, 10, 15, 20].map((l) => (
                  <button
                    key={l}
                    onClick={() => setForm((f) => ({ ...f, defaultLeverage: l }))}
                    className={cn(
                      "flex-1 py-0.5 rounded text-[9px] border transition-colors",
                      form.defaultLeverage === l
                        ? "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30"
                        : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                    )}
                  >{l}x</button>
                ))}
              </div>
            )}
            {form.useStrategyLeverage && (
              <div className="text-[8px] text-[#52525b] mt-1">
                bb_reversion=8x · intraday=15x · swing=5x · grid=5x · h6_momentum=10x
              </div>
            )}
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
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-j-down"
              />
            </div>
            <div>
              <div className="text-[9px] text-[#71717a] mb-1">Take Profit %</div>
              <input
                type="number"
                step="0.001"
                value={parseFloat(form.tp1Pct) * 100}
                onChange={(e) => setForm((f) => ({ ...f, tp1Pct: String(parseFloat(e.target.value) / 100) }))}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-j-up"
              />
            </div>
          </div>

          {/* Trailing Stop & Risk Reward Ratio */}
          <div className="border-t border-[#27272a] pt-2.5 space-y-2">
            <div className="flex items-center justify-between text-[9px] text-[#71717a]">
              <span>Trailing Stops</span>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, trailingStopEnabled: !f.trailingStopEnabled }))}
                className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-semibold border transition-all",
                  form.trailingStopEnabled
                    ? "bg-j-up/10 text-j-up border-j-up/30"
                    : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                )}
              >
                {form.trailingStopEnabled ? "ENABLED" : "DISABLED"}
              </button>
            </div>
            
            {!form.trailingStopEnabled && (
              <div className="space-y-1.5 bg-[#18181b]/30 p-2 rounded border border-[#27272a]/50">
                <div className="flex items-center justify-between text-[9px] text-[#71717a]">
                  <span>Target Risk-Reward (R:R)</span>
                  <span className="text-j-up tabular-nums font-semibold">{parseFloat(form.riskRewardRatio).toFixed(1)}:1</span>
                </div>
                <div className="flex gap-1">
                  {["1.00", "1.50", "2.00", "3.00", "4.00", "5.00"].map((rr) => (
                    <button
                      key={rr}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, riskRewardRatio: rr }))}
                      className={cn(
                        "flex-1 py-0.5 rounded text-[8px] border transition-colors",
                        form.riskRewardRatio === rr
                          ? "bg-j-up/10 text-j-up border-j-up/30"
                          : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                      )}
                    >
                      {parseFloat(rr).toFixed(0)}:1
                    </button>
                  ))}
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="20"
                    value={form.riskRewardRatio}
                    onChange={(e) => setForm((f) => ({ ...f, riskRewardRatio: e.target.value }))}
                    className="w-12 bg-[#18181b] border border-[#27272a] rounded px-1.5 py-0.5 text-[9px] text-center text-[#f4f4f5] outline-none"
                    placeholder="Custom"
                  />
                </div>
              </div>
            )}
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

          {/* Paper Wallet Currency */}
          <div>
            <div className="text-[9px] text-[#71717a] mb-1.5">Paper Wallet Currency</div>
            <div className="flex gap-2">
              {["USDT", "INR"].map((ccy) => (
                <button
                  key={ccy}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, paperCurrency: ccy as "USDT" | "INR" }))}
                  className={cn(
                    "flex-1 py-1 rounded text-[9px] border transition-colors",
                    form.paperCurrency === ccy
                      ? "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30"
                      : "bg-[#18181b] text-[#52525b] border-[#27272a] hover:text-[#f4f4f5]"
                  )}
                >
                  {ccy}
                </button>
              ))}
            </div>
          </div>

          {/* Paper starting balance */}
          <div>
            <div className="text-[9px] text-[#71717a] mb-1">Paper Starting Balance</div>
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
            className="w-full py-1.5 rounded bg-j-up/10 text-j-up border border-j-up/30 text-[10px] font-semibold hover:bg-j-up/20 transition-colors disabled:opacity-50"
          >
            {saveConfig.isPending ? "Saving…" : "Save Config"}
          </button>
        </div>
      )}
    </div>
  );
}
