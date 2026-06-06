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
import { positions, exchangeCredentials, autoExecutorConfig, systemLogs, signals } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { globalKillSwitch } from "./kill-switch";
import { isFundingExtreme } from "./funding-filter";
import { checkCorrelation } from "./correlation-guard";
import { globalRiskEngine, getOrCreateSession, updateSession } from "./risk-engine";
import { globalLlmAdvisor, type SignalContext } from "./llm-advisor";
import { latestTickerCache } from "./streaming";
import { marketStateManager } from "./market-state";
import { markPriceCache, tradingEvents } from "./coindcx-ws";
import { fetchKlines } from "./binance";
import { createFuturesOrder, getFuturesWallet, getFuturesInstrumentInfo } from "./coindcx";
import { registerPositionForTrailing, unregisterPosition } from "./trailing-stop";
import { knnSnapshotCache } from "./knn-supertrend";
import { STRATEGY_CONFIGS } from "./strategy-config";
import { latestRegimeCache } from "./regime-detector";
import type { ExitDecision } from "./exit-manager";
import { snapshotEquity } from "./performance-tracker";
import { getPaperWallet, lockPaperMargin, releasePaperMargin, getPaperEquity } from "./paper-wallet";
import { env } from "../lib/env";
import { decryptCreds } from "../lib/crypto";
import type { Signal, AutoExecutorConfig } from "@db/schema";
import type { StrategyType } from "./strategy-config";

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
  ts: number;
}

export interface AutoExecutorState {
  lastRun: number;
  signalsProcessed: number;
  executionsToday: number;
  skipsToday: number;
  lastDecision: ExecutorDecision | null;
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

  private saveDedupCache() {
    try {
      const obj: Record<string, number> = {};
      const now = Date.now();
      for (const [key, ts] of this.recentExecutions) {
        if (now - ts <= this.DEDUP_WINDOW_MS) {
          obj[key] = ts;
        }
      }
      fs.writeFileSync(DEDUP_FILE, JSON.stringify(obj, null, 2), "utf-8");
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
      this.saveDedupCache();
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
    capitalAllocationPct: "0.100",   // 10% of free balance per trade
    useStrategyLeverage: true,        // use STRATEGY_CONFIGS leverage per regime
    stopLossPct: "0.015",
    tp1Pct: "0.015",
    tp2Pct: "0.030",
    useLlmAdvisor: false,
    llmConfidenceThreshold: 70,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 3,
    paperStartingBalance: "10000",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

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
        // AUTO_EXECUTE=true but no row yet — upsert defaults and use them
        await db.insert(autoExecutorConfig).values({
          userId: 1,
          enabled: true,
          targetSymbols: AutoExecutor.DEFAULT_CONFIG.targetSymbols as string[],
          defaultSizeUsdt: AutoExecutor.DEFAULT_CONFIG.defaultSizeUsdt,
          defaultLeverage: AutoExecutor.DEFAULT_CONFIG.defaultLeverage!,
          stopLossPct: AutoExecutor.DEFAULT_CONFIG.stopLossPct,
          tp1Pct: AutoExecutor.DEFAULT_CONFIG.tp1Pct,
          tp2Pct: AutoExecutor.DEFAULT_CONFIG.tp2Pct,
          useLlmAdvisor: AutoExecutor.DEFAULT_CONFIG.useLlmAdvisor,
          llmConfidenceThreshold: AutoExecutor.DEFAULT_CONFIG.llmConfidenceThreshold!,
          maxPositionsPerSymbol: AutoExecutor.DEFAULT_CONFIG.maxPositionsPerSymbol!,
          maxTotalPositions: AutoExecutor.DEFAULT_CONFIG.maxTotalPositions!,
          capitalAllocationPct: AutoExecutor.DEFAULT_CONFIG.capitalAllocationPct,
          useStrategyLeverage: AutoExecutor.DEFAULT_CONFIG.useStrategyLeverage,
          paperStartingBalance: AutoExecutor.DEFAULT_CONFIG.paperStartingBalance,
        }).catch(() => {}); // ignore if already exists
        this.configCache = AutoExecutor.DEFAULT_CONFIG;
        console.log("[auto-executor] No config row found — created default config (AUTO_EXECUTE=true)");
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

  private skip(signal: Signal, reason: string, extra?: Partial<ExecutorDecision>): ExecutorDecision {
    this.state.skipsToday++;
    this.state.signalsProcessed++;
    const dec: ExecutorDecision = {
      symbol: signal.symbol,
      action: "skip",
      reason,
      signal: { direction: signal.direction, compositeScore: signal.compositeScore, strategy: "" },
      ts: Date.now(),
      ...extra,
    };
    this.state.lastDecision = dec;
    autoExecutorEvents.emit("decision", dec);
    console.log(`[auto-executor] SKIP ${signal.symbol} — ${reason}`);
    return dec;
  }

  private async processSignal(signal: Signal, config: AutoExecutorConfig): Promise<ExecutorDecision> {
    this.state.signalsProcessed++;
    // Convert CoinDCX symbol (B-ETH_USDT) → Binance format (ETHUSDT)
    const symbol = signal.symbol.startsWith("B-")
      ? signal.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
      : signal.symbol;

    const side = signal.direction as "long" | "short";
    const targetSymbols = (config.targetSymbols as string[]) ?? ["BTCUSDT", "ETHUSDT"];

    // Gate 1: symbol in target list
    if (!targetSymbols.includes(symbol)) return this.skip(signal, `${symbol} not in target list`);

    // Gate 1b: signal staleness — reject signals older than 60s
    const signalAgeMs = Date.now() - new Date(signal.createdAt).getTime();
    if (signalAgeMs > 60_000) {
      return this.skip(signal, `stale signal (${Math.round(signalAgeMs / 1000)}s old)`);
    }

    // Gate 1c: dedup — prevent same symbol+direction executing twice within 60s
    const dedupKey = `${symbol}:${signal.direction}`;
    const lastExec = this.recentExecutions.get(dedupKey) ?? 0;
    if (Date.now() - lastExec < this.DEDUP_WINDOW_MS) {
      return this.skip(
        signal,
        `dedup: same ${symbol} ${signal.direction} executed ${Math.round((Date.now() - lastExec) / 1000)}s ago`
      );
    }

    // Gate 2: kill switch
    if (!globalKillSwitch.canTrade()) return this.skip(signal, "kill switch active");

    // Compute execution mode early so subsequent gates are mode-aware
    const isPaperMode = !env.placeOrders || env.paperTrading;

    // Gate 3: no duplicate open position for this symbol (in current mode)
    const db = getDb();
    const existing = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.symbol, symbol), eq(positions.status, "open"), eq(positions.isPaper, isPaperMode)))
      .limit(1);
    if (existing.length > 0) return this.skip(signal, "position already open");

    // Gate 4: max total open positions (in current mode)
    const openCount = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open"), eq(positions.isPaper, isPaperMode)))
      .then((r) => r.length);
    const maxTotal = config.maxTotalPositions ?? 3;
    if (openCount >= maxTotal) return this.skip(signal, `max ${maxTotal} positions open`);

    // Gate 5: funding rate filter
    const fundingCheck = isFundingExtreme(symbol, side);
    if (fundingCheck.blocked) return this.skip(signal, fundingCheck.reason);

    // Gate 6: correlation guard
    const corrCheck = await checkCorrelation(symbol, side, 1);
    if (!corrCheck.allowed) return this.skip(signal, corrCheck.reason);

    // Gate 6b: spread filter — reject wide-spread / low-liquidity conditions
    const metadata = signal.metadata as Record<string, unknown> | null;
    const spreadPct = metadata?.spread as number | undefined;
    if (spreadPct !== undefined && spreadPct > 0.01) {
      return this.skip(signal, `spread ${(spreadPct * 100).toFixed(3)}% > 1% — low liquidity`);
    }

    // Gate 7: risk engine
    let walletFree = 0;
    let walletLocked = 0;

    const creds = await db
      .select()
      .from(exchangeCredentials)
      .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
      .limit(1);

    if (isPaperMode) {
      // Paper mode: use virtual wallet
      const paperBalance = parseFloat(config.paperStartingBalance ?? "10000");
      const pw = await getPaperWallet(1, paperBalance);
      walletFree = pw.balance;
      walletLocked = pw.lockedMargin;
    } else if (creds[0]) {
      try {
        const liveWallets = await getFuturesWallet(decryptCreds(creds[0]));
        for (const w of liveWallets) {
          walletFree += parseFloat(w.balance ?? "0");
          walletLocked += parseFloat(w.locked_balance ?? "0");
        }
      } catch {
        // Live wallet fetch failed — do not trade on phantom balance
        return this.skip(signal, "wallet balance unavailable — skipping to prevent oversizing");
      }
    }

    const session = getOrCreateSession(1, walletFree || 10_000);
    const sigMetadata = signal.metadata as Record<string, unknown> | null;
    const isManualOverride = sigMetadata?.sizeUsdt !== undefined && sigMetadata.sizeUsdt !== null;
    const sizeUsdt = isManualOverride
      ? parseFloat(String(sigMetadata.sizeUsdt))
      : parseFloat(config.defaultSizeUsdt ?? "50");
    const riskCheck = globalRiskEngine.checkTradeAllowed(session, {
      notional: sizeUsdt,
      walletBalance: walletFree || session.startingBalance,
      usedMargin: walletLocked,
    });
    if (!riskCheck.approved) return this.skip(signal, `risk: ${riskCheck.reason}`);

    // Gate 8: KNN SuperTrend filter
    // Suppresses trades in range regimes and when KNN bias conflicts with signal direction.
    const knnSnap = knnSnapshotCache.get(symbol);
    if (knnSnap) {
      if (knnSnap.regime === "range") {
        return this.skip(signal, `KNN: range regime — signals suppressed for ${symbol}`);
      }
      const knnMinConf = 60;
      const knnBias = knnSnap.knn.bias;
      const knnConf = knnSnap.knn.confidence;
      const biasSide = knnBias === "bullish" ? "long" : knnBias === "bearish" ? "short" : "neutral";
      if (knnBias !== "neutral" && knnConf >= knnMinConf && biasSide !== side) {
        return this.skip(signal, `KNN: bias=${knnBias} (${knnConf}%) conflicts with signal ${side}`);
      }
      if (knnConf < 40) {
        return this.skip(signal, `KNN: very low confidence (${knnConf}%) — skipping ${symbol}`);
      }
    }

    // Gate 9: LLM Advisor (optional)
    let sizeMult = 1.0;
    let slPctOverride: number | undefined;
    let tp1PctOverride: number | undefined;
    let llmDecision: ExecutorDecision["llmDecision"] | undefined;
    const regimeData = latestRegimeCache.get("BTCUSDT");

    if (config.useLlmAdvisor) {
      const currentPrice = latestTickerCache.get(symbol)?.lastPrice ?? 0;
      const metadata = signal.metadata as Record<string, unknown> | null;

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
        rsi: metadata?.rsi as number | undefined,
        ema20: metadata?.ema20 as number | undefined,
        ema50: metadata?.ema50 as number | undefined,
        spread: metadata?.spread as number | undefined,
        imbalance: metadata?.imbalance as number | undefined,
      };

      const advice = await globalLlmAdvisor.analyzeSignal(llmCtx);
      llmDecision = {
        decision: advice.decision,
        confidence: advice.confidence,
        reasoning: advice.reasoning,
        keyUsed: advice.keyUsed,
      };

      // Log to system_logs
      await this.logLlmDecision(signal.id ?? 0, advice, symbol).catch(() => {});

      const threshold = config.llmConfidenceThreshold ?? 70;
      if (advice.decision === "skip" && advice.confidence >= threshold) {
        return this.skip(signal, `LLM skip (${advice.confidence}%): ${advice.reasoning}`, { llmDecision });
      }
      sizeMult = advice.sizeMult ?? 1.0;
      slPctOverride = advice.stopLossPct;
      tp1PctOverride = advice.takeProfitPct;
    }

    // Position sizing — 4-level price fallback chain
    let currentPrice = markPriceCache.get(signal.symbol) ?? 0;
    if (currentPrice <= 0) {
      currentPrice = latestTickerCache.get(symbol)?.lastPrice ?? 0;
    }
    if (currentPrice <= 0) {
      currentPrice = marketStateManager.get(symbol)?.ltp ?? 0;
    }

    if (!currentPrice || currentPrice <= 0) {
      // Last resort: fetch via REST
      try {
        const klines = await fetchKlines(symbol, "1m", 1);
        const restPrice = klines[0] ? parseFloat(klines[0].close) : 0;
        if (restPrice > 0) {
          currentPrice = restPrice;
          // Seed the ticker cache so subsequent signals don't need REST
          latestTickerCache.set(symbol, { lastPrice: restPrice, symbol });
        }
      } catch {
        // REST also failed — skip
      }
    }

    if (!currentPrice || currentPrice <= 0) {
      return this.skip(signal, "no price feed");
    }

    // Gate 7b: Price drift protection check (Binance signal price vs CoinDCX execution price)
    const signalPrice = sigMetadata?.signalPrice as number | undefined;
    if (signalPrice && signalPrice > 0) {
      const drift = Math.abs(currentPrice - signalPrice) / signalPrice;
      const MAX_DRIFT_PCT = 0.005; // 0.5% maximum allowable price drift
      if (drift > MAX_DRIFT_PCT) {
        return this.skip(
          signal,
          `price drift: CoinDCX price ${currentPrice} vs Binance signal price ${signalPrice} is ${(drift * 100).toFixed(2)}% > ${(MAX_DRIFT_PCT * 100).toFixed(2)}%`
        );
      }
    }

    // Capital allocation: use configured % of free balance, capped by fixed USDT size
    const allocationPct = parseFloat(config.capitalAllocationPct ?? "0.10"); // e.g. 0.10 = 10%
    const balanceCap = isManualOverride
      ? Infinity
      : (walletFree || session.startingBalance) * allocationPct;
    const notional = Math.min(sizeUsdt * sizeMult, balanceCap);

    // Leverage: if useStrategyLeverage=true, use strategy's maxLeverage; else use defaultLeverage
    // Hard cap at 10× regardless of strategy config to prevent over-leveraged positions (unless manual override specifies leverage)
    const strategyMaxLev = STRATEGY_CONFIGS[regimeData?.strategy ?? "intraday"]?.maxLeverage ?? 5;
    const manualLeverage = sigMetadata?.leverage ? parseFloat(String(sigMetadata.leverage)) : undefined;
    const rawLeverage = manualLeverage !== undefined
      ? manualLeverage
      : (config.useStrategyLeverage
        ? strategyMaxLev
        : Math.min(config.defaultLeverage ?? 3, strategyMaxLev));
    const leverage = manualLeverage !== undefined ? rawLeverage : Math.min(rawLeverage, 10);

    // Validate size and precision against instrument specifications
    let rawSize = notional / currentPrice;
    let targetPrecision = 4;
    let basePrecision = 2;
    try {
      const instrInfo = await getFuturesInstrumentInfo(symbol);
      if (instrInfo) {
        const minQty   = parseFloat(instrInfo.min_quantity ?? instrInfo.min_qty ?? "0");
        const stepSize = parseFloat(instrInfo.step ?? instrInfo.quantity_step ?? "0");
        targetPrecision = instrInfo.target_currency_precision ?? 4;
        basePrecision = instrInfo.base_currency_precision ?? 2;

        if (minQty > 0 && rawSize < minQty) {
          return this.skip(signal,
            `size ${rawSize.toFixed(6)} < min qty ${minQty} for ${symbol} — increase defaultSizeUsdt`
          );
        }
        // Round down to nearest step
        if (stepSize > 0) {
          rawSize = Math.floor(rawSize / stepSize) * stepSize;
        } else {
          rawSize = parseFloat(rawSize.toFixed(targetPrecision));
        }
      }
    } catch (err) {
      console.warn(`[auto-executor] Failed to fetch instrument info for precision mapping:`, err);
    }
    const size = rawSize;
    const slPct = slPctOverride ?? (sigMetadata?.stopLossPct ? parseFloat(String(sigMetadata.stopLossPct)) : parseFloat(config.stopLossPct ?? "0.015"));
    const tp1Pct = tp1PctOverride ?? (sigMetadata?.takeProfitPct ? parseFloat(String(sigMetadata.takeProfitPct)) : parseFloat(config.tp1Pct ?? "0.015"));

    const stopLoss = side === "long"
      ? currentPrice * (1 - slPct)
      : currentPrice * (1 + slPct);
    const takeProfit = side === "long"
      ? currentPrice * (1 + tp1Pct)
      : currentPrice * (1 - tp1Pct);

    // Gate (depth): order size must be < 5% of available depth on the relevant side.
    // Prevents the bot from becoming the market for illiquid symbols.
    const book = marketStateManager.get(symbol)?.orderBook;
    if (book) {
      const levels = side === "long" ? book.asks : book.bids;
      const totalDepth = levels.reduce((sum, [, qty]) => sum + qty, 0);
      if (totalDepth > 0 && size > totalDepth * 0.05) {
        return this.skip(
          signal,
          `order size ${size.toFixed(4)} > 5% of book depth ${totalDepth.toFixed(4)} — too large for liquidity`
        );
      }
    }

    // Execute
    let entryReason = `Signal composite score ${signal.compositeScore} ≥ threshold ${signal.threshold}`;
    if (llmDecision?.reasoning) {
      entryReason = `AI: ${llmDecision.reasoning}`;
    } else if (sigMetadata?.source === "manual-trigger") {
      entryReason = sigMetadata?.entryReason
        ? String(sigMetadata.entryReason)
        : "Manual Injection from Dashboard";
    }

    // Execute
    await this.executePosition({
      userId: 1,
      symbol,
      side,
      currentPrice,
      size,
      leverage,
      notional,
      stopLoss: parseFloat(stopLoss.toFixed(basePrecision)),
      takeProfit: parseFloat(takeProfit.toFixed(basePrecision)),
      signalId: signal.id ?? undefined,
      strategyType: (regimeData?.strategy ?? "intraday") as StrategyType,
      creds: creds[0] ? decryptCreds(creds[0]) : undefined,
      isPaper: isPaperMode,
      disableTrailing: sigMetadata?.disableTrailing === true || sigMetadata?.disableTrailing === "true",
      entryReason,
    });

    // Record execution for dedup gate (Gate 1c)
    this.recentExecutions.set(dedupKey, Date.now());
    this.saveDedupCache();

    // Lock margin in paper wallet
    if (isPaperMode) {
      await lockPaperMargin(1, notional / leverage);
    }

    // Update risk session
    session.tradeCount++;
    updateSession(session);

    // Snapshot equity after execution
    const equity = isPaperMode ? await getPaperEquity(1) : walletFree - notional / leverage;
    await snapshotEquity(1, equity, 0, session.realizedPnl);

    this.state.executionsToday++;
    const dec: ExecutorDecision = {
      symbol,
      action: "execute",
      reason: `score ${signal.compositeScore} ≥ ${signal.threshold}, ${side}`,
      signal: {
        direction: side,
        compositeScore: signal.compositeScore,
        strategy: regimeData?.strategy ?? "intraday",
      },
      llmDecision,
      ts: Date.now(),
    };
    this.state.lastDecision = dec;
    autoExecutorEvents.emit("decision", dec);
    console.log(`[auto-executor] EXECUTE ${symbol} ${side} size=${size.toFixed(4)} @ ${currentPrice}`);
    return dec;
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
    disableTrailing?: boolean;
    entryReason?: string;
  }): Promise<void> {
    const db = getDb();
    const clientOrderId = `AE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Pre-insert the position record in the database before order execution.
    // If the process crashes or DB becomes unavailable now, no live order was placed.
    // If the DB write succeeds but subsequent order placement crashes, the record is left
    // as a pending tracking record with exchangeOrderId = clientOrderId for the reconciler.
    const posId = await db.transaction(async (tx) => {
      const result = await tx.insert(positions).values({
        userId: params.userId,
        symbol: params.symbol,
        side: params.side,
        entryPrice: String(params.currentPrice),
        currentPrice: String(params.currentPrice),
        size: String(params.size),
        leverage: params.leverage,
        margin: String((params.notional / params.leverage).toFixed(4)),
        stopLoss: String(params.stopLoss),
        takeProfit: String(params.takeProfit),
        unrealizedPnl: "0",
        realizedPnl: "0",
        status: "open",
        exchangeOrderId: clientOrderId, // Store temporary client ID first
        signalId: params.signalId,
        strategyType: params.strategyType,
        isPaper: params.isPaper,
        entryReason: params.entryReason,
      }).returning({ id: positions.id });
      return result[0].id;
    });

    let exchangeOrderId: string | undefined;

    if (params.creds && !params.isPaper) {
      try {
        const coindcxSym = `B-${params.symbol.replace("USDT", "_USDT")}`;
        const order = await createFuturesOrder(
          { apiKey: params.creds.apiKey, apiSecret: params.creds.apiSecret },
          {
            market: coindcxSym,
            side: params.side === "long" ? "buy" : "sell",
            order_type: "market",
            total_quantity: params.size,
            price: params.currentPrice,
            leverage: params.leverage,
            client_order_id: clientOrderId,
          }
        );
        exchangeOrderId = order?.id;
        console.log(`[auto-executor] Exchange order placed: ${exchangeOrderId} (client=${clientOrderId})`);

        // Verify order was fully filled (remaining_quantity should be "0" for market orders)
        const remaining = parseFloat(order?.remaining_quantity ?? "0");
        if (remaining > 0) {
          console.warn(
            `[auto-executor] Order ${exchangeOrderId} partially filled — remaining=${remaining}. ` +
            `Position will reflect actual fill.`
          );
        }

        // 2. Update the DB record with the actual exchangeOrderId returned by the exchange
        await db.update(positions)
          .set({ exchangeOrderId })
          .where(eq(positions.id, posId));

      } catch (err: any) {
        console.error(`[auto-executor] Exchange order failed: ${err.message}. Cleaning up DB record ${posId}...`);
        // 3. Rollback: delete the position record if order placement failed
        await db.delete(positions).where(eq(positions.id, posId)).catch((dbErr) => {
          console.error(`[auto-executor] Failed to clean up DB record after order failure:`, dbErr);
        });
        throw err; // re-throw so processSignal catches it
      }
    }

    if (!params.disableTrailing) {
      registerPositionForTrailing({
        id: posId,
        symbol: params.symbol,
        side: params.side,
        entryPrice: params.currentPrice,
        stopLoss: params.stopLoss,
        strategyType: params.strategyType,
        userId: params.userId,
      });
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
      await releasePaperMargin(position.userId, parseFloat(position.margin), realizedPnl, position.id);
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
    const session = getOrCreateSession(position.userId, 0);
    const updatedSession = globalRiskEngine.recordTrade(session, { pnl: realizedPnl });
    updateSession(updatedSession);

    // Clean up trailing‑stop monitoring
    unregisterPosition(position.id);
    tradingEvents.emit(`portfolio-update:${position.userId}`);
  }
}

export const globalAutoExecutor = new AutoExecutor();
