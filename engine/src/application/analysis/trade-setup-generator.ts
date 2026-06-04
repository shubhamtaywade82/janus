import type { MarketStructure } from "../../domain/analysis/market-structure.js";
import type { LiquidityAnalysis } from "../../domain/analysis/liquidity.js";
import type { OrderBlockAnalysis } from "../../domain/analysis/order-block.js";
import type { FvgAnalysis } from "../../domain/analysis/fvg.js";
import type { VolumeProfileAnalysis } from "../../domain/analysis/volume-profile.js";
import type { SignalAnalysis, TradeSetup, SetupType } from "../../domain/analysis/analysis-result.js";

interface SetupInputs {
  currentPrice: number;
  structure: MarketStructure;
  signals: SignalAnalysis;
  liquidity: LiquidityAnalysis;
  orderBlocks: OrderBlockAnalysis;
  fvgs: FvgAnalysis;
  volumeProfile: VolumeProfileAnalysis;
}

/**
 * Generates a concrete TradeSetup from signal analysis.
 * Entry zone is derived from the nearest OB, FVG, or POC depending on setup type.
 * Stop-loss is placed beyond the setup's invalidation structure.
 * Targets use liquidity pools and volume profile levels.
 */
export function generateTradeSetup(inputs: SetupInputs): TradeSetup {
  const { currentPrice, structure, signals, liquidity, orderBlocks, fvgs, volumeProfile } = inputs;

  if (signals.compositeScore >= 50 && signals.compositeScore < 57 || signals.overallBias === "NEUTRAL") {
    return noTrade("Market structure lacks clear directional bias.");
  }

  const isBull = signals.overallBias === "STRONG_BULL" || signals.overallBias === "BULL";
  const isBear = signals.overallBias === "STRONG_BEAR" || signals.overallBias === "BEAR";

  // Determine setup type
  let setupType: SetupType = "NO_TRADE";
  if (signals.reversal.detected && signals.reversal.confidence >= 60) {
    setupType = isBull ? "COUNTER_TREND_LONG" : "COUNTER_TREND_SHORT";
  } else if (signals.squeeze.type !== "NONE" && signals.squeeze.confidence >= 60) {
    setupType = signals.squeeze.type === "SHORT_SQUEEZE" ? "SQUEEZE_LONG" : "SQUEEZE_SHORT";
  } else if (signals.continuation.detected && signals.continuation.confidence >= 55) {
    setupType = isBull ? "TREND_CONTINUATION_LONG" : "TREND_CONTINUATION_SHORT";
  } else if (isBull) {
    setupType = "RANGE_LONG";
  } else if (isBear) {
    setupType = "RANGE_SHORT";
  }

  if (setupType === "NO_TRADE") return noTrade("No high-probability setup detected.");

  const isLong = setupType.endsWith("_LONG") || setupType.includes("LONG");

  // ─── Entry zone ───────────────────────────────────────────────────────────

  let entryLow: number;
  let entryHigh: number;

  // Prefer OB > FVG > POC for entry zone
  const nearBullishOb = orderBlocks.bullish.find((ob) => ob.status === "ACTIVE" && ob.high <= currentPrice * 1.005);
  const nearBearishOb = orderBlocks.bearish.find((ob) => ob.status === "ACTIVE" && ob.low >= currentPrice * 0.995);
  const nearBullFvg = fvgs.bullish.find((f) => !f.filled && f.high <= currentPrice * 1.005);
  const nearBearFvg = fvgs.bearish.find((f) => !f.filled && f.low >= currentPrice * 0.995);

  if (isLong) {
    if (nearBullishOb) {
      entryLow = nearBullishOb.low;
      entryHigh = nearBullishOb.high;
    } else if (nearBullFvg) {
      entryLow = nearBullFvg.low;
      entryHigh = nearBullFvg.high;
    } else {
      const poc = volumeProfile.profile.poc;
      entryLow = poc * 0.9985;
      entryHigh = poc * 1.0015;
    }
  } else {
    if (nearBearishOb) {
      entryLow = nearBearishOb.low;
      entryHigh = nearBearishOb.high;
    } else if (nearBearFvg) {
      entryLow = nearBearFvg.low;
      entryHigh = nearBearFvg.high;
    } else {
      const poc = volumeProfile.profile.poc;
      entryLow = poc * 0.9985;
      entryHigh = poc * 1.0015;
    }
  }

  // ─── Stop-loss ────────────────────────────────────────────────────────────
  // Place SL beyond the entry OB low (for long) or OB high (for short),
  // with 0.2% buffer to avoid stop-hunts.

  const SL_BUFFER = 0.002;
  let stopLoss: number;
  if (isLong) {
    stopLoss = entryLow * (1 - SL_BUFFER);
    // If there's a recent sell-side sweep, SL goes just below that swept level
    if (liquidity.lastSweep?.side === "SELL_SIDE") {
      stopLoss = Math.min(stopLoss, liquidity.lastSweep.level * (1 - SL_BUFFER));
    }
  } else {
    stopLoss = entryHigh * (1 + SL_BUFFER);
    if (liquidity.lastSweep?.side === "BUY_SIDE") {
      stopLoss = Math.max(stopLoss, liquidity.lastSweep.level * (1 + SL_BUFFER));
    }
  }

  // ─── Targets: use buy/sell-side liquidity pools and VAH/VAL ───────────────

  const { vah, val, poc } = volumeProfile.profile;
  const targets: number[] = [];

  if (isLong) {
    // T1: POC if above entry
    if (poc > entryHigh) targets.push(parseFloat(poc.toFixed(2)));
    // T2: VAH
    if (vah > entryHigh) targets.push(parseFloat(vah.toFixed(2)));
    // T3: nearest buy-side liquidity pool above
    const buySideLvl = liquidity.buySide
      .filter((l) => l.price > entryHigh && !l.swept)
      .sort((a, b) => a.price - b.price)[0];
    if (buySideLvl) targets.push(parseFloat(buySideLvl.price.toFixed(2)));
  } else {
    if (poc < entryLow) targets.push(parseFloat(poc.toFixed(2)));
    if (val < entryLow) targets.push(parseFloat(val.toFixed(2)));
    const sellSideLvl = liquidity.sellSide
      .filter((l) => l.price < entryLow && !l.swept)
      .sort((a, b) => b.price - a.price)[0];
    if (sellSideLvl) targets.push(parseFloat(sellSideLvl.price.toFixed(2)));
  }

  // Fallback: use 1:1, 1.5:1, 2:1 R multiples
  if (targets.length === 0) {
    const slDist = Math.abs(entryLow - stopLoss);
    const base = isLong ? entryHigh : entryLow;
    const dir = isLong ? 1 : -1;
    targets.push(
      parseFloat((base + dir * slDist).toFixed(2)),
      parseFloat((base + dir * slDist * 1.5).toFixed(2)),
      parseFloat((base + dir * slDist * 2).toFixed(2)),
    );
  }

  // Deduplicate and sort
  const sortedTargets = [...new Set(targets)].sort(isLong
    ? (a, b) => a - b
    : (a, b) => b - a
  );

  // ─── Risk:Reward ──────────────────────────────────────────────────────────

  const riskDist = Math.abs(entryHigh - stopLoss);
  const rewardDist = Math.abs((sortedTargets[sortedTargets.length - 1] ?? entryHigh) - entryHigh);
  const riskReward = riskDist > 0 ? parseFloat((rewardDist / riskDist).toFixed(2)) : 0;

  // ─── Confidence = composite score clamped ─────────────────────────────────

  const confidence = Math.round(
    signals.compositeScore * 0.6 +
    (signals.continuation.detected ? signals.continuation.confidence * 0.2 : 0) +
    (signals.reversal.detected ? signals.reversal.confidence * 0.2 : 0)
  );

  // ─── Invalidation note ────────────────────────────────────────────────────

  const structBreak = isLong
    ? structure.latestChoch?.direction === "BEARISH" ? "BEARISH CHOCH on higher timeframe" : "close below entry OB"
    : structure.latestChoch?.direction === "BULLISH" ? "BULLISH CHOCH on higher timeframe" : "close above entry OB";

  return {
    setupType,
    entryZone: {
      low: parseFloat(entryLow.toFixed(2)),
      high: parseFloat(entryHigh.toFixed(2)),
    },
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targets: sortedTargets,
    riskReward,
    confidence: Math.min(100, confidence),
    invalidation: `Invalidated on ${structBreak}`,
    notes: buildNotes(signals, setupType, riskReward),
  };
}

function noTrade(reason: string): TradeSetup {
  return {
    setupType: "NO_TRADE",
    entryZone: { low: 0, high: 0 },
    stopLoss: 0,
    targets: [],
    riskReward: 0,
    confidence: 0,
    invalidation: reason,
    notes: reason,
  };
}

function buildNotes(signals: SignalAnalysis, setupType: SetupType, rr: number): string {
  const parts: string[] = [];
  if (signals.squeeze.type !== "NONE") parts.push(`${signals.squeeze.type} risk (${signals.squeeze.confidence}% conf)`);
  if (signals.accumulation.detected) parts.push("accumulation pattern active");
  if (signals.distribution.detected) parts.push("distribution pattern active");
  if (rr >= 2) parts.push(`favourable R:R ${rr}:1`);
  else if (rr < 1) parts.push("poor R:R — size down");
  return parts.length > 0 ? parts.join("; ") : `${setupType} setup`;
}
