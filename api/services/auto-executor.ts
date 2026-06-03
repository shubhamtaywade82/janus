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
import { getDb } from "../queries/connection";
import { positions, exchangeCredentials, autoExecutorConfig, systemLogs } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { globalKillSwitch } from "./kill-switch";
import { isFundingExtreme } from "./funding-filter";
import { checkCorrelation } from "./correlation-guard";
import { globalRiskEngine, getOrCreateSession, updateSession } from "./risk-engine";
import { globalLlmAdvisor, type SignalContext } from "./llm-advisor";
import { latestTickerCache } from "./streaming";
import { markPriceCache, tradingEvents } from "./coindcx-ws";
import { createFuturesOrder, getFuturesWallet, getFuturesInstrumentInfo } from "./coindcx";
import { registerPositionForTrailing } from "./trailing-stop";
import { knnSnapshotCache } from "./knn-supertrend";
import { STRATEGY_CONFIGS } from "./strategy-config";
import { latestRegimeCache } from "./regime-detector";
import { snapshotEquity } from "./performance-tracker";
import { getPaperWallet, lockPaperMargin, getPaperEquity } from "./paper-wallet";
import { env } from "../lib/env";
import type { Signal, AutoExecutorConfig } from "@db/schema";
import type { StrategyType } from "./strategy-config";

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
  state: AutoExecutorState = {
    lastRun: 0,
    signalsProcessed: 0,
    executionsToday: 0,
    skipsToday: 0,
    lastDecision: null,
  };

  // Cache config to avoid DB read on every signal
  private configCache: AutoExecutorConfig | null = null;
  private configCacheAt = 0;
  private readonly CONFIG_TTL_MS = 30_000;

  async onSignalBatch(batchSignals: Signal[]): Promise<void> {
    if (!env.autoExecute) return;

    const config = await this.getConfig();
    if (!config?.enabled) return;
    if (!globalKillSwitch.canTrade()) return;

    const gated = batchSignals.filter(
      (s) => s.isGated && s.direction !== "neutral" && s.direction !== null
    );
    if (gated.length === 0) return;

    for (const signal of gated) {
      try {
        await this.processSignal(signal, config);
      } catch (err) {
        console.error(`[auto-executor] processSignal error for ${signal.symbol}:`, err);
      }
    }
    this.state.lastRun = Date.now();
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

  private skip(signal: Signal, reason: string, extra?: Partial<ExecutorDecision>): void {
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
  }

  private async processSignal(signal: Signal, config: AutoExecutorConfig): Promise<void> {
    this.state.signalsProcessed++;
    // Convert CoinDCX symbol (B-ETH_USDT) → Binance format (ETHUSDT)
    const symbol = signal.symbol.startsWith("B-")
      ? signal.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
      : signal.symbol;

    const side = signal.direction as "long" | "short";
    const targetSymbols = (config.targetSymbols as string[]) ?? ["BTCUSDT", "ETHUSDT"];

    // Gate 1: symbol in target list
    if (!targetSymbols.includes(symbol)) return this.skip(signal, `${symbol} not in target list`);

    // Gate 2: kill switch
    if (!globalKillSwitch.canTrade()) return this.skip(signal, "kill switch active");

    // Gate 3: no duplicate open position for this symbol
    const db = getDb();
    const existing = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.symbol, symbol), eq(positions.status, "open")))
      .limit(1);
    if (existing.length > 0) return this.skip(signal, "position already open");

    // Gate 4: max total open positions
    const openCount = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open")))
      .then((r) => r.length);
    const maxTotal = config.maxTotalPositions ?? 3;
    if (openCount >= maxTotal) return this.skip(signal, `max ${maxTotal} positions open`);

    // Gate 5: funding rate filter
    const fundingCheck = isFundingExtreme(symbol, side);
    if (fundingCheck.blocked) return this.skip(signal, fundingCheck.reason);

    // Gate 6: correlation guard
    const corrCheck = await checkCorrelation(symbol, side, 1);
    if (!corrCheck.allowed) return this.skip(signal, corrCheck.reason);

    // Gate 7: risk engine
    let walletFree = 0;
    let walletLocked = 0;
    const isPaperMode = !env.placeOrders;

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
        const liveWallets = await getFuturesWallet({ apiKey: creds[0].apiKey, apiSecret: creds[0].apiSecret });
        for (const w of liveWallets) {
          walletFree += parseFloat(w.balance ?? "0");
          walletLocked += parseFloat(w.locked_balance ?? "0");
        }
      } catch { /* fallback to 0 */ }
    }

    const session = getOrCreateSession(1, walletFree || 10_000);
    const sizeUsdt = parseFloat(config.defaultSizeUsdt ?? "50");
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
      if (knnBias !== "neutral" && knnConf >= knnMinConf && knnBias !== side) {
        return this.skip(signal, `KNN: bias=${knnBias} (${knnConf}%) conflicts with signal ${side}`);
      }
      if (knnConf < 40) {
        return this.skip(signal, `KNN: very low confidence (${knnConf}%) — skipping ${symbol}`);
      }
    }

    // Gate 9: LLM Advisor (optional)
    let sizeMult = 1.0;
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
    }

    // Position sizing
    const currentPrice =
      markPriceCache.get(signal.symbol) ??
      latestTickerCache.get(symbol)?.lastPrice;
    if (!currentPrice || currentPrice <= 0) {
      return this.skip(signal, "no price feed");
    }

    // Capital allocation: use configured % of free balance, capped by fixed USDT size
    const allocationPct = parseFloat(config.capitalAllocationPct ?? "0.10"); // e.g. 0.10 = 10%
    const balanceCap = (walletFree || session.startingBalance) * allocationPct;
    const notional = Math.min(sizeUsdt * sizeMult, balanceCap);

    // Leverage: if useStrategyLeverage=true, use strategy's maxLeverage; else use defaultLeverage
    const strategyMaxLev = STRATEGY_CONFIGS[regimeData?.strategy ?? "intraday"]?.maxLeverage ?? 5;
    const leverage = config.useStrategyLeverage
      ? strategyMaxLev
      : Math.min(config.defaultLeverage ?? 3, strategyMaxLev);

    // Validate size against instrument minimums
    let rawSize = notional / currentPrice;
    if (!isPaperMode && creds[0]) {
      try {
        const instrInfo = await getFuturesInstrumentInfo(symbol);
        if (instrInfo) {
          const minQty   = parseFloat(instrInfo.min_quantity ?? instrInfo.min_qty ?? "0");
          const stepSize = parseFloat(instrInfo.step ?? instrInfo.quantity_step ?? "0");
          if (minQty > 0 && rawSize < minQty) {
            return this.skip(signal,
              `size ${rawSize.toFixed(6)} < min qty ${minQty} for ${symbol} — increase defaultSizeUsdt`
            );
          }
          // Round down to nearest step
          if (stepSize > 0) {
            rawSize = Math.floor(rawSize / stepSize) * stepSize;
          }
        }
      } catch { /* non-fatal — proceed with raw size */ }
    }
    const size = rawSize;
    const slPct = parseFloat(config.stopLossPct ?? "0.015");
    const tp1Pct = parseFloat(config.tp1Pct ?? "0.015");

    const stopLoss = side === "long"
      ? currentPrice * (1 - slPct)
      : currentPrice * (1 + slPct);
    const takeProfit = side === "long"
      ? currentPrice * (1 + tp1Pct)
      : currentPrice * (1 - tp1Pct);

    // Execute
    await this.executePosition({
      userId: 1,
      symbol,
      side,
      currentPrice,
      size: parseFloat(size.toFixed(4)),
      leverage,
      notional,
      stopLoss,
      takeProfit,
      signalId: signal.id ?? undefined,
      strategyType: (regimeData?.strategy ?? "intraday") as StrategyType,
      creds: creds[0],
      isPaper: isPaperMode,
    });

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
  }): Promise<void> {
    const db = getDb();
    let exchangeOrderId: string | undefined;

    if (params.creds && env.placeOrders) {
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
          }
        );
        exchangeOrderId = order?.id;
        console.log(`[auto-executor] Exchange order placed: ${exchangeOrderId}`);
      } catch (err: any) {
        console.error(`[auto-executor] Exchange order failed: ${err.message}`);
        throw err; // re-throw so processSignal catches it
      }
    }

    const result = await db.insert(positions).values({
      userId: params.userId,
      symbol: params.symbol,
      side: params.side,
      entryPrice: String(params.currentPrice),
      currentPrice: String(params.currentPrice),
      size: String(params.size),
      leverage: params.leverage,
      margin: String((params.notional / params.leverage).toFixed(4)),
      stopLoss: String(params.stopLoss.toFixed(2)),
      takeProfit: String(params.takeProfit.toFixed(2)),
      unrealizedPnl: "0",
      realizedPnl: "0",
      status: "open",
      exchangeOrderId,
      signalId: params.signalId,
      strategyType: params.strategyType,
      isPaper: params.isPaper,
    }).returning({ id: positions.id });

    const posId = result[0].id;
    registerPositionForTrailing({
      id: posId,
      symbol: params.symbol,
      side: params.side,
      entryPrice: params.currentPrice,
      stopLoss: params.stopLoss,
      strategyType: params.strategyType,
      userId: params.userId,
    });

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
}

export const globalAutoExecutor = new AutoExecutor();
