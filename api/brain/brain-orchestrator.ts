/**
 * BrainOrchestrator — Rule-Based Shadow Evaluator (v1)
 *
 * Replaces the LLM ReAct loop with deterministic heuristics.
 * This is the baseline that future LLM-based brains must beat.
 *
 * Philosophy: Before model intelligence matters, the infrastructure for
 * collecting episodes, measuring metrics, and shadow evaluation must exist.
 */

import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { brainEpisodes } from "@db/schema";
import { desc, eq, and, gte } from "drizzle-orm";
import { toolRegistry } from "./tool-registry";
import { brainGovernor } from "./brain-governor";
import { latestRegimeCache } from "../services/regime-detector";
import { getOrCreateSession } from "../services/risk-engine";
import { getPaperWallet } from "../services/paper-wallet";

export const BrainVerdict = {
  APPROVE: "APPROVE",
  CAUTION: "CAUTION",
  REDUCE_RISK: "REDUCE_RISK",
  EXIT_NOW: "EXIT_NOW",
} as const;
export type BrainVerdict = (typeof BrainVerdict)[keyof typeof BrainVerdict];

/** Live bus for brain decisions — consumed by the tRPC brain.decisionStream subscription. */
export const brainEvents = new EventEmitter();
brainEvents.setMaxListeners(50);

/** Update the execution outcome on a previously-logged episode (best-effort). */
export async function updateEpisodeOutcome(episodeId: number, executionResult: string): Promise<void> {
  if (!episodeId) return;
  try {
    await getDb().update(brainEpisodes).set({ executionResult }).where(eq(brainEpisodes.id, episodeId));
  } catch {
    /* best-effort */
  }
}

export interface BrainDecision {
  mode: "hold" | "enter" | "scale_in" | "scale_out" | "exit" | "pause";
  symbol?: string;
  side?: "long" | "short";
  confidence: number;
  rationale: string;
  sizePct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  timeInForce?: "ioc" | "gtt" | "market" | "limit";
  riskNotes: string[];
  evidence: {
    market: string[];
    memory: string[];
    signals: string[];
  };
  verdict: BrainVerdict;
}

export interface BrainContext {
  signal: any;
  marketSnapshot: any;
  portfolioSnapshot: any;
  regime: any;
  recentEpisodes: any[];
  session: any;
}

export class BrainOrchestrator {
  private shadowMode: boolean;

  constructor(shadowMode = true) {
    this.shadowMode = shadowMode;
  }

  /**
   * Evaluate a signal using deterministic heuristics.
   * ALWAYS runs in shadow mode — no execution rights.
   */
  async evaluate(signal: any, userId: number = 1): Promise<BrainDecision> {
    const db = getDb();
    const symbol = signal.symbol?.startsWith("B-")
      ? signal.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
      : signal.symbol || "BTCUSDT";

    // 1. Build context snapshots
    const marketSnapshot = toolRegistry.getMarketSnapshot(symbol);
    const portfolioSnapshot = await toolRegistry.getPortfolioSnapshot(userId);
    const regime = latestRegimeCache.get(symbol);
    const wallet = await getPaperWallet(userId);
    const session = await getOrCreateSession(userId, wallet.equity);

    // 2. Fetch recent episodes for this symbol (last 20)
    const recentEpisodes = await db
      .select()
      .from(brainEpisodes)
      .where(
        and(
          eq(brainEpisodes.marketSymbol, symbol),
          gte(brainEpisodes.timestamp, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        )
      )
      .orderBy(desc(brainEpisodes.timestamp))
      .limit(20);

    const context: BrainContext = {
      signal,
      marketSnapshot,
      portfolioSnapshot,
      regime,
      recentEpisodes,
      session,
    };

    // 3. Rule-based evaluation
    const verdict = this.ruleBasedReview(context);

    // 4. Build structured decision
    const decision: BrainDecision = {
      mode: verdict.verdict === BrainVerdict.APPROVE ? "enter" : "hold",
      symbol,
      side: signal.direction as "long" | "short",
      confidence: this.computeConfidence(verdict, context),
      rationale: verdict.rationale,
      sizePct: verdict.verdict === BrainVerdict.REDUCE_RISK ? 1.0 : 2.0,
      stopLossPct: verdict.verdict === BrainVerdict.REDUCE_RISK ? 0.5 : 1.0,
      takeProfitPct: 3.0,
      timeInForce: "limit",
      riskNotes: verdict.notes,
      evidence: {
        market: [JSON.stringify(marketSnapshot)],
        memory: recentEpisodes.map((e) => JSON.stringify({ verdict: e.brainVerdict, pnl: e.outcomePnl })),
        signals: signal ? [JSON.stringify(signal)] : [],
      },
      verdict: verdict.verdict,
    };

    // 5. Run Governor check (advisory only in shadow mode)
    let governorResult: any = { approved: true };
    if (!this.shadowMode) {
      try {
        governorResult = await brainGovernor.check(userId, decision as any, context);
      } catch (err: any) {
        console.error("[Brain Orchestrator] Governor check error:", err.message);
        governorResult = { approved: false, reason: `Governor crash: ${err.message}` };
      }
    }

    // 6. Persist episode with full attribution
    let insertedId = 0;
    try {
      const [result] = await db.insert(brainEpisodes).values({
        userId,
        triggerType: signal ? "signal" : "manual",
        marketSymbol: symbol,
        observation: {
          timestamp: new Date().toISOString(),
          market: marketSnapshot,
          portfolio: portfolioSnapshot,
          regime: regime ? { regime: regime.regime, strategy: regime.strategy } : null,
          signal: signal || null,
        },
        reasoning: verdict.rationale,
        proposedAction: decision,
        governorJson: { shadowMode: this.shadowMode, ...governorResult },
        actualAction: { status: this.shadowMode ? "shadow_logged" : governorResult.approved ? "governor_approved" : "governor_rejected" },
        signalSource: signal?.metadata?.source || "confluence",
        brainVerdict: verdict.verdict,
        governorVerdict: governorResult.approved ? "approved" : "rejected",
        governorGate: governorResult.approved ? null : governorResult.reason,
        executionResult: this.shadowMode ? "shadow" : null,
      }).returning({ id: brainEpisodes.id });

      insertedId = result.id;
      console.log(`[Brain Orchestrator] Saved episode ID: ${insertedId} | Verdict: ${verdict.verdict} | Symbol: ${symbol}`);
    } catch (dbErr: any) {
      console.error("[Brain Orchestrator] Database write error:", dbErr.message);
    }

    // Broadcast for the live brain.decisionStream subscription.
    brainEvents.emit("decision", {
      episodeId: insertedId,
      symbol,
      decision,
      verdict: decision.verdict,
      shadowMode: this.shadowMode,
      reasoning: decision.rationale,
      ts: Date.now(),
    });

    return {
      ...decision,
      episodeId: insertedId,
    } as any;
  }

  /**
   * Core rule-based evaluation logic.
   * Returns a verdict + rationale + notes.
   */
  private ruleBasedReview(ctx: BrainContext): { verdict: BrainVerdict; rationale: string; notes: string[] } {
    const notes: string[] = [];
    const { signal, regime, recentEpisodes, session, marketSnapshot } = ctx;

    // Rule 1: Drawdown / Cooldown circuit breaker
    const drawdownPct = session.startingBalance > 0
      ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance
      : 0;
    if (drawdownPct >= 0.03) {
      notes.push(`Drawdown ${(drawdownPct * 100).toFixed(1)}% ≥ 3%`);
      return { verdict: BrainVerdict.EXIT_NOW, rationale: `High drawdown ${(drawdownPct * 100).toFixed(1)}% — reject all new entries`, notes };
    }
    if (session.inCooldown) {
      notes.push(`Cooldown active — ${session.consecutiveLosses} consecutive losses`);
      return { verdict: BrainVerdict.EXIT_NOW, rationale: `Cooldown active after ${session.consecutiveLosses} consecutive losses`, notes };
    }

    // Rule 2: Signal confidence threshold
    const compositeScore = parseFloat(signal?.compositeScore ?? "0");
    if (compositeScore < 75) {
      notes.push(`Low composite score: ${compositeScore}`);
      return { verdict: BrainVerdict.CAUTION, rationale: `Signal confidence ${compositeScore} below threshold 75 — neutral stance`, notes };
    }

    // Rule 3: Regime alignment
    if (regime) {
      const isTrendSignal = signal?.direction === "long" || signal?.direction === "short";
      const isRangeRegime = regime.regime === "ranging" || regime.regime === "ranging_tight";
      if (isTrendSignal && isRangeRegime) {
        notes.push(`Trend signal in ranging regime: ${regime.regime}`);
        return { verdict: BrainVerdict.REDUCE_RISK, rationale: `Trend signal during ${regime.regime} regime — reduce risk`, notes };
      }
      if (regime.regime === "high_volatility") {
        notes.push("High volatility regime");
        return { verdict: BrainVerdict.REDUCE_RISK, rationale: "High volatility — tighten stops and reduce size", notes };
      }
    }

    // Rule 4: Recent episode performance for this symbol
    const relevant = recentEpisodes.filter((e) => e.brainVerdict === BrainVerdict.APPROVE && e.outcomePnl !== null);
    if (relevant.length >= 3) {
      const losses = relevant.filter((e) => parseFloat(e.outcomePnl) < 0).length;
      const lossRate = losses / relevant.length;
      if (lossRate >= 0.6) {
        notes.push(`Recent approve loss rate: ${(lossRate * 100).toFixed(0)}% (${losses}/${relevant.length})`);
        return { verdict: BrainVerdict.REDUCE_RISK, rationale: `Recent approved trades for ${signal?.symbol} losing ${(lossRate * 100).toFixed(0)}% — reduce risk`, notes };
      }
    }

    // Rule 5: Spread / liquidity check
    if (marketSnapshot?.spreadPercent > 0.01) {
      notes.push(`Wide spread: ${(marketSnapshot.spreadPercent * 100).toFixed(3)}%`);
      return { verdict: BrainVerdict.CAUTION, rationale: `Wide spread ${(marketSnapshot.spreadPercent * 100).toFixed(3)}% — avoid poor fills`, notes };
    }

    // Rule 6: Volume / CVD confirmation
    if (marketSnapshot?.cumulativeCvd < 0 && signal?.direction === "long") {
      notes.push("Negative CVD on long signal");
      return { verdict: BrainVerdict.CAUTION, rationale: "CVD negative — no volume confirmation for long", notes };
    }
    if (marketSnapshot?.cumulativeCvd > 0 && signal?.direction === "short") {
      notes.push("Positive CVD on short signal");
      return { verdict: BrainVerdict.CAUTION, rationale: "CVD positive — no volume confirmation for short", notes };
    }

    // Default: APPROVE
    notes.push("All heuristics pass");
    return { verdict: BrainVerdict.APPROVE, rationale: `Signal ${compositeScore} aligns with regime ${regime?.regime || "unknown"} — approve`, notes };
  }

  private computeConfidence(verdict: { verdict: BrainVerdict }, ctx: BrainContext): number {
    const base = verdict.verdict === BrainVerdict.APPROVE ? 0.75 : verdict.verdict === BrainVerdict.CAUTION ? 0.55 : 0.85;
    const regime = ctx.regime;
    if (regime?.inputs?.adx1h !== undefined) {
      // Higher ADX = higher confidence in trend/range classification
      const adxBoost = Math.min(0.1, regime.inputs.adx1h / 500);
      return Math.min(0.99, base + adxBoost);
    }
    return base;
  }
}
