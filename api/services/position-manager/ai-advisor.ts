import type {
  ManagedPosition,
  MarketContext,
  BiasResult,
  AiRecommendation,
} from "./types";
import { PositionAction as PA } from "./types";

// ─── AI + Code-Fallback Position Advisor ────────────────────────────────────
// Tries to get a recommendation from the configured LLM (via LlmAdvisor).
// Falls back to deterministic code-based logic if AI is unavailable or times out.

interface PortfolioSummary {
  totalEquityUsdt: number;
  availableBalance: number;
  totalUnrealizedPnl: number;
  openPositionCount: number;
}

// ── Code-based fallback logic ─────────────────────────────────────────────────
// Uses bias, market context and position metrics to pick an action.
function codeBasedDecision(
  position: ManagedPosition,
  ctx: MarketContext,
  bias: BiasResult
): AiRecommendation {
  const { roe, holdingMinutes, stopLoss, entryPrice, markPrice, side } = position;
  const isLong = side === "LONG";
  const pnlSign = isLong
    ? markPrice > entryPrice
    : markPrice < entryPrice;

  // Rule 1: Strong bias against the position → exit
  if (bias.bias === "STRONG_BEARISH" && bias.confidence > 0.65) {
    return {
      action: PA.FULL_EXIT,
      confidence: bias.confidence,
      reasoning: `Strong bearish bias (score ${bias.score.toFixed(0)}) against position. Market structure: ${ctx.structure}.`,
      source: "CODE",
    };
  }

  // Rule 2: RSI extremes against the position
  if (ctx.rsi14 !== null) {
    if (isLong && ctx.rsi14 > 78) {
      return {
        action: PA.PARTIAL_EXIT,
        exitSizePct: 0.5,
        confidence: 0.72,
        reasoning: `RSI overbought at ${ctx.rsi14.toFixed(1)} — taking partial profits.`,
        source: "CODE",
      };
    }
    if (!isLong && ctx.rsi14 < 22) {
      return {
        action: PA.PARTIAL_EXIT,
        exitSizePct: 0.5,
        confidence: 0.72,
        reasoning: `RSI oversold at ${ctx.rsi14.toFixed(1)} — taking partial profits on short.`,
        source: "CODE",
      };
    }
  }

  // Rule 3: Move to breakeven once 1R in profit (only once per position)
  if (stopLoss && pnlSign && !position.breakevenApplied) {
    const slDistance = Math.abs(entryPrice - stopLoss);
    const priceMove = Math.abs(markPrice - entryPrice);
    if (priceMove >= slDistance && stopLoss !== entryPrice) {
      if (position.symbol.includes("ETH") && position.realizedPnl <= 0) {
        return {
          action: PA.PARTIAL_EXIT,
          exitSizePct: 0.5,
          confidence: 0.85,
          reasoning: "ETH hybrid scaling: 1R profit reached — taking 50% off table.",
          source: "CODE",
        };
      }
      return {
        action: PA.MOVE_TO_BREAKEVEN,
        newStopLoss: isLong ? entryPrice * 1.001 : entryPrice * 1.001,
        confidence: 0.80,
        reasoning: "Position has moved 1R in profit — moving stop to breakeven.",
        source: "CODE",
      };
    }
  }

  // Rule 4: Trail if in strong trend and significant profit (Exclude XRP)
  if (!position.symbol.includes("XRP") && roe > 10 && bias.bias === "STRONG_BULLISH" && ctx.trend !== "SIDEWAYS") {
    const newSl = ctx.atr14
      ? isLong
        ? markPrice - ctx.atr14 * 1.5
        : markPrice + ctx.atr14 * 1.5
      : null;
    return {
      action: PA.TRAIL_SL,
      newStopLoss: newSl ?? undefined,
      confidence: 0.75,
      reasoning: `Position ${roe.toFixed(1)}% ROE in strong trend — trailing stop tighter.`,
      source: "CODE",
    };
  }

  // Rule 5: Volatile + long hold + no clear direction → partial exit
  if (ctx.volatilityRegime === "HIGH" && holdingMinutes > 120 && Math.abs(roe) < 3) {
    return {
      action: PA.PARTIAL_EXIT,
      exitSizePct: 0.3,
      confidence: 0.60,
      reasoning: "High volatility, position stale (>2h), minimal PnL — reducing exposure.",
      source: "CODE",
    };
  }

  // Rule 6: Moderate bearish bias — tighten TP (lock gains by bringing TP closer to current price)
  if ((bias.bias === "BEARISH" || bias.bias === "STRONG_BEARISH") && roe > 5) {
    let newTp: number | undefined;
    if (ctx.atr14) {
      if (isLong) {
        // LONG: TP closer to mark (lower), but still above entry to stay profitable
        newTp = Math.max(markPrice + ctx.atr14 * 0.5, position.entryPrice * 1.001);
      } else {
        // SHORT: TP closer to mark (higher), but still below entry to stay profitable
        newTp = Math.min(markPrice + ctx.atr14 * 0.5, position.entryPrice * 0.999);
      }
    }
    return {
      action: PA.TIGHTEN_TP,
      newTakeProfit: newTp,
      confidence: 0.65,
      reasoning: `Bearish bias developing with ${roe.toFixed(1)}% ROE — locking in gains.`,
      source: "CODE",
    };
  }

  // Rule 7: Good confluence alignment → keep open
  if (ctx.confluenceScore !== null && ctx.confluenceScore >= 65) {
    const aligned =
      (isLong && ctx.confluenceDirection === "long") ||
      (!isLong && ctx.confluenceDirection === "short");
    if (aligned) {
      return {
        action: PA.KEEP_OPEN,
        confidence: 0.75,
        reasoning: `Confluence score ${ctx.confluenceScore.toFixed(0)} still aligned — holding position.`,
        source: "CODE",
      };
    }
  }

  // Default: keep open
  return {
    action: PA.KEEP_OPEN,
    confidence: 0.50,
    reasoning: "No strong signal to act — holding position.",
    source: "CODE",
  };
}

// ── Prompt builder for LLM ─────────────────────────────────────────────────
function buildPositionPrompt(
  position: ManagedPosition,
  ctx: MarketContext,
  bias: BiasResult,
  portfolio: PortfolioSummary
): string {
  const currency = position.marginCurrency || "USDT";
  return `You are a professional crypto futures risk manager. Assess this open position and recommend an action.

POSITION:
- Symbol: ${position.symbol}
- Side: ${position.side}
- Entry: ${position.entryPrice.toFixed(4)}
- Mark Price: ${position.markPrice.toFixed(4)}
- ROE: ${position.roe.toFixed(2)}%
- Unrealized PnL: ${position.unrealizedPnl.toFixed(4)} ${currency}
- Holding Time: ${position.holdingMinutes} minutes
- Leverage: ${position.leverage}x
- Stop Loss: ${position.stopLoss?.toFixed(4) ?? "NONE"}
- Take Profit: ${position.takeProfit?.toFixed(4) ?? "NONE"}

MARKET CONTEXT:
- Trend: ${ctx.trend}
- Volatility: ${ctx.volatilityRegime}
- Structure: ${ctx.structure}
- RSI(14): ${ctx.rsi14?.toFixed(1) ?? "N/A"}
- EMA20: ${ctx.ema20?.toFixed(4) ?? "N/A"}, EMA50: ${ctx.ema50?.toFixed(4) ?? "N/A"}
- CVD Trend: ${ctx.cvdTrend}
- Volume: ${ctx.volumeProfile}
- Funding: ${ctx.fundingBias}
- Confluence Score: ${ctx.confluenceScore?.toFixed(1) ?? "N/A"} (${ctx.confluenceDirection})

BIAS ANALYSIS:
- Bias: ${bias.bias} (score: ${bias.score.toFixed(0)}/100)
- Confidence: ${(bias.confidence * 100).toFixed(0)}%
- Factors: ${bias.factors.slice(0, 4).join(", ")}

PORTFOLIO:
- Available Balance: ${portfolio.availableBalance.toFixed(2)} ${currency}
- Total Unrealized PnL: ${portfolio.totalUnrealizedPnl.toFixed(2)} ${currency}
- Open Positions: ${portfolio.openPositionCount}

DECISION GUIDANCE (read carefully):
- DEFAULT to KEEP_OPEN. The stop-loss already caps downside risk — let trades develop.
- "Neutral" / "sideways" / "normal-or-high volatility" / a neutral confluence score are NOT reasons to exit. They mean KEEP_OPEN, not FULL_EXIT.
- Use FULL_EXIT ONLY when the market clearly turns against the position: bias is STRONG_BEARISH for a LONG (or STRONG_BULLISH for a SHORT), OR market structure breaks against the position, OR price is at/through the stop. Set confidence >= 0.75 only for these clear cases.
- Positions held under 15 minutes should almost never be fully exited — a brief hold with flat ROE is normal, not a reason to bail.
- When in doubt, prefer protective actions (MOVE_TO_BREAKEVEN, TRAIL_SL, TIGHTEN_TP) or PARTIAL_EXIT over FULL_EXIT.
- Confidence must reflect genuine conviction: reserve > 0.60 for clear, well-supported decisions.

Choose ONE action from: KEEP_OPEN, MOVE_TO_BREAKEVEN, TRAIL_SL, PARTIAL_EXIT, FULL_EXIT, REDUCE_SIZE, SCALE_IN, EXTEND_TP, TIGHTEN_TP

Respond ONLY with valid JSON (no markdown):
{
  "action": "ACTION_NAME",
  "confidence": 0.00-1.00,
  "reasoning": "one concise sentence",
  "newStopLoss": null_or_number,
  "newTakeProfit": null_or_number,
  "exitSizePct": null_or_0.0-1.0
}`;
}

// ── Main advisor entry point ───────────────────────────────────────────────
export async function getPositionRecommendation(
  position: ManagedPosition,
  ctx: MarketContext,
  bias: BiasResult,
  portfolio: PortfolioSummary,
  useAi: boolean,
  aiTimeoutMs: number
): Promise<AiRecommendation> {
  if (useAi) {
    try {
      const { callPositionManagementLlm } = await import("./llm-client");
      const prompt = buildPositionPrompt(position, ctx, bias, portfolio);
      // paper → local Ollama;  live → Ollama.com cloud (3-key rotation)
      const aiResult = await Promise.race([
        callPositionManagementLlm(prompt, position.isPaper),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("LLM timeout")), aiTimeoutMs)
        ),
      ]);
      if (aiResult) return aiResult;
    } catch {
      // AI unavailable — fall through to code-based
    }
  }

  return codeBasedDecision(position, ctx, bias);
}
