/**
 * BrainOrchestrator — LLM-Powered Decision Engine
 *
 * Uses Ollama (qwen3:4b-q8) for structured reasoning on every signal.
 * Gathers full context: market snapshot, portfolio, regime, episodic memory, signal metadata.
 *
 * Operating modes (controlled by autoExecutorConfig):
 *   shadowMode=true  → Logs verdict, does NOT affect execution (default)
 *   brainGateEnabled → Brain verdict can veto or modify approved trades
 *   brainDriverEnabled → Brain can autonomously propose trades
 *
 * Safety: Governor always runs as the final hard gate. Brain cannot override
 * kill switch, max drawdown, or position limits.
 */

import { getDb } from "../queries/connection";
import { brainEpisodes, marketRegimes, autoExecutorConfig } from "@db/schema";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { toolRegistry } from "./tool-registry";
import { brainGovernor } from "./brain-governor";
import { latestRegimeCache, type RegimeResult } from "../services/regime-detector";
import { globalRiskEngine, getOrCreateSession } from "../services/risk-engine";
import { getPaperWallet } from "../services/paper-wallet";
import { callLLM } from "../services/ollama";
import { memoryStore } from "./brain-memory";
import { SUPPORTED_PAIRS } from "../services/binance";

export enum BrainVerdict {
  APPROVE = "APPROVE",
  CAUTION = "CAUTION",
  REDUCE_RISK = "REDUCE_RISK",
  EXIT_NOW = "EXIT_NOW",
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
  // Adjustments the Brain proposes
  adjustedSizeUsdt?: number;
  adjustedLeverage?: number;
  adjustedSlPct?: number;
  adjustedTpPct?: number;
}

interface BrainConfig {
  shadowMode: boolean;
  gateEnabled: boolean;
  driverEnabled: boolean;
}

export class BrainOrchestrator {
  private defaultConfig: BrainConfig = {
    shadowMode: true,
    gateEnabled: false,
    driverEnabled: false,
  };

  async getConfig(userId: number = 1): Promise<BrainConfig> {
    const db = getDb();
    const rows = await db
      .select()
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, userId))
      .limit(1);
    if (rows[0]) {
      return {
        shadowMode: rows[0].brainShadowMode ?? true,
        gateEnabled: rows[0].brainGateEnabled ?? false,
        driverEnabled: rows[0].brainDriverEnabled ?? false,
      };
    }
    return this.defaultConfig;
  }

  /**
   * Evaluate a signal using LLM (Ollama qwen3:4b-q8).
   * Gathers full context and returns a structured decision.
   */
  async evaluate(signal: any, userId: number = 1): Promise<BrainDecision & { episodeId: number }> {
    const db = getDb();
    const config = await this.getConfig(userId);
    const symbol = this.normalizeSymbol(signal.symbol || "BTCUSDT");

    // 1. Build full context
    const context = await this.buildContext(symbol, userId, signal);

    // 2. LLM reasoning
    let llmOutput: any;
    try {
      llmOutput = await this.callLLMReasoner(context);
    } catch (err: any) {
      console.warn(`[Brain Orchestrator] LLM failed: ${err.message}. Falling back to rule-based.`);
      llmOutput = this.ruleBasedFallback(context);
    }

    // 3. Build structured decision
    const decision: BrainDecision = {
      mode: llmOutput.verdict === "APPROVE" ? "enter" : "hold",
      symbol,
      side: signal.direction as "long" | "short",
      confidence: llmOutput.confidence ?? 0.7,
      rationale: llmOutput.rationale ?? "No rationale provided",
      sizePct: llmOutput.adjustedSizePct ?? 2.0,
      stopLossPct: llmOutput.adjustedSlPct ?? 1.0,
      takeProfitPct: llmOutput.adjustedTpPct ?? 3.0,
      timeInForce: "limit",
      riskNotes: llmOutput.riskNotes ?? [],
      evidence: {
        market: [JSON.stringify(context.marketSnapshot)],
        memory: context.similarEpisodes.map((e: any) =>
          JSON.stringify({ verdict: e.brainVerdict, pnl: e.outcomePnl, symbol: e.marketSymbol })
        ),
        signals: signal ? [JSON.stringify(signal)] : [],
      },
      verdict: BrainVerdict[llmOutput.verdict as keyof typeof BrainVerdict] ?? BrainVerdict.CAUTION,
      adjustedSizeUsdt: llmOutput.adjustedSizeUsdt,
      adjustedLeverage: llmOutput.adjustedLeverage,
      adjustedSlPct: llmOutput.adjustedSlPct,
      adjustedTpPct: llmOutput.adjustedTpPct,
    };

    // 4. Governor check (advisory unless gate is enabled)
    let governorResult: any = { approved: true };
    if (!config.shadowMode) {
      try {
        governorResult = await brainGovernor.check(userId, decision as any, context);
      } catch (err: any) {
        console.error("[Brain Orchestrator] Governor check error:", err.message);
        governorResult = { approved: false, reason: `Governor crash: ${err.message}` };
      }
    }

    // 5. Persist episode with full attribution
    let insertedId = 0;
    try {
      const [result] = await db.insert(brainEpisodes).values({
        userId,
        triggerType: signal ? "signal" : "manual",
        marketSymbol: symbol,
        observation: {
          timestamp: new Date().toISOString(),
          market: context.marketSnapshot,
          portfolio: context.portfolioSnapshot,
          regime: context.regime ? { regime: context.regime.regime, strategy: context.regime.strategy } : null,
          signal: signal || null,
          similarEpisodes: context.similarEpisodes.length,
        },
        reasoning: decision.rationale,
        proposedAction: decision,
        governorJson: { shadowMode: config.shadowMode, ...governorResult },
        actualAction: {
          status: config.shadowMode
            ? "shadow_logged"
            : governorResult.approved
              ? "governor_approved"
              : "governor_rejected",
          reason: governorResult.reason,
        },
        signalSource: signal?.metadata?.source || "confluence",
        brainVerdict: decision.verdict,
        governorVerdict: governorResult.approved ? "approved" : "rejected",
        governorGate: governorResult.approved ? null : governorResult.reason,
        executionResult: config.shadowMode ? "shadow" : null,
      }).returning({ id: brainEpisodes.id });

      insertedId = result.id;
      console.log(
        `[Brain Orchestrator] Episode ${insertedId} | Verdict: ${decision.verdict} | Confidence: ${(decision.confidence * 100).toFixed(0)}% | Symbol: ${symbol}`
      );
    } catch (dbErr: any) {
      console.error("[Brain Orchestrator] Database write error:", dbErr.message);
    }

    return { ...decision, episodeId: insertedId };
  }

  // ─── Context Building ───

  private async buildContext(symbol: string, userId: number, signal: any) {
    const db = getDb();

    const [marketSnapshot, portfolioSnapshot, wallet, session] = await Promise.all([
      Promise.resolve(toolRegistry.getMarketSnapshot(symbol)),
      toolRegistry.getPortfolioSnapshot(userId),
      getPaperWallet(userId),
      getOrCreateSession(userId, 0),
    ]);

    const regime = latestRegimeCache.get(symbol);

    // Fetch similar episodes from pgvector memory
    const observationText = `${symbol} ${signal?.direction || ""} ${signal?.compositeScore || ""} ${regime?.regime || ""}`;
    const similarEpisodes = await memoryStore.getSimilarEpisodes(observationText, 5);

    // Fetch latest market regime from DB
    const regimeRows = await db
      .select()
      .from(marketRegimes)
      .where(eq(marketRegimes.symbol, symbol))
      .orderBy(desc(marketRegimes.timestamp))
      .limit(1);

    return {
      symbol,
      marketSnapshot,
      portfolioSnapshot,
      regime,
      dbRegime: regimeRows[0] || null,
      session,
      wallet,
      similarEpisodes,
      signal,
    };
  }

  // ─── LLM Reasoner ───

  private async callLLMReasoner(ctx: any): Promise<any> {
    const systemPrompt = `You are the Brain of Janus, an autonomous crypto futures trading system. You evaluate trading signals using ALL available information: market state, portfolio health, regime classification, historical episode memory, and signal metadata.

You MUST respond in exactly this JSON format (no markdown, no other text):
{
  "verdict": "APPROVE" | "CAUTION" | "REDUCE_RISK" | "EXIT_NOW",
  "confidence": 0.0-1.0,
  "rationale": "Concise reasoning string",
  "riskNotes": ["note1", "note2"],
  "adjustedSizePct": 0.1-5.0,
  "adjustedSlPct": 0.5-5.0,
  "adjustedTpPct": 0.5-15.0
}

Decision rules:
- APPROVE: Signal is high quality, aligned with regime, portfolio healthy
- CAUTION: Uncertain — no trade, or trade at minimum size
- REDUCE_RISK: Signal has merit but conditions are marginal — tighten stops, reduce size
- EXIT_NOW: Strong rejection — counter-trend, high drawdown, or dangerous conditions

Never approve if:
- Daily drawdown > 3%
- Cooldown is active
- Regime conflicts with signal direction
- Spread > 0.01%
- CVD contradicts signal direction`;

    const userPrompt = `Current Market Snapshot for ${ctx.symbol}:
${JSON.stringify(ctx.marketSnapshot, null, 2)}

Portfolio State:
Equity: ${ctx.portfolioSnapshot.equity} | Drawdown: ${(ctx.portfolioSnapshot.drawdownPct * 100).toFixed(2)}% | Trades Today: ${ctx.session.tradeCount} | Consecutive Losses: ${ctx.session.consecutiveLosses}

Market Regime: ${ctx.regime?.regime || "unknown"} | Direction: ${ctx.dbRegime?.direction || "unknown"} | Volatility: ${ctx.dbRegime?.volatility || "unknown"}

Signal: ${JSON.stringify(ctx.signal, null, 2)}

Historical Context (last 5 similar episodes):
${ctx.similarEpisodes.map((e: any) => `- ${e.marketSymbol}: ${e.brainVerdict} → PnL ${e.outcomePnl}`).join("\n") || "No similar episodes found."}

Render your verdict.`;

    const response = await callLLM(systemPrompt + "\n\n" + userPrompt);
    if (!response) throw new Error("LLM returned empty");

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in LLM response");

    return JSON.parse(jsonMatch[0]);
  }

  // ─── Rule-Based Fallback ───

  private ruleBasedFallback(ctx: any): any {
    const notes: string[] = [];
    const { signal, regime, session, marketSnapshot } = ctx;

    const drawdownPct = session.startingBalance > 0
      ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance
      : 0;
    if (drawdownPct >= 0.03) {
      return { verdict: "EXIT_NOW", confidence: 0.95, rationale: `High drawdown ${(drawdownPct * 100).toFixed(1)}%`, riskNotes: ["Drawdown circuit"], adjustedSizePct: 0, adjustedSlPct: 1, adjustedTpPct: 3 };
    }
    if (session.inCooldown) {
      return { verdict: "EXIT_NOW", confidence: 0.95, rationale: `Cooldown active`, riskNotes: ["Cooldown"], adjustedSizePct: 0, adjustedSlPct: 1, adjustedTpPct: 3 };
    }

    const compositeScore = parseFloat(signal?.compositeScore ?? "0");
    if (compositeScore < 75) {
      return { verdict: "CAUTION", confidence: 0.6, rationale: `Low confidence ${compositeScore}`, riskNotes: ["Low score"], adjustedSizePct: 0.5, adjustedSlPct: 0.5, adjustedTpPct: 3 };
    }

    if (regime?.regime?.includes("range") && signal?.direction) {
      return { verdict: "REDUCE_RISK", confidence: 0.7, rationale: `Trend signal in ranging regime`, riskNotes: ["Regime mismatch"], adjustedSizePct: 1, adjustedSlPct: 0.5, adjustedTpPct: 2 };
    }

    if (marketSnapshot?.spreadPercent > 0.01) {
      return { verdict: "CAUTION", confidence: 0.6, rationale: `Wide spread`, riskNotes: ["Liquidity"], adjustedSizePct: 0.5, adjustedSlPct: 0.5, adjustedTpPct: 3 };
    }

    return { verdict: "APPROVE", confidence: 0.8, rationale: `All checks pass`, riskNotes: [], adjustedSizePct: 2, adjustedSlPct: 1, adjustedTpPct: 3 };
  }

  private normalizeSymbol(input: string): string {
    return input.startsWith("B-")
      ? input.slice(2).replace("_USDT", "USDT").replace("_", "")
      : input;
  }
}
