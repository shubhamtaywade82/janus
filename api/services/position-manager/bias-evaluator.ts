import type { MarketContext, ManagedPosition, BiasResult, Bias } from "./types";

// ─── Bias Evaluator ──────────────────────────────────────────────────────────
// Produces a directional market bias relative to the open position.
// Score range: -100 (strong bearish) to +100 (strong bullish)

export function evaluateBias(ctx: MarketContext, position: ManagedPosition): BiasResult {
  let score = 0;
  const factors: string[] = [];

  // ── Trend (weight: 30) ──────────────────────────────────────────────────
  if (ctx.trend === "BULLISH") { score += 30; factors.push("Trend BULLISH"); }
  else if (ctx.trend === "BEARISH") { score -= 30; factors.push("Trend BEARISH"); }
  else { factors.push("Trend SIDEWAYS"); }

  // ── EMA stack (weight: 20) ─────────────────────────────────────────────
  const { ema20, ema50, ema200, lastPrice } = ctx;
  if (ema20 && ema50 && ema200) {
    if (lastPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
      score += 20; factors.push("Full EMA bull stack");
    } else if (lastPrice < ema20 && ema20 < ema50 && ema50 < ema200) {
      score -= 20; factors.push("Full EMA bear stack");
    } else if (lastPrice > ema50) {
      score += 10; factors.push("Above EMA50");
    } else {
      score -= 10; factors.push("Below EMA50");
    }
  } else if (ema20 && ema50) {
    if (ema20 > ema50) { score += 10; factors.push("EMA20 > EMA50"); }
    else { score -= 10; factors.push("EMA20 < EMA50"); }
  }

  // ── RSI (weight: 15) ───────────────────────────────────────────────────
  if (ctx.rsi14 !== null) {
    if (ctx.rsi14 > 70) { score -= 15; factors.push(`RSI overbought (${ctx.rsi14.toFixed(1)})`); }
    else if (ctx.rsi14 < 30) { score += 15; factors.push(`RSI oversold (${ctx.rsi14.toFixed(1)})`); }
    else if (ctx.rsi14 > 55) { score += 8; factors.push(`RSI bullish zone (${ctx.rsi14.toFixed(1)})`); }
    else if (ctx.rsi14 < 45) { score -= 8; factors.push(`RSI bearish zone (${ctx.rsi14.toFixed(1)})`); }
  }

  // ── Volume profile (weight: 10) ────────────────────────────────────────
  if (ctx.volumeProfile === "HIGH" && ctx.trend === "BULLISH") {
    score += 10; factors.push("High volume on bullish trend");
  } else if (ctx.volumeProfile === "HIGH" && ctx.trend === "BEARISH") {
    score -= 10; factors.push("High volume on bearish trend");
  } else if (ctx.volumeProfile === "LOW") {
    score -= 5; factors.push("Low volume (conviction weak)");
  }

  // ── CVD (weight: 10) ───────────────────────────────────────────────────
  if (ctx.cvdTrend === "bullish") { score += 10; factors.push("CVD bullish divergence"); }
  else if (ctx.cvdTrend === "bearish") { score -= 10; factors.push("CVD bearish divergence"); }

  // ── Confluence alignment with position (weight: 15) ───────────────────
  if (ctx.confluenceScore !== null) {
    const posDir = position.side === "LONG" ? "long" : "short";
    const aligned = ctx.confluenceDirection === posDir;
    if (ctx.confluenceScore >= 75 && aligned) {
      score += 15; factors.push(`Confluence ${ctx.confluenceScore.toFixed(0)} aligned with position`);
    } else if (ctx.confluenceScore < 50 && !aligned) {
      score -= 15; factors.push("Confluence against position");
    } else if (!aligned && ctx.confluenceScore >= 75) {
      score -= 10; factors.push("Confluence firing opposite direction");
    }
  }

  // ── Funding rate (weight: 5) ───────────────────────────────────────────
  if (ctx.fundingBias === "POSITIVE" && position.side === "LONG") {
    score -= 5; factors.push("Positive funding rate (longs pay)");
  } else if (ctx.fundingBias === "NEGATIVE" && position.side === "SHORT") {
    score -= 5; factors.push("Negative funding rate (shorts pay)");
  }

  // Clamp to [-100, +100]
  score = Math.max(-100, Math.min(100, score));

  // Flip score for short positions: if market is bullish, that's bearish for a short
  const positionAdjustedScore =
    position.side === "SHORT" ? -score : score;

  const bias: Bias =
    positionAdjustedScore >= 60 ? "STRONG_BULLISH" :
    positionAdjustedScore >= 25 ? "BULLISH" :
    positionAdjustedScore <= -60 ? "STRONG_BEARISH" :
    positionAdjustedScore <= -25 ? "BEARISH" :
    "NEUTRAL";

  const confidence = Math.abs(positionAdjustedScore) / 100;

  return { bias, score: positionAdjustedScore, confidence, factors };
}
