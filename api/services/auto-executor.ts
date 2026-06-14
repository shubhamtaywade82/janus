/**
 * Auto-Executor
 * Converts gated signals to live positions automatically.
 * 8-gate pipeline per signal:
 *   1. AutoTrader enabled
 *   2. Kill switch clear
 *   3. Symbol in target list
 *   4. No duplicate open position
 *   5. Max total positions not exceeded
 *   6. Funding rate acceptable
 *   7. Correlation limit not exceeded
 *   8. Risk engine approved
 *   + Optional: LLM advisor confirmation
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "../queries/connection";
import { positions, exchangeCredentials, autoExecutorConfig, systemLogs, signals, executorDecisions, brainEpisodes, orders } from "@db/schema";
import { llmDecisionEvents } from "./llm-events";
import { eq, and } from "drizzle-orm";
import { globalKillSwitch } from "./kill-switch";
import { globalRiskEngine, getOrCreateSession, updateSession } from "./risk-engine";
import { globalGovernor } from "./governor";
import { BrainOrchestrator } from "../brain/brain-orchestrator";
import { reflectOnTrade } from "../brain/brain-reflection";
import { globalLlmAdvisor, type SignalContext } from "./llm-advisor";
import { getKronosSignal } from "./kronos-client";
import { latestTickerCache } from "./streaming";
import { marketStateManager } from "./market-state";
import { markPriceCache, tradingEvents } from "./coindcx-ws";
import { fetchKlines } from "./binance";
import { createFuturesOrder, getFuturesWallet, getFuturesInstrumentInfo, getOrderStatus, cancelOrder } from "./coindcx";
import { registerPositionForTrailing, unregisterPosition } from "./trailing-stop";
import { STRATEGY_CONFIGS } from "./strategy-config";
import { latestRegimeCache } from "./regime-detector";
import type { ExitDecision } from "./exit-manager";
import { snapshotEquity } from "./performance-tracker";
import { getPaperWallet, getPaperEquity } from "./paper-wallet";
import {
  lockPaperPositionMargin,
  releasePaperPositionMargin,
  walletToUsdt,
} from "./paper-currency";
import { env, coinDCXEnvCreds } from "../lib/env";
import { decryptCreds } from "../lib/crypto";
import { recordPositionTransaction, estimateFee } from "./position-manager/transaction-ledger";
import { RiskManager } from "./RiskManager";
import { WalletLedgerService } from "./WalletLedgerService";
import Decimal from "decimal.js";
import type { Signal, AutoExecutorConfig } from "@db/schema";
import type { StrategyType } from "./strategy-config";
import { SYMBOL_MIN_SL_PCT, DEFAULT_MIN_SL_PCT, type SupportedSymbol } from "../../contracts/constants";

const DEDUP_FILE = path.resolve(process.cwd(), "dedup-cache-state.json");

export const autoExecutorEvents = new EventEmitter();
autoExecutorEvents.setMaxListeners(20);

export interface ExecutorDecision {
  symbol: string;
  action: "execute" | "skip";
  reason: string;
  signal?: {
    direction: string;
    compositeScore: string;
    strategy: string;
  };
  llmDecision?: {
    decision: string;
    confidence: number;
    reasoning: string;
    keyUsed: string;
  };
  /** Gate/stage that produced this outcome (e.g. "risk", "llm", "dedup", "executed"). */
  gate?: string;
  /** Signal row id this decision was made on, if any. */
  signalId?: number;
  ts: number;
}

export interface AutoExecutorState {
  lastRun: number;
  signalsProcessed: number;
  executionsToday: number;
  skipsToday: number;
  lastDecision: ExecutorDecision | null;
}

const brainOrchestrator = new BrainOrchestrator(); // mode read per-call from config

const LIMIT_ENTRY_TIMEOUT_MS = 5_000;
const LIMIT_ENTRY_POLL_MS = 1_000;

/**
 * Places an entry order. When `preferLimitEntry` is true and the order book has live
 * quotes, places a marketable limit order at the best ask (long) / best bid (short) —
 * this caps slippage at the displayed top-of-book instead of sweeping deeper into the
 * book like a market order would. If unfilled after a short timeout, cancels and falls
 * back to a market order so the entry isn't missed entirely.
 */
async function placeEntryOrder(
  creds: { apiKey: string; apiSecret: string },
  order: { market: string; side: "buy" | "sell"; total_quantity: number; price: number; leverage: number; client_order_id: string },
  preferLimitEntry: boolean,
  symbol: string
): Promise<any> {
  const book = marketStateManager.get(symbol)?.orderBook;
  const bestBid = book?.bids?.[0]?.[0] ?? 0;
  const bestAsk = book?.asks?.[0]?.[0] ?? 0;

  if (!preferLimitEntry || bestBid <= 0 || bestAsk <= 0) {
    return createFuturesOrder(creds, { ...order, order_type: "market" });
  }

  const limitPrice = order.side === "buy" ? bestAsk : bestBid;
  const placed = await createFuturesOrder(creds, { ...order, order_type: "limit", price: limitPrice });
  const orderId = placed?.id;
  if (!orderId) return placed;

  const deadline = Date.now() + LIMIT_ENTRY_TIMEOUT_MS;
  let lastStatus: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LIMIT_ENTRY_POLL_MS));
    const status = await getOrderStatus(creds, orderId).catch(() => null);
    if (!status) continue;
    lastStatus = status;
    const remaining = parseFloat(status.remaining_quantity ?? status.total_quantity ?? "0");
    if (remaining <= 0) {
      console.log(`[auto-executor] Limit entry ${orderId} filled at ${limitPrice} (symbol=${symbol})`);
      return status;
    }
  }

  // Cancel the rest and top up with a market order sized to the unfilled remainder only —
  // a partially-filled limit order followed by a full-size market order would overfill.
  const remainingQty = parseFloat(lastStatus?.remaining_quantity ?? String(order.total_quantity));
  await cancelOrder(creds, orderId, order.market).catch((err) =>
    console.warn(`[auto-executor] Failed to cancel unfilled limit entry ${orderId}:`, err.message)
  );

  if (remainingQty <= 0) {
    console.log(`[auto-executor] Limit entry ${orderId} fully filled by cancel-time (symbol=${symbol})`);
    return lastStatus;
  }

  const filledQty = order.total_quantity - remainingQty;
  console.warn(
    `[auto-executor] Limit entry ${orderId} not filled within ${LIMIT_ENTRY_TIMEOUT_MS}ms ` +
    `(filled=${filledQty}/${order.total_quantity}) — cancelling remainder and topping up with market order for ${remainingQty} (symbol=${symbol})`
  );
  const topUp = await createFuturesOrder(creds, { ...order, order_type: "market", total_quantity: remainingQty });
  // Note: the position record below tracks `topUp.id` as exchangeOrderId — the partially-filled
  // limit order (`orderId`) is logged above for traceability but not separately persisted.
  // The position-reconciler corrects size against the exchange's actual aggregate fill regardless.
  console.log(`[auto-executor] Top-up market order ${topUp?.id} filled remainder for entry ${orderId} (symbol=${symbol})`);
  return topUp;
}

export class AutoExecutor {
  constructor() {
    // Subscribe to exit signals for default user (userId=1)
    tradingEvents.on(`exit-signal:1`, this.handleExitSignal.bind(this));
    this.loadDedupCache();
  }

  private loadDedupCache() {
    try {
      if (fs.existsSync(DEDUP_FILE)) {
        const data = fs.readFileSync(DEDUP_FILE, "utf-8");
        const parsed = JSON.parse(data) as Record<string, number>;
        const now = Date.now();
        for (const [key, ts] of Object.entries(parsed)) {
          if (now - ts <= this.DEDUP_WINDOW_MS) {
            this.recentExecutions.set(key, ts);
          }
        }
        console.log(`[auto-executor] Loaded ${this.recentExecutions.size} entries from persistent dedup cache`);
      }
    } catch (err) {
      console.error("[auto-executor] Failed to load dedup cache:", err);
    }
  }

  private async saveDedupCache() {
    try {
      const obj: Record<string, number> = {};
      const now = Date.now();
      for (const [key, ts] of this.recentExecutions) {
        if (now - ts <= this.DEDUP_WINDOW_MS) {
          obj[key] = ts;
        }
      }
      await fs.promises.writeFile(DEDUP_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err) {
      console.error("[auto-executor] Failed to save dedup cache:", err);
    }
  }

  /** Current executor state */
  state: AutoExecutorState = {
    lastRun: 0,
    signalsProcessed: 0,
    executionsToday: 0,
    skipsToday: 0,
    lastDecision: null,
  };

  /** Dedup map: symbol+direction → timestamp of last execution */
  private recentExecutions = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 60_000;

  // Cache config to avoid DB read on every signal
  private configCache: AutoExecutorConfig | null = null;
  private configCacheAt = 0;
  private readonly CONFIG_TTL_MS = 30_000;

  async onSignalBatch(batchSignals: Signal[]): Promise<ExecutorDecision[]> {
    if (!env.autoExecute) return [];

    const config = await this.getConfig();
    if (!config?.enabled) return [];
    if (!globalKillSwitch.canTrade()) return [];

    const gated = batchSignals.filter(
      (s) => s.isGated && s.direction !== "neutral" && s.direction !== null
    );
    if (gated.length === 0) return [];

    // Clean up stale dedup entries to prevent unbounded memory growth
    const now = Date.now();
    let cleaned = false;
    for (const [key, ts] of this.recentExecutions) {
      if (now - ts > this.DEDUP_WINDOW_MS) {
        this.recentExecutions.delete(key);
        cleaned = true;
      }
    }
    if (cleaned) {
      await this.saveDedupCache();
    }

    const decisions: ExecutorDecision[] = [];
    for (const signal of gated) {
      try {
        const dec = await this.processSignal(signal, config);
        decisions.push(dec);
      } catch (err: any) {
        console.error(`[auto-executor] processSignal error for ${signal.symbol}:`, err);
        decisions.push({
          symbol: signal.symbol,
          action: "skip",
          reason: `Execution Error: ${err.message}`,
          signal: { direction: signal.direction, compositeScore: signal.compositeScore, strategy: "" },
          ts: Date.now(),
        });
      }
    }
    this.state.lastRun = Date.now();
    return decisions;
  }

  // Default config used when AUTO_EXECUTE=true but no DB row exists yet
  private static readonly DEFAULT_CONFIG: AutoExecutorConfig = {
    id: 0,
    userId: 1,
    enabled: true,
    targetSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"],
    defaultSizeUsdt: "50",
    defaultLeverage: 3,
    capitalAllocationPct: "0.250",   // 25% base allocation for paper (dynamic, conviction-scaled)
    useStrategyLeverage: true,        // use STRATEGY_CONFIGS leverage per regime
    stopLossPct: "0.015",
    tp1Pct: "0.015",
    tp2Pct: "0.030",
    useLlmAdvisor: false,
    llmConfidenceThreshold: 70,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 3,
    paperStartingBalance: "100000",
    paperCurrency: "INR",
    brainDriverEnabled: false,
    brainGateEnabled: false,
    brainShadowMode: true,
    useKronosFilter: false,
    kronosConfidenceThreshold: "0.5000",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** Bust the in-memory config cache so the next signal re-reads the DB immediately.
   *  Called by UI mutations (saveConfig / bot.start / bot.stop / setLLMFilter). */
  invalidateConfigCache(): void {
    this.configCache = null;
    this.configCacheAt = 0;
  }

  /** Public read of the active config (cached). Used by the brain driver loop. */
  async getActiveConfig(): Promise<AutoExecutorConfig | null> {
    return this.getConfig();
  }

  /** Persist a decision to executor_decisions (fire-and-forget) so it survives restart
   *  and is queryable/streamable by the frontend. */
  private persistDecision(dec: ExecutorDecision): void {
    const db = getDb();
    db.insert(executorDecisions).values({
      userId: 1,
      symbol: dec.symbol,
      action: dec.action,
      gate: dec.gate ?? null,
      reason: dec.reason,
      direction: dec.signal?.direction ?? null,
      compositeScore: dec.signal?.compositeScore ?? null,
      strategy: dec.signal?.strategy ?? null,
      llmDecision: dec.llmDecision ?? null,
      signalId: dec.signalId ?? null,
    }).catch(() => {});
  }

  private async getConfig(): Promise<AutoExecutorConfig | null> {
    if (this.configCache && Date.now() - this.configCacheAt < this.CONFIG_TTL_MS) {
      return this.configCache;
    }
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, 1))
        .limit(1);

      if (rows[0]) {
        this.configCache = rows[0];
      } else if (env.autoExecute) {
        this.configCache = await this.initializeDefaultConfig();
      } else {
        this.configCache = null;
      }
      this.configCacheAt = Date.now();
    } catch {
      // Keep stale cache; fall back to default if env switch is on
      if (!this.configCache && env.autoExecute) {
        this.configCache = AutoExecutor.DEFAULT_CONFIG;
      }
    }
    return this.configCache;
  }

  private async initializeDefaultConfig(): Promise<AutoExecutorConfig> {
    const db = getDb();
    const defaults = {
      userId: 1,
      enabled: true,
      targetSymbols: AutoExecutor.DEFAULT_CONFIG.targetSymbols as string[],
      defaultSizeUsdt: AutoExecutor.DEFAULT_CONFIG.defaultSizeUsdt,
      defaultLeverage: AutoExecutor.DEFAULT_CONFIG.defaultLeverage!,
      stopLossPct: AutoExecutor.DEFAULT_CONFIG.stopLossPct,
      tp1Pct: AutoExecutor.DEFAULT_CONFIG.tp1Pct,
      tp2Pct: AutoExecutor.DEFAULT_CONFIG.tp2Pct,
      llmConfidenceThreshold: AutoExecutor.DEFAULT_CONFIG.llmConfidenceThreshold!,
      maxPositionsPerSymbol: AutoExecutor.DEFAULT_CONFIG.maxPositionsPerSymbol!,
      maxTotalPositions: AutoExecutor.DEFAULT_CONFIG.maxTotalPositions!,
      capitalAllocationPct: AutoExecutor.DEFAULT_CONFIG.capitalAllocationPct,
      useStrategyLeverage: AutoExecutor.DEFAULT_CONFIG.useStrategyLeverage,
      paperStartingBalance: AutoExecutor.DEFAULT_CONFIG.paperStartingBalance,
      paperCurrency: AutoExecutor.DEFAULT_CONFIG.paperCurrency,
      useLlmAdvisor: true,
      brainGateEnabled: true,
      brainDriverEnabled: true,
      brainShadowMode: false,
    };

    await db.insert(autoExecutorConfig).values(defaults).catch(() => {});
    console.log("[auto-executor] No config row found — created default config (AUTO_EXECUTE=true)");
    return { ...AutoExecutor.DEFAULT_CONFIG, ...defaults, id: 0, createdAt: new Date(), updatedAt: new Date() };
  }

  private skip(signal: Signal, reason: string, gate: string, extra?: Partial<ExecutorDecision>): ExecutorDecision {
    this.state.skipsToday++;
    this.state.signalsProcessed++;
    const dec: ExecutorDecision = {
      symbol: signal.symbol,
      action: "skip",
      reason,
      gate,
      signalId: signal.id ?? undefined,
      signal: { direction: signal.direction, compositeScore: signal.compositeScore, strategy: "" },
      ts: Date.now(),
      ...extra,
    };
    this.state.lastDecision = dec;
    autoExecutorEvents.emit("decision", dec);
    this.persistDecision(dec);
    console.log(`[auto-executor] SKIP ${signal.symbol} (${gate}) — ${reason}`);
    return dec;
  }

  private async prepareExecutionContext(signal: Signal, config: AutoExecutorConfig) {
    // Convert CoinDCX symbol (B-ETH_USDT) → Binance format (ETHUSDT)
    const symbol = signal.symbol.startsWith("B-")
      ? signal.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
      : signal.symbol;
    const side = signal.direction as "long" | "short";
    const isPaperMode = !env.placeOrders;

    const db = getDb();
    const openCount = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open")))
      .then((r) => r.length);

    let walletFree = 0;
    let walletLocked = 0;
    const dbCreds = await db
      .select()
      .from(exchangeCredentials)
      .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
      .limit(1);

    const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;

    // Always fetch live wallet data for monitoring, even in paper mode
    let liveWalletFree = 0;
    let liveWalletLocked = 0;
    if (coindcxCreds) {
      try {
        const liveWallets = await getFuturesWallet(coindcxCreds);
        for (const w of liveWallets) {
          liveWalletFree += parseFloat(w.balance ?? "0");
          liveWalletLocked += parseFloat(w.locked_balance ?? "0");
        }
      } catch {
        // Live wallet unavailable; keep zeros
      }
    }

    if (isPaperMode) {
      const paperBalance = parseFloat(config.paperStartingBalance ?? "100000");
      const paperCurrency = (config.paperCurrency as "USDT" | "INR") ?? "INR";
      const pw = await getPaperWallet(1, paperBalance, paperCurrency);
      walletFree = pw.balance;
      walletLocked = pw.lockedMargin;
    } else {
      walletFree = liveWalletFree;
      walletLocked = liveWalletLocked;
      if (!coindcxCreds || liveWalletFree === 0) {
        return null;
      }
    }

    const session = await getOrCreateSession(1, walletFree || 10_000);

    return { symbol, side, isPaperMode, openCount, walletFree, walletLocked, session, creds: coindcxCreds ?? undefined };
  }

  private async processSignal(signal: Signal, config: AutoExecutorConfig): Promise<ExecutorDecision> {
    this.state.signalsProcessed++;

    const context = await this.prepareExecutionContext(signal, config);
    if (!context) return this.skip(signal, "execution context unavailable", "context");

    const { symbol, side, isPaperMode, openCount, walletFree, walletLocked, session } = context;

    // ─── Governor: deterministic safety gates ───
    const govOutcome = await globalGovernor.evaluate({
      signal,
      config,
      targetSymbols: (config.targetSymbols as string[]) ?? ["BTCUSDT", "ETHUSDT"],
      dedupWindowMs: this.DEDUP_WINDOW_MS,
      recentExecutions: this.recentExecutions,
      openCount,
      isPaperMode,
      walletFree,
      walletLocked,
      session,
    });

    if (!govOutcome.approved) {
      return this.skip(signal, govOutcome.reason, govOutcome.gate);
    }

    // ─── Brain & LLM Advisor Evaluation ───
    const brainOutcome = await this.evaluateBrainAuthority(signal, config);
    if (brainOutcome && brainOutcome.action === "skip") {
      return this.skip(signal, brainOutcome.reason, brainOutcome.gate, { llmDecision: brainOutcome.llmDecision });
    }

    const advisorAdvice = await this.evaluateLlmAdvisor(signal, config, context);
    if (advisorAdvice && advisorAdvice.action === "skip") {
      return this.skip(signal, advisorAdvice.reason, advisorAdvice.gate, { llmDecision: advisorAdvice.llmDecision });
    }

    // ─── Kronos Gate Evaluation ───
    const kronosAdvice = await this.evaluateKronosGate(signal, config, context);
    if (kronosAdvice && kronosAdvice.action === "skip") {
      return this.skip(signal, kronosAdvice.reason, kronosAdvice.gate, { llmDecision: kronosAdvice.kronosDecision });
    }

    // ─── Sizing & Price Discovery ───
    const currentPrice = await this.getCurrentPrice(symbol, signal);
    if (!currentPrice || currentPrice <= 0) {
      return this.skip(signal, "no price feed", "no_price");
    }

    // Gate 7b: Price drift protection
    const sigMetadata = signal.metadata as Record<string, any> | null;
    const signalPrice = sigMetadata?.signalPrice as number | undefined;
    if (signalPrice && signalPrice > 0) {
      const drift = Math.abs(currentPrice - signalPrice) / signalPrice;
      if (drift > 0.005) {
        return this.skip(signal, `price drift: ${(drift * 100).toFixed(2)}% > 0.5%`, "price_drift");
      }
    }

    const sizing = await this.calculateSizing({
      signal,
      config,
      context,
      currentPrice,
      brainResult: brainOutcome?.brainResult,
      advisorAdvice,
    });

    if (sizing.skipReason) {
      return this.skip(signal, sizing.skipReason, sizing.skipGate || "sizing");
    }

    const paperCurrency = (config.paperCurrency as "USDT" | "INR") ?? "INR";

    // ─── Execution ───
    await this.executePosition({
      userId: 1,
      symbol,
      side,
      currentPrice,
      size: sizing.size,
      leverage: sizing.leverage,
      notional: sizing.notional,
      stopLoss: sizing.stopLoss,
      takeProfit: sizing.takeProfit,
      signalId: signal.id ?? undefined,
      strategyType: sizing.strategyType,
      creds: context.creds,
      isPaper: isPaperMode,
      paperCurrency,
      disableTrailing: sigMetadata?.disableTrailing === true || sigMetadata?.disableTrailing === "true",
      entryReason: sizing.entryReason,
    });

    // Record execution
    const dedupKey = `${symbol}:${signal.direction}`;
    this.recentExecutions.set(dedupKey, Date.now());
    await this.saveDedupCache();



    session.tradeCount++;
    await updateSession(session);

    const equity = isPaperMode
      ? await getPaperEquity(1, paperCurrency)
      : walletFree - sizing.notional / sizing.leverage;
    await snapshotEquity(1, equity, 0, session.realizedPnl);

    this.state.executionsToday++;
    const dec: ExecutorDecision = {
      symbol,
      action: "execute",
      reason: `score ${signal.compositeScore} ≥ ${signal.threshold}, ${side}`,
      gate: "executed",
      signalId: signal.id ?? undefined,
      signal: {
        direction: side,
        compositeScore: signal.compositeScore,
        strategy: sizing.strategyType,
      },
      llmDecision: advisorAdvice?.llmDecision,
      ts: Date.now(),
    };

    // Update brain episode
    await this.updateBrainEpisode(signal, brainOutcome?.brainResult);

    this.state.lastDecision = dec;
    autoExecutorEvents.emit("decision", dec);
    this.persistDecision(dec);
    console.log(`[auto-executor] EXECUTE ${symbol} ${side} size=${sizing.size.toFixed(4)} @ ${currentPrice}`);
    return dec;
  }

  private async evaluateBrainAuthority(signal: Signal, _config: AutoExecutorConfig): Promise<{ action: "skip" | "approve"; reason: string; gate: string; llmDecision?: ExecutorDecision["llmDecision"]; brainResult?: any } | null> {
    const brainConfig = await brainOrchestrator.getConfig(1);
    const brainHasAuthority = brainConfig.gateEnabled && !brainConfig.shadowMode;

    if (brainHasAuthority) {
      console.log(`[Auto-Executor] Brain authority active — awaiting verdict for ${signal.symbol}...`);
      const brainResult = await brainOrchestrator.evaluate(signal, 1).catch((err) => {
        console.warn("[Auto-Executor] Brain evaluation failed:", err.message);
        return null;
      });

      if (brainResult) {
        const confidence = brainResult.confidence * 100;
        if (brainResult.verdict === "EXIT_NOW") {
          return { action: "skip", reason: `Brain veto: ${brainResult.rationale}`, gate: "brain_veto", llmDecision: { decision: "skip", confidence, reasoning: brainResult.rationale, keyUsed: "brain" }, brainResult };
        }
        if (brainResult.verdict === "CAUTION") {
          return { action: "skip", reason: `Brain caution: ${brainResult.rationale}`, gate: "brain_caution", llmDecision: { decision: "skip", confidence, reasoning: brainResult.rationale, keyUsed: "brain" }, brainResult };
        }
        return { action: "approve", reason: "Brain approved", gate: "brain", brainResult };
      }
    } else {
      const brainPromise = brainOrchestrator.evaluate(signal, 1).catch((err) => {
        console.warn("[Auto-Executor] Brain shadow evaluation failed:", err.message);
        return null;
      });
      (signal as any)._brainPromise = brainPromise;
    }
    return null;
  }

  private async evaluateLlmAdvisor(signal: Signal, config: AutoExecutorConfig, context: any): Promise<{ action: "skip" | "approve"; reason: string; gate: string; llmDecision?: ExecutorDecision["llmDecision"]; sizeMult?: number; stopLossPct?: number; takeProfitPct?: number } | null> {
    const sigMetadata = signal.metadata as Record<string, any> | null;
    const isBrainDriven = sigMetadata?.source === "brain-driver";
    if (!config.useLlmAdvisor || isBrainDriven) return null;

    const { symbol, side, openCount, session } = context;
    const regimeData = latestRegimeCache.get("BTCUSDT");
    const currentPrice = latestTickerCache.get(symbol)?.lastPrice ?? 0;

    const llmCtx: SignalContext = {
      symbol,
      direction: side,
      compositeScore: parseFloat(signal.compositeScore),
      threshold: parseFloat(signal.threshold),
      regime: regimeData?.regime ?? "unknown",
      strategy: regimeData?.strategy ?? "intraday",
      currentPrice,
      drawdownPct: session.startingBalance > 0
        ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance * 100
        : 0,
      tradeCount: session.tradeCount,
      openPositions: openCount,
      rsi: sigMetadata?.rsi,
      ema20: sigMetadata?.ema20,
      ema50: sigMetadata?.ema50,
      spread: sigMetadata?.spread,
      imbalance: sigMetadata?.imbalance,
      brainGateEnabled: config.brainGateEnabled,
      brainShadowMode: config.brainShadowMode,
    };

    const advice = await globalLlmAdvisor.analyzeSignal(llmCtx);
    const llmDecision = {
      decision: advice.decision,
      confidence: advice.confidence,
      reasoning: advice.reasoning,
      keyUsed: advice.keyUsed,
    };

    await this.logLlmDecision(signal.id ?? 0, advice, symbol).catch(() => {});

    const threshold = config.llmConfidenceThreshold ?? 70;
    if (advice.decision === "skip" && advice.confidence >= threshold) {
      return { action: "skip", reason: `LLM skip (${advice.confidence}%): ${advice.reasoning}`, gate: "llm", llmDecision };
    }

    return {
      action: "approve",
      reason: "LLM advisor approved",
      gate: "llm",
      llmDecision,
      sizeMult: advice.sizeMult,
      stopLossPct: advice.stopLossPct,
      takeProfitPct: advice.takeProfitPct,
    };
  }

  private async evaluateKronosGate(
    _signal: Signal,
    config: AutoExecutorConfig,
    context: any
  ): Promise<{ action: "skip" | "approve"; reason: string; gate: string; kronosDecision?: any } | null> {
    if (!config.useKronosFilter) return null;

    const kronos = await getKronosSignal(context.symbol, "1m", 4);
    if (!kronos) return null;

    const side = context.side as "long" | "short";
    const kronosDirection = kronos.directionSignal > 0.05 ? "long" : kronos.directionSignal < -0.05 ? "short" : "neutral";

    const threshold = parseFloat(config.kronosConfidenceThreshold ?? "0.5000");

    if (kronos.confidence < threshold) {
      return {
        action: "skip",
        reason: `Kronos confidence ${(kronos.confidence * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% — unclear directional bias`,
        gate: "kronos_confidence",
        kronosDecision: { decision: "skip", confidence: kronos.confidence * 100, reasoning: "low confidence", keyUsed: "kronos" }
      };
    }

    if (kronosDirection !== "neutral" && kronosDirection !== side) {
      return {
        action: "skip",
        reason: `Kronos veto: predicts ${kronosDirection} but signal is ${side} (signal=${kronos.directionSignal.toFixed(3)})`,
        gate: "kronos_veto",
        kronosDecision: { decision: "skip", confidence: kronos.confidence * 100, reasoning: `veto, predicts ${kronosDirection}`, keyUsed: "kronos" }
      };
    }

    if (kronos.volatilityForecast > 0.12) {
      return {
        action: "skip",
        reason: `Kronos volatility forecast ${(kronos.volatilityForecast * 100).toFixed(1)}% > 12% — avoiding chaotic conditions`,
        gate: "kronos_volatility",
        kronosDecision: { decision: "skip", confidence: kronos.confidence * 100, reasoning: "high volatility", keyUsed: "kronos" }
      };
    }

    return {
      action: "approve",
      reason: `Kronos aligned: ${kronosDirection} (conf=${(kronos.confidence * 100).toFixed(0)}%, vol=${(kronos.volatilityForecast * 100).toFixed(1)}%)`,
      gate: "kronos",
      kronosDecision: { decision: "execute", confidence: kronos.confidence * 100, reasoning: `aligned: ${kronosDirection}`, keyUsed: "kronos" }
    };
  }

  private async getCurrentPrice(symbol: string, signal: Signal): Promise<number> {
  let currentPrice = markPriceCache.get(signal.symbol) ?? 0;
  if (currentPrice <= 0) currentPrice = latestTickerCache.get(symbol)?.lastPrice ?? 0;
  if (currentPrice <= 0) currentPrice = marketStateManager.get(symbol)?.ltp ?? 0;

  if (currentPrice <= 0) {
    try {
      const klines = await fetchKlines(symbol, "1m", 1);
      const restPrice = klines[0] ? parseFloat(klines[0].close) : 0;
      if (restPrice > 0) {
        currentPrice = restPrice;
        latestTickerCache.set(symbol, { lastPrice: restPrice, symbol });
      }
    } catch { /* ignored */ }
  }
  return currentPrice;
}

private async calculateSizing(params: {
  signal: Signal;
  config: AutoExecutorConfig;
  context: any;
  currentPrice: number;
  brainResult?: any;
  advisorAdvice?: any;
}) {
  const { signal, config, context, currentPrice, brainResult, advisorAdvice } = params;
  const { side, walletFree, session, isPaperMode } = context;
  const sigMetadata = signal.metadata as Record<string, any> | null;
  const regimeData = latestRegimeCache.get("BTCUSDT");
  const strategyType = (regimeData?.strategy ?? "intraday") as StrategyType;
  const paperCurrency = (config.paperCurrency as "USDT" | "INR") ?? "INR";

  const isManualOverride = sigMetadata?.sizeUsdt !== undefined && sigMetadata.sizeUsdt !== null;
  const availEquityRaw = walletFree || session.startingBalance;
  const availEquityUsdt = isPaperMode
    ? await walletToUsdt(availEquityRaw, paperCurrency)
    : availEquityRaw;
  const baseAllocPct = parseFloat(
    config.capitalAllocationPct ?? (isPaperMode ? "0.250" : "0.150")
  );
  const maxAllocPct = isPaperMode
    ? Math.max(baseAllocPct, 0.30)
    : Math.min(baseAllocPct, 0.20);

  const score = parseFloat(signal.compositeScore) || 75;
  const scoreMult = Math.max(0.7, Math.min(1.0, 0.7 + 0.3 * ((score - 75) / 25)));

  let convictionMult = scoreMult * (advisorAdvice?.sizeMult ?? 1.0);
  const brainHasAuthority = config.brainGateEnabled && !config.brainShadowMode;
  if (brainHasAuthority && brainResult) {
    convictionMult *= brainResult.verdict === "REDUCE_RISK" ? 0.4 : 1.0;
  }

  // NEW: Kronos conviction scaling
  let kronosVolForecast: number | null = null;
  try {
    const kronos = await getKronosSignal(signal.symbol, "1m", 4);
    if (kronos) {
      kronosVolForecast = kronos.volatilityForecast;
      if (kronos.confidence > 0.7) {
        const kronosDirection = kronos.directionSignal > 0 ? "long" : "short";
        if (kronosDirection === side) {
          convictionMult *= 1.2; // agreement boost
        } else {
          convictionMult *= 0.6; // disagreement penalty
        }
      }
    }
  } catch (err) {
    console.warn(`[auto-executor] Failed to fetch Kronos signal for sizing:`, err);
  }

  let notional = isManualOverride
    ? parseFloat(String(sigMetadata!.sizeUsdt))
    : availEquityUsdt * baseAllocPct * convictionMult;

  if (brainHasAuthority && brainResult?.adjustedSizeUsdt) {
    notional = brainResult.adjustedSizeUsdt;
  }

  if (!isManualOverride) {
    notional = Math.min(notional, availEquityUsdt * maxAllocPct);
  }

  const strategyMaxLev = STRATEGY_CONFIGS[strategyType]?.maxLeverage ?? 5;
  const manualLeverage = sigMetadata?.leverage ? parseFloat(String(sigMetadata.leverage)) : undefined;
  const rawLeverage = manualLeverage !== undefined
    ? manualLeverage
    : (config.useStrategyLeverage ? strategyMaxLev : Math.min(config.defaultLeverage ?? 3, strategyMaxLev));
  let leverage = manualLeverage !== undefined ? rawLeverage : Math.min(rawLeverage, 10);

  // NEW: Kronos volatility-based leverage cap
  if (kronosVolForecast !== null && kronosVolForecast > 0.10) {
    leverage = Math.min(leverage, 2);
    console.log(`[auto-executor] Kronos high vol detected (${kronosVolForecast}) — capping leverage at ${leverage}x`);
  }

  let size = notional / currentPrice;
  let basePrecision = 2;

  try {
    const instrInfo = await getFuturesInstrumentInfo(params.signal.symbol);
    if (instrInfo) {
      const minQty = parseFloat(instrInfo.min_quantity ?? instrInfo.min_qty ?? "0");
      const stepSize = parseFloat(instrInfo.step ?? instrInfo.quantity_step ?? "0");
      basePrecision = instrInfo.base_currency_precision ?? 2;

      if (minQty > 0 && size < minQty) {
        return { size: 0, leverage: 0, notional: 0, stopLoss: 0, takeProfit: 0, strategyType, skipReason: `size ${size.toFixed(6)} < min qty ${minQty}`, skipGate: "min_qty" };
      }
      if (stepSize > 0) {
        size = Math.floor(size / stepSize) * stepSize;
      } else {
        size = parseFloat(size.toFixed(instrInfo.target_currency_precision ?? 4));
      }

      // Re-check min quantity after rounding down to step size — rounding can push size below the exchange minimum
      if (minQty > 0 && size < minQty) {
        return { size: 0, leverage: 0, notional: 0, stopLoss: 0, takeProfit: 0, strategyType, skipReason: `rounded size ${size.toFixed(6)} < min qty ${minQty}`, skipGate: "min_qty" };
      }

      // Min notional check — exchange rejects orders whose value (qty × price) is below this threshold
      const minNotional = parseFloat(instrInfo.min_notional ?? "0");
      const roundedNotional = size * currentPrice;
      if (minNotional > 0 && roundedNotional < minNotional) {
        return { size: 0, leverage: 0, notional: 0, stopLoss: 0, takeProfit: 0, strategyType, skipReason: `notional $${roundedNotional.toFixed(2)} < min notional $${minNotional}`, skipGate: "min_notional" };
      }
    }
  } catch (err) {
    console.warn(`[auto-executor] Failed to fetch instrument info:`, err);
  }

  let slPct = advisorAdvice?.stopLossPct ?? (sigMetadata?.stopLossPct ? parseFloat(String(sigMetadata.stopLossPct)) : parseFloat(config.stopLossPct ?? "0.015"));
  let tp1Pct = advisorAdvice?.takeProfitPct ?? (sigMetadata?.takeProfitPct ? parseFloat(String(sigMetadata.takeProfitPct)) : parseFloat(config.tp1Pct ?? "0.015"));

  if (brainHasAuthority && brainResult) {
    if (brainResult.adjustedSlPct !== undefined) slPct = brainResult.adjustedSlPct / 100;
    if (brainResult.adjustedTpPct !== undefined) tp1Pct = brainResult.adjustedTpPct / 100;
  }

  // ── Sanity clamp: catch any remaining misscaled or out-of-range values ──
  const minSlPct = SYMBOL_MIN_SL_PCT[params.signal.symbol as SupportedSymbol] ?? DEFAULT_MIN_SL_PCT;
  const MAX_SL_PCT = 0.08;   // 8%
  const MIN_TP_PCT = 0.005;  // 0.5%
  const MAX_TP_PCT = 0.15;   // 15%

  if (slPct > 1) {
    console.warn(`[auto-executor] slPct ${slPct} appears to be a whole percentage — dividing by 100`);
    slPct = slPct / 100;
  }
  if (tp1Pct > 1) {
    console.warn(`[auto-executor] tp1Pct ${tp1Pct} appears to be a whole percentage — dividing by 100`);
    tp1Pct = tp1Pct / 100;
  }

  slPct = Math.max(minSlPct, Math.min(MAX_SL_PCT, slPct));
  tp1Pct = Math.max(MIN_TP_PCT, Math.min(MAX_TP_PCT, tp1Pct));

  const stopLoss = parseFloat((side === "long" ? currentPrice * (1 - slPct) : currentPrice * (1 + slPct)).toFixed(basePrecision));
  const takeProfit = parseFloat((side === "long" ? currentPrice * (1 + tp1Pct) : currentPrice * (1 - tp1Pct)).toFixed(basePrecision));

  // ── Final sanity: SL must be on correct side of entry ──
  if (side === "long" && stopLoss >= currentPrice) {
    console.warn(`[auto-executor] SL ${stopLoss} >= entry ${currentPrice} for LONG — resetting to -${(minSlPct * 100).toFixed(1)}%`);
    const correctedSl = parseFloat((currentPrice * (1 - minSlPct)).toFixed(basePrecision));
    return { size, leverage, notional, stopLoss: correctedSl, takeProfit, strategyType };
  }
  if (side === "short" && stopLoss <= currentPrice) {
    console.warn(`[auto-executor] SL ${stopLoss} <= entry ${currentPrice} for SHORT — resetting to +${(minSlPct * 100).toFixed(1)}%`);
    const correctedSl = parseFloat((currentPrice * (1 + minSlPct)).toFixed(basePrecision));
    return { size, leverage, notional, stopLoss: correctedSl, takeProfit, strategyType };
  }

  const book = marketStateManager.get(params.signal.symbol)?.orderBook;
  if (book) {
    const levels = side === "long" ? book.asks : book.bids;
    const totalDepth = levels.reduce((sum, [, qty]) => sum + qty, 0);
    if (totalDepth > 0 && size > totalDepth * 0.05) {
      return { size: 0, leverage: 0, notional: 0, stopLoss: 0, takeProfit: 0, strategyType, skipReason: `size ${size.toFixed(4)} > 5% of depth`, skipGate: "depth" };
    }
  }

  let entryReason = `Signal composite score ${signal.compositeScore} ≥ threshold ${signal.threshold}`;
  if (advisorAdvice?.llmDecision?.reasoning) entryReason = `AI: ${advisorAdvice.llmDecision.reasoning}`;
  else if (sigMetadata?.source === "brain-driver" && sigMetadata?.entryReason) entryReason = `Brain: ${String(sigMetadata.entryReason)}`;
  else if (sigMetadata?.source === "manual-trigger") entryReason = sigMetadata?.entryReason ? String(sigMetadata.entryReason) : "Manual Injection";

  return { size, leverage, notional, stopLoss, takeProfit, strategyType, entryReason };
}

private async updateBrainEpisode(signal: Signal, brainResult?: any) {
  const db = getDb();
  if (brainResult?.episodeId) {
    await db.update(brainEpisodes)
      .set({ executionResult: "executed" })
      .where(eq(brainEpisodes.id, brainResult.episodeId))
      .catch(() => {});
  } else if ((signal as any)._brainPromise) {
    const shadowBrainResult = await (signal as any)._brainPromise;
    if (shadowBrainResult?.episodeId) {
      await db.update(brainEpisodes)
        .set({ executionResult: "executed" })
        .where(eq(brainEpisodes.id, shadowBrainResult.episodeId))
        .catch(() => {});
    }
  }
}

private async executePosition(params: {
    userId: number;
    symbol: string;
    side: "long" | "short";
    currentPrice: number;
    size: number;
    leverage: number;
    notional: number;
    stopLoss: number;
    takeProfit: number;
    signalId?: number;
    strategyType: StrategyType;
    creds: { apiKey: string; apiSecret: string } | undefined;
    isPaper: boolean;
    paperCurrency?: "USDT" | "INR";
    disableTrailing?: boolean;
    entryReason?: string;
  }): Promise<void> {
    const db = getDb();
    const clientOrderId = `AE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currency = params.isPaper ? (params.paperCurrency ?? "INR") : "USDT";

    // 1. Structural evaluation via RiskManager
    const orderParams = {
      symbol: params.symbol,
      side: (params.side === "long" ? "BUY" : "SELL") as "BUY" | "SELL",
      orderType: "MARKET" as const,
      quantity: params.size.toString(),
      price: params.currentPrice.toString(),
      leverage: params.leverage,
      stopLoss: params.stopLoss ? params.stopLoss.toString() : undefined,
      takeProfit: params.takeProfit ? params.takeProfit.toString() : undefined,
    };
    await RiskManager.validateOrder(params.userId, orderParams, params.isPaper, currency);

    // 2. Insert order record into the database
    const orderId = await db.transaction(async (tx) => {
      const result = await tx
        .insert(orders)
        .values({
          clientOrderId,
          userId: params.userId,
          symbol: params.symbol,
          side: params.side === "long" ? "BUY" : "SELL",
          orderType: "MARKET",
          price: params.currentPrice.toString(),
          quantity: params.size.toString(),
          status: params.isPaper ? "OPEN" : "PENDING",
          leverage: params.leverage,
          stopLoss: params.stopLoss ? params.stopLoss.toString() : null,
          takeProfit: params.takeProfit ? params.takeProfit.toString() : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: orders.id });
      return result[0].id;
    });

    // 3. Pessimistically lock margin using WalletLedgerService
    const marginAllocation = new Decimal(params.size)
      .mul(new Decimal(params.currentPrice))
      .div(new Decimal(params.leverage))
      .toFixed(8);

    if (params.isPaper) {
      await lockPaperPositionMargin(
        params.userId,
        parseFloat(marginAllocation),
        orderId,
        currency,
        "order"
      );
    } else {
      await WalletLedgerService.lockMargin(
        params.userId,
        "live",
        currency,
        marginAllocation,
        orderId,
        "order"
      );
    }

    // 4. Execution path
    if (params.isPaper) {
      console.log(`[auto-executor] Enqueuing paper order ${clientOrderId} to matching engine queue`);
      const { Queue } = await import("bullmq");
      const { default: Redis } = await import("ioredis");
      const executionQueue = new Queue("EngineExecution", {
        connection: new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379") as any,
      });

      await executionQueue.add("ExecuteMatch", {
        clientOrderId,
        executionPrice: params.currentPrice.toString(),
        timestamp: Date.now(),
      });
    } else {
      if (!params.creds) {
        throw new Error("No exchange credentials found for live execution");
      }

      let exchangeOrderId: string | undefined;
      try {
        const coindcxSym = `B-${params.symbol.replace("USDT", "_USDT")}`;
        const order = await placeEntryOrder(
          { apiKey: params.creds.apiKey, apiSecret: params.creds.apiSecret },
          {
            market: coindcxSym,
            side: params.side === "long" ? "buy" : "sell",
            total_quantity: params.size,
            price: params.currentPrice,
            leverage: params.leverage,
            client_order_id: clientOrderId,
          },
          STRATEGY_CONFIGS[params.strategyType]?.preferLimitEntry ?? false,
          params.symbol
        );
        exchangeOrderId = order?.id;
        console.log(`[auto-executor] Exchange order placed: ${exchangeOrderId} (client=${clientOrderId})`);

        const remaining = parseFloat(order?.remaining_quantity ?? "0");
        if (remaining > 0) {
          console.warn(
            `[auto-executor] Order ${exchangeOrderId} partially filled — remaining=${remaining}`
          );
        }

        const fillPrice = parseFloat(order?.avg_price || order?.price_per_unit || "0") || params.currentPrice;

        const posId = await db.transaction(async (tx) => {
          await tx
            .update(orders)
            .set({
              status: "FILLED",
              filledQuantity: params.size.toString(),
              updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

          const result = await tx
            .insert(positions)
            .values({
              userId: params.userId,
              symbol: params.symbol,
              side: params.side,
              entryPrice: String(fillPrice),
              currentPrice: String(fillPrice),
              size: String(params.size),
              leverage: params.leverage,
              margin: String((params.size * fillPrice / params.leverage).toFixed(4)),
              marginCurrency: "USDT",
              stopLoss: String(params.stopLoss),
              takeProfit: String(params.takeProfit),
              unrealizedPnl: "0",
              realizedPnl: "0",
              status: "open",
              exchangeOrderId: exchangeOrderId,
              signalId: params.signalId,
              strategyType: params.strategyType,
              isPaper: false,
              entryReason: params.entryReason,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning({ id: positions.id });
          return result[0].id;
        });

        const feeVal = estimateFee(params.size * fillPrice);
        await WalletLedgerService.chargeFee(
          params.userId,
          "live",
          "USDT",
          feeVal.toFixed(8),
          posId
        );

        await recordPositionTransaction({
          positionId: posId,
          userId: params.userId,
          symbol: params.symbol,
          type: "OPEN",
          side: params.side,
          quantityBefore: 0,
          quantityAfter: params.size,
          quantityDelta: params.size,
          price: fillPrice,
          avgEntryPrice: fillPrice,
          realizedPnl: 0,
          fee: feeVal,
          marginBefore: 0,
          marginAfter: (params.size * fillPrice) / params.leverage,
          metadata: {
            signalId: params.signalId,
            strategyType: params.strategyType,
            isPaper: false,
            exchangeOrderId: exchangeOrderId ?? clientOrderId,
            leverage: params.leverage,
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
          },
        });

        if (!params.disableTrailing) {
          registerPositionForTrailing({
            id: posId,
            symbol: params.symbol,
            side: params.side,
            entryPrice: fillPrice,
            stopLoss: params.stopLoss,
            strategyType: params.strategyType,
            userId: params.userId,
            size: params.size,
          });
        }
      } catch (err: any) {
        console.error(
          `[auto-executor] Exchange order failed: ${err.message}. Rejecting order and refunding margin...`
        );
        await db
          .update(orders)
          .set({ status: "REJECTED", updatedAt: new Date() })
          .where(eq(orders.id, orderId));

        await WalletLedgerService.refundMargin(
          params.userId,
          "live",
          "USDT",
          marginAllocation,
          orderId,
          "order"
        );
        throw err;
      }
    }

    tradingEvents.emit(`portfolio-update:${params.userId}`);
  }

  private async logLlmDecision(
    signalId: number,
    decision: { decision: string; confidence: number; reasoning: string; keyUsed: string; latencyMs: number },
    symbol: string
  ): Promise<void> {
    const db = getDb();
    await db.insert(systemLogs).values({
      level: "info",
      component: "llm-advisor",
      event: `signal_analysis`,
      message: `${symbol}: ${decision.decision} (${decision.confidence}%) via ${decision.keyUsed}`,
      metadata: { signalId, ...decision },
    });
    // Feed the live llm.decisionStream subscription (previously never emitted).
    llmDecisionEvents.emit("decision", { symbol, signalId, ...decision, ts: Date.now() });
  }

  // Handles exit‑signal events emitted by the exit‑manager
  private async handleExitSignal(payload: {
    positionId: number;
    symbol: string;
    strategyType: StrategyType;
    currentPrice: number;
    decision: ExitDecision;
  }): Promise<void> {
    const db = getDb();
    const pos = await db.select().from(positions).where(eq(positions.id, payload.positionId)).limit(1);
    if (pos.length === 0) return;
    const position = pos[0];

    const realizedPnl = payload.decision.feeAdjustedPnl ?? 0;
    const unrealizedPnl = payload.decision.unrealizedPnl ?? 0;

    await db
      .update(positions)
      .set({
        status: "closed",
        currentPrice: String(payload.currentPrice),
        realizedPnl: String(realizedPnl),
        unrealizedPnl: String(unrealizedPnl),
        exitReason: payload.decision.reason,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, payload.positionId));

    if (position.isPaper) {
      const cfg = await this.getConfig();
      const paperCurrency = (position.marginCurrency as "USDT" | "INR") ?? (cfg?.paperCurrency as "USDT" | "INR") ?? "INR";
      await releasePaperPositionMargin(
        position.userId,
        parseFloat(position.margin),
        realizedPnl,
        position.id,
        paperCurrency
      );
    } else {
      console.log(`[auto-executor] Live position ${position.symbol} #${position.id} exit signal — DB updated, no exchange order placed (monitor-only)`);
    }

    // Update signal outcome for post-trade analysis / win-rate tracking
    if (position.signalId) {
      const reason = payload.decision.reason ?? "";
      const outcome = reason.includes("Stop Loss")
        ? "sl_hit"
        : reason.includes("Take Profit")
        ? "tp_hit"
        : "manual_close";
      db.update(signals)
        .set({ outcome })
        .where(eq(signals.id, position.signalId))
        .catch(() => {});
    }

    // Update risk session so cooldown and drawdown circuit breakers fire correctly
    const session = await getOrCreateSession(position.userId, 0);
    const updatedSession = globalRiskEngine.recordTrade(session, { pnl: realizedPnl });
    await updateSession(updatedSession);

    // Trigger LLM reflection on trade close (fire-and-forget)
    const episodeRow = await db.select({ id: brainEpisodes.id })
      .from(brainEpisodes)
      .where(eq(brainEpisodes.positionId, position.id))
      .orderBy(brainEpisodes.createdAt)
      .limit(1);
    if (episodeRow[0]) {
      reflectOnTrade(episodeRow[0].id, realizedPnl, {
        action: payload.decision.reason,
        exitPrice: payload.currentPrice,
        realizedPnl,
      }).catch((err: any) => {
        console.warn('[Auto-Executor] Reflection failed:', err.message);
      });
    }

    // Clean up trailing‑stop monitoring
    unregisterPosition(position.id);
    tradingEvents.emit(`portfolio-update:${position.userId}`);
  }
}

export const globalAutoExecutor = new AutoExecutor();
