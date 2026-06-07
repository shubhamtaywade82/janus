import { positionStore } from "./position-store";
import { positionManagerBus } from "./event-bus";
import { buildMarketContext } from "./market-context";
import { evaluateBias } from "./bias-evaluator";
import { ensureProtection } from "./protection-manager";
import { getPositionRecommendation } from "./ai-advisor";
import { policyGuard } from "./policy-guard";
import { evaluateOpportunityCost } from "./opportunity-cost";
import { executeAction } from "./execution-manager";
import type {
  ManagedPosition,
  AssessmentRecord,
  PositionManagerConfig,
  PositionLifecycleState,
} from "./types";
import { PositionAction as PA } from "./types";
import { getDb } from "../../queries/connection";
import { positions, futuresWallets, signals, autoExecutorConfig } from "@db/schema";
import { aiAssessments } from "@db/position-manager-schema";
import { eq, and, desc, gte as _gte } from "drizzle-orm";
import { userPositionsCache, markPriceCache } from "../coindcx-ws";
import { latestTickerCache } from "../streaming";
import { env } from "../../lib/env";
import { getPaperWallet } from "../paper-wallet";
import { registerPositionForTrailing, syncTrailingStopLoss } from "../trailing-stop";
// ─── Position Lifecycle Manager ──────────────────────────────────────────────
// Central orchestrator: syncs positions, runs assessment loops,
// coordinates protection → AI/code advice → policy → execution.

export class PositionLifecycleManager {
  private config: PositionManagerConfig;
  private assessTimer: ReturnType<typeof setInterval> | null = null;
  private oppCostTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private assessmentHistory: AssessmentRecord[] = [];
  private readonly MAX_HISTORY = 200;

  constructor(config: PositionManagerConfig) {
    this.config = config;
  }

  // ── Start ───────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial sync
    await this.syncPositions();

    // Position sync loop (every 10s)
    this.syncTimer = setInterval(() => {
      this.syncPositions().catch((e) =>
        positionManagerBus.emit("manager:error", "sync", e)
      );
    }, 10_000);

    // Assessment loop
    this.assessTimer = setInterval(() => {
      this.runAssessmentCycle().catch((e) =>
        positionManagerBus.emit("manager:error", "assessment", e)
      );
    }, this.config.assessIntervalMs);

    // Opportunity cost loop
    this.oppCostTimer = setInterval(() => {
      this.runOpportunityCostCycle().catch((e) =>
        positionManagerBus.emit("manager:error", "opportunity-cost", e)
      );
    }, this.config.opportunityCostIntervalMs);

    positionManagerBus.emit("manager:started");
    console.log("[position-lifecycle] Started — managing positions for user", this.config.userId);
  }

  stop(): void {
    if (this.assessTimer) clearInterval(this.assessTimer);
    if (this.oppCostTimer) clearInterval(this.oppCostTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.isRunning = false;
    positionManagerBus.emit("manager:stopped");
    console.log("[position-lifecycle] Stopped");
  }

  updateConfig(partial: Partial<PositionManagerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): PositionManagerConfig {
    return { ...this.config };
  }

  getAssessmentHistory(): AssessmentRecord[] {
    return this.assessmentHistory.slice(-50);
  }

  // ── Position Sync ───────────────────────────────────────────────────────
  // Pulls live positions from CoinDCX WS cache (or REST fallback) and DB,
  // then upserts them into the in-memory PositionStore.
  private async syncPositions(): Promise<void> {
    const userId = this.config.userId;
    const db = getDb();

    const isPaperMode = env.paperTrading || !env.placeOrders;
    // ── 1. Open positions from DB (paper + any not yet in WS cache) ──────
    const dbPositions = await db
      .select()
      .from(positions)
      .where(and(
        eq(positions.userId, userId),
        eq(positions.status, "open"),
        eq(positions.isPaper, isPaperMode)
      ));

    // ── 2. Live CoinDCX WS positions ──────────────────────────────────────
    const wsPositions = isPaperMode ? [] : (userPositionsCache.get(userId) ?? []);

    // Build merged set keyed by exchangeOrderId / DB id
    const managed = new Map<string, ManagedPosition>();
    const strategyTypes = new Map<number, string>();

    // First pass: DB positions as baseline
    for (const dbPos of dbPositions) {
      strategyTypes.set(dbPos.id, dbPos.strategyType ?? "intraday");
      const binanceSym = dbPos.symbol.replace("B-", "").replace("_", "");
      let markPriceRaw = markPriceCache.get(dbPos.symbol) ?? 0;
      if (markPriceRaw <= 0) {
        markPriceRaw = latestTickerCache.get(binanceSym)?.lastPrice ?? 0;
      }
      if (markPriceRaw <= 0) {
        markPriceRaw = parseFloat(dbPos.currentPrice) || parseFloat(dbPos.entryPrice) || 0;
      }

      const entryPrice = parseFloat(dbPos.entryPrice);
      const quantity = parseFloat(dbPos.size);
      const margin = parseFloat(dbPos.margin);
      const isLong = dbPos.side === "long";
      const unrealizedPnl =
        (isLong ? 1 : -1) * (markPriceRaw - entryPrice) * quantity;
      const roe = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
      const sl = dbPos.stopLoss ? parseFloat(dbPos.stopLoss) : null;
      const tp = dbPos.takeProfit ? parseFloat(dbPos.takeProfit) : null;
      const liqPrice = dbPos.liquidationPrice ? parseFloat(dbPos.liquidationPrice) : null;

      const slDistancePct = sl
        ? Math.abs(entryPrice - sl) / entryPrice
        : null;
      const riskRewardRatio =
        sl && tp
          ? Math.abs(tp - entryPrice) / Math.abs(entryPrice - sl)
          : null;
      const liqDistancePct = liqPrice
        ? Math.abs(entryPrice - liqPrice) / entryPrice
        : null;

      const existing = positionStore.get(dbPos.id);
      const lifecycleState: PositionLifecycleState =
        existing?.lifecycleState ?? (sl ? "PROTECTED" : "SYNCED");

      const holdingMinutes = Math.floor(
        (Date.now() - dbPos.createdAt.getTime()) / 60_000
      );

      const mp: ManagedPosition = {
        id: dbPos.id,
        userId: dbPos.userId,
        exchange: "coindcx",
        symbol: dbPos.symbol,
        binanceSymbol: binanceSym,
        side: dbPos.side === "long" ? "LONG" : "SHORT",
        quantity,
        entryPrice,
        markPrice: markPriceRaw,
        leverage: dbPos.leverage,
        margin,
        unrealizedPnl,
        realizedPnl: parseFloat(dbPos.realizedPnl ?? "0"),
        roe,
        liquidationPrice: liqPrice,
        stopLoss: sl,
        takeProfit: tp,
        source: dbPos.signalId ? "BOT" : "MANUAL",
        lifecycleState,
        isPaper: dbPos.isPaper,
        marginCurrency: dbPos.marginCurrency ?? "USDT",
        openedAt: dbPos.createdAt,
        updatedAt: dbPos.updatedAt,
        riskRewardRatio,
        slDistancePct,
        liqDistancePct,
        holdingMinutes,
        // Persisted state fields
        breakevenApplied: dbPos.breakevenApplied ?? false,
        extremePrice: dbPos.extremePrice ? parseFloat(dbPos.extremePrice) : null,
        openedAlertSent: dbPos.openedAlertSent ?? false,
      };

      managed.set(String(dbPos.id), mp);
    }

    // Second pass: overlay live WS data
    for (const wsPos of wsPositions) {
      const key = String(wsPos.orderId ?? wsPos.id ?? "");
      if (managed.has(key)) {
        const existing = managed.get(key)!;
        const newMarkPrice = (wsPos.markPrice && wsPos.markPrice > 0) ? wsPos.markPrice : existing.markPrice;
        const isLong = existing.side === "LONG";
        const unrealizedPnl =
          (isLong ? 1 : -1) *
          (newMarkPrice - existing.entryPrice) *
          existing.quantity;
        const roe =
          existing.margin > 0
            ? (unrealizedPnl / existing.margin) * 100
            : 0;
        managed.set(key, {
          ...existing,
          markPrice: newMarkPrice,
          unrealizedPnl,
          roe,
          updatedAt: new Date(),
        });
      }
    }

    // Track which positions are newly discovered before upserting
    const newlyDiscoveredIds = new Set<number>();
    for (const mp of managed.values()) {
      if (!positionStore.get(mp.id)) {
        newlyDiscoveredIds.add(mp.id);
      }
    }

    // Upsert into store
    for (const mp of managed.values()) {
      positionStore.upsert(mp);
    }

    // Re-register all open positions with the trailing-stop engine
    // (critical after restart when trackedPositions is empty)
    for (const mp of managed.values()) {
      if (mp.stopLoss) {
        registerPositionForTrailing({
          id: mp.id,
          symbol: mp.binanceSymbol,
          side: mp.side === "LONG" ? "long" : "short",
          entryPrice: mp.entryPrice,
          stopLoss: mp.stopLoss,
          strategyType: strategyTypes.get(mp.id) ?? "intraday",
          userId: mp.userId,
          size: mp.quantity,
        });
        syncTrailingStopLoss(mp.id, mp.stopLoss);
      }
    }

    // Mark newly discovered positions as alerted in DB so restarts don't re-alert
    for (const mp of managed.values()) {
      if (newlyDiscoveredIds.has(mp.id) && !mp.openedAlertSent) {
        db.update(positions)
          .set({ openedAlertSent: true })
          .where(eq(positions.id, mp.id))
          .catch(() => {});
      }
    }

    // Remove positions that are no longer in DB as open
    const dbIds = new Set(dbPositions.map((p) => p.id));
    for (const stored of positionStore.getAll()) {
      if (!dbIds.has(stored.id)) {
        positionStore.remove(stored.id);
      }
    }
  }

  // ── Assessment Cycle ────────────────────────────────────────────────────
  // Runs for every open managed position:
  // 1. Build market context
  // 2. Evaluate bias
  // 3. Ensure protection (SL/TP)
  // 4. Get AI/code recommendation
  // 5. Policy guard validation
  // 6. Execute approved action
  private async runAssessmentCycle(): Promise<void> {
    if (!this.config.enabled) return;

    const openPositions = positionStore.getOpen();
    if (openPositions.length === 0) return;

    const availableBalance = await this.fetchAvailableBalance();
    const totalEquity = await this.fetchTotalEquity();

    const portfolio = {
      totalEquityUsdt: totalEquity,
      availableBalance,
      totalUnrealizedPnl: positionStore.totalUnrealizedPnl(),
      openPositionCount: openPositions.length,
    };

    for (const position of openPositions) {
      try {
        await this.assessPosition(position, portfolio);
      } catch (err) {
        console.error(`[position-lifecycle] Assessment failed for position ${position.id}:`, err);
      }
    }
  }

  private async assessPosition(
    position: ManagedPosition,
    portfolio: { totalEquityUsdt: number; availableBalance: number; totalUnrealizedPnl: number; openPositionCount: number }
  ): Promise<void> {
    // 1. Build market context
    const ctx = await buildMarketContext(position.binanceSymbol);

    // 2. Evaluate directional bias
    const bias = evaluateBias(ctx, position);

    // 3. Ensure SL/TP protection
    if (this.config.protectionEnabled) {
      const protStatus = await ensureProtection(
        position,
        ctx,
        this.config.userId
      );
      if (protStatus.needsProtection === false && position.lifecycleState === "SYNCED") {
        positionStore.updateLifecycleState(position.id, "PROTECTED");
      }
    }

    // 4. Get recommendation
    const recommendation = await getPositionRecommendation(
      position,
      ctx,
      bias,
      portfolio,
      this.config.useAi,
      this.config.aiTimeoutMs
    );

    // 5. Policy guard
    const policy = policyGuard(recommendation, position, portfolio);

    // 6. Advance lifecycle
    if (position.lifecycleState === "PROTECTED" || position.lifecycleState === "SYNCED") {
      positionStore.updateLifecycleState(position.id, "MANAGED");
    }
    if (policy.action === PA.PARTIAL_EXIT || policy.action === PA.REDUCE_SIZE) {
      positionStore.updateLifecycleState(position.id, "REDUCING");
    }
    if (policy.action === PA.FULL_EXIT) {
      positionStore.updateLifecycleState(position.id, "EXITING");
    }

    // 7. Record assessment
    const record: AssessmentRecord = {
      positionId: position.id,
      symbol: position.symbol,
      lifecycleState: positionStore.get(position.id)?.lifecycleState ?? "MANAGED",
      marketContext: ctx,
      bias,
      recommendation,
      policyResult: policy,
      opportunityCost: null,
      actionTaken: policy.approved ? policy.action : PA.KEEP_OPEN,
      assessedAt: new Date(),
    };

    this.pushHistory(record);

    // Persist to DB (best-effort)
    this.persistAssessment(record).catch(() => {});

    // 8. Execute if auto-apply is on
    if (this.config.autoApplyActions && policy.approved && policy.action !== PA.KEEP_OPEN) {
      const refreshed = positionStore.get(position.id) ?? position;
      await executeAction(refreshed, recommendation, policy, this.config.userId);
    }

    positionManagerBus.emit("position:assessed", record);
  }

  // ── Opportunity Cost Cycle ──────────────────────────────────────────────
  private async runOpportunityCostCycle(): Promise<void> {
    if (!this.config.enabled) return;

    for (const position of positionStore.getOpen()) {
      try {
        // Derive a simple position score from confluence
        const db = getDb();
        const [sig] = await db
          .select({ compositeScore: signals.compositeScore })
          .from(signals)
          .where(eq(signals.symbol, position.binanceSymbol))
          .orderBy(desc(signals.createdAt))
          .limit(1);

        const currentScore = sig ? parseFloat(sig.compositeScore) : 50;
        const oppCost = await evaluateOpportunityCost(position, currentScore);

        // Push to last assessment record for this position
        const lastRecord = this.assessmentHistory
          .slice()
          .reverse()
          .find((r) => r.positionId === position.id);

        if (lastRecord) {
          lastRecord.opportunityCost = oppCost;
        }

        // If verdict is EXIT and we have high confidence, add it to recommendations
        if (oppCost.verdict === "EXIT" && this.config.autoApplyActions) {
          const exitCtx = await buildMarketContext(position.binanceSymbol);
          const record: AssessmentRecord = {
            positionId: position.id,
            symbol: position.symbol,
            lifecycleState: positionStore.get(position.id)?.lifecycleState ?? "MANAGED",
            marketContext: exitCtx,
            bias: evaluateBias(exitCtx, position),
            recommendation: {
              action: PA.FULL_EXIT,
              confidence: 0.70,
              reasoning: oppCost.reason,
              source: "CODE",
            },
            policyResult: { approved: true, action: PA.FULL_EXIT, reason: "Opportunity cost verdict: EXIT" },
            opportunityCost: oppCost,
            actionTaken: PA.FULL_EXIT,
            assessedAt: new Date(),
          };

          this.pushHistory(record);

          positionStore.updateLifecycleState(position.id, "EXITING");
          await executeAction(position, record.recommendation, record.policyResult, this.config.userId);
          positionManagerBus.emit("position:assessed", record);
        }
      } catch (err) {
        console.error(`[position-lifecycle] Opportunity cost eval failed for ${position.id}:`, err);
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private pushHistory(record: AssessmentRecord): void {
    this.assessmentHistory.push(record);
    if (this.assessmentHistory.length > this.MAX_HISTORY) {
      this.assessmentHistory.shift();
    }
  }

  private async fetchAvailableBalance(): Promise<number> {
    try {
      const isPaper = env.paperTrading || !env.placeOrders;
      if (isPaper) {
        const db = getDb();
        const configRows = await db
          .select({
            paperCurrency: autoExecutorConfig.paperCurrency,
            paperStartingBalance: autoExecutorConfig.paperStartingBalance,
          })
          .from(autoExecutorConfig)
          .where(eq(autoExecutorConfig.userId, this.config.userId))
          .limit(1);
        const paperCurrency = configRows[0]?.paperCurrency ?? "INR";
        const paperStarting = configRows[0]?.paperStartingBalance
          ? parseFloat(configRows[0].paperStartingBalance)
          : 1000000;

        const pw = await getPaperWallet(this.config.userId, paperStarting, paperCurrency);
        return pw.balance;
      }
      const db = getDb();
      const [wallet] = await db
        .select({ balance: futuresWallets.balance, lockedBalance: futuresWallets.lockedBalance })
        .from(futuresWallets)
        .where(
          and(
            eq(futuresWallets.userId, this.config.userId),
            eq(futuresWallets.marginCurrency, "USDT")
          )
        )
        .limit(1);
      if (!wallet) return 0;
      return parseFloat(wallet.balance) - parseFloat(wallet.lockedBalance);
    } catch {
      return 0;
    }
  }

  private async fetchTotalEquity(): Promise<number> {
    try {
      const isPaper = env.paperTrading || !env.placeOrders;
      if (isPaper) {
        const db = getDb();
        const configRows = await db
          .select({
            paperCurrency: autoExecutorConfig.paperCurrency,
            paperStartingBalance: autoExecutorConfig.paperStartingBalance,
          })
          .from(autoExecutorConfig)
          .where(eq(autoExecutorConfig.userId, this.config.userId))
          .limit(1);
        const paperCurrency = configRows[0]?.paperCurrency ?? "INR";
        const paperStarting = configRows[0]?.paperStartingBalance
          ? parseFloat(configRows[0].paperStartingBalance)
          : 1000000;

        const pw = await getPaperWallet(this.config.userId, paperStarting, paperCurrency);
        return pw.equity;
      }
      const db = getDb();
      const [wallet] = await db
        .select({ totalAccountEquity: futuresWallets.totalAccountEquity })
        .from(futuresWallets)
        .where(
          and(
            eq(futuresWallets.userId, this.config.userId),
            eq(futuresWallets.marginCurrency, "USDT")
          )
        )
        .limit(1);
      return wallet ? parseFloat(wallet.totalAccountEquity) : 0;
    } catch {
      return 0;
    }
  }

  private async persistAssessment(record: AssessmentRecord): Promise<void> {
    try {
      const db = getDb();
      await db.insert(aiAssessments).values({
        positionId: record.positionId,
        symbol: record.symbol,
        lifecycleState: record.lifecycleState,
        biasScore: record.bias.score.toFixed(2),
        biasLabel: record.bias.bias,
        biasConfidence: record.bias.confidence.toFixed(4),
        recommendedAction: record.recommendation.action,
        policyAction: record.policyResult.action,
        policyApproved: record.policyResult.approved,
        confidenceScore: record.recommendation.confidence.toFixed(4),
        aiSource: record.recommendation.source,
        reasoning: record.recommendation.reasoning,
        opportunityCostVerdict: record.opportunityCost?.verdict ?? null,
        marketContextSnapshot: record.marketContext as unknown as Record<string, unknown>,
        assessedAt: record.assessedAt,
      });
    } catch {
      // Non-fatal: DB write failure should not block position management
    }
  }
}
