import type { MarketStructure } from "../../domain/analysis/market-structure.js";
import type { LiquidityAnalysis } from "../../domain/analysis/liquidity.js";
import type { OrderBlockAnalysis } from "../../domain/analysis/order-block.js";
import type { FvgAnalysis } from "../../domain/analysis/fvg.js";
import type { SignalAnalysis } from "../../domain/analysis/analysis-result.js";
import type {
  VolumeAnalysis,
  CvdAnalysis,
  OrderBookAnalysis,
  OpenInterestAnalysis,
  FundingAnalysis,
} from "../../domain/analysis/analysis-result.js";

interface ScoringInputs {
  structure: MarketStructure;
  liquidity: LiquidityAnalysis;
  orderBlocks: OrderBlockAnalysis;
  fvgs: FvgAnalysis;
  volume: VolumeAnalysis;
  cvd: CvdAnalysis;
  orderBook: OrderBookAnalysis;
  openInterest: OpenInterestAnalysis;
  funding: FundingAnalysis;
}

/**
 * Combines all sub-analyses into a unified SignalAnalysis.
 * Scores are 0-100. Composite is weighted average of individual signal strengths.
 */
export function scoreSignals(inputs: ScoringInputs): SignalAnalysis {
  const {
    structure, liquidity, orderBlocks, fvgs,
    volume, cvd, orderBook, openInterest, funding,
  } = inputs;

  // ─── Bull / Bear raw point accumulators ───────────────────────────────────

  let bullPts = 0;
  let bearPts = 0;

  // Structure bias (max 30 pts)
  const { bullish: structBull, bearish: structBear } = structure.structureScore;
  bullPts += structBull * 3;
  bearPts += structBear * 3;

  // CVD (max 15 pts)
  if (cvd.trend === "BULLISH_DIVERGENCE") bullPts += 15;
  else if (cvd.trend === "BEARISH_DIVERGENCE") bearPts += 15;
  else if (cvd.trend === "CONFIRMING") {
    if (cvd.sessionDelta > 0) bullPts += 8;
    else bearPts += 8;
  }

  // Volume analysis (max 10 pts each direction)
  bullPts += volume.volumeScore.bullish;
  bearPts += volume.volumeScore.bearish;

  // Order book (max 10 pts)
  if (orderBook.dominantSide === "BUYERS") bullPts += 8;
  else if (orderBook.dominantSide === "SELLERS") bearPts += 8;
  if (orderBook.absorptionDetected) {
    // If bid-heavy absorption → likely selling into support (bullish)
    if (orderBook.imbalanceRatio > 1) bullPts += 4;
    else bearPts += 4;
  }

  // OI interpretation (max 10 pts)
  const oiMap: Record<string, [number, number]> = {
    NEW_LONGS:        [10, 0],
    SHORT_COVERING:   [7, 0],
    NEW_SHORTS:       [0, 10],
    LONG_LIQUIDATION: [0, 7],
    UNKNOWN:          [0, 0],
  };
  const [oiBull, oiBear] = oiMap[openInterest.interpretation] ?? [0, 0];
  bullPts += oiBull;
  bearPts += oiBear;

  // Funding (max 5 pts)
  if (funding.squeezeRisk === "SHORT_SQUEEZE") bullPts += 5;
  else if (funding.squeezeRisk === "LONG_SQUEEZE") bearPts += 5;
  else if (funding.sentiment === "SHORT_HEAVY") bullPts += 2;
  else if (funding.sentiment === "LONG_HEAVY") bearPts += 2;

  // Liquidity sweep reversal (max 8 pts)
  if (liquidity.lastSweep !== null) {
    const revProb = liquidity.lastSweep.reversalProbability;
    if (liquidity.lastSweep.side === "SELL_SIDE") bullPts += revProb / 100 * 8;
    else bearPts += revProb / 100 * 8;
  }

  // Order blocks proximity (max 6 pts)
  if (orderBlocks.nearest !== null && orderBlocks.nearestDistancePct < 1) {
    if (orderBlocks.nearest.type === "BULLISH") bullPts += 6;
    else bearPts += 6;
  }

  // FVG proximity (max 5 pts)
  if (fvgs.nearest !== null && fvgs.nearestDistancePct < 0.5) {
    if (fvgs.nearest.type === "BULLISH") bullPts += 5;
    else bearPts += 5;
  }

  // ─── Normalise composite score (0-100) ────────────────────────────────────

  const totalPts = bullPts + bearPts;
  const compositeScore =
    totalPts > 0 ? Math.round((bullPts / totalPts) * 100) : 50;

  // ─── Overall bias ─────────────────────────────────────────────────────────

  let overallBias: SignalAnalysis["overallBias"];
  if (compositeScore >= 72) overallBias = "STRONG_BULL";
  else if (compositeScore >= 57) overallBias = "BULL";
  else if (compositeScore <= 28) overallBias = "STRONG_BEAR";
  else if (compositeScore <= 43) overallBias = "BEAR";
  else overallBias = "NEUTRAL";

  // ─── Individual signal confidences ────────────────────────────────────────

  // Reversal: liquidity sweep + diverging CVD + near OB/FVG
  let reversalConf = 0;
  if (liquidity.lastSweep?.reversalProbability) reversalConf += liquidity.lastSweep.reversalProbability * 0.4;
  if (cvd.trend === "BULLISH_DIVERGENCE" || cvd.trend === "BEARISH_DIVERGENCE") reversalConf += 40;
  if (orderBlocks.nearest && orderBlocks.nearestDistancePct < 0.5) reversalConf += 20;
  reversalConf = Math.min(100, Math.round(reversalConf));

  // Continuation: aligned structure across 3+ timeframes + confirming CVD
  const alignedTfs = Object.values(structure.timeframes).filter(
    (tf) => tf.trend === structure.overallBias
  ).length;
  let continuationConf = Math.min(100, alignedTfs * 15);
  if (cvd.trend === "CONFIRMING") continuationConf = Math.min(100, continuationConf + 20);
  if (volume.relativeVolume > 1.5) continuationConf = Math.min(100, continuationConf + 10);
  continuationConf = Math.round(continuationConf);

  // Squeeze
  const squeezeType =
    funding.squeezeRisk !== "NONE" ? funding.squeezeRisk :
    openInterest.interpretation === "LONG_LIQUIDATION" ? "LONG_SQUEEZE" :
    openInterest.interpretation === "SHORT_COVERING" && funding.sentiment === "LONG_HEAVY" ? "SHORT_SQUEEZE" :
    "NONE";

  let squeezeConf = 0;
  if (squeezeType !== "NONE") {
    squeezeConf += 50;
    if (funding.extremeThreshold) squeezeConf += 30;
    if (openInterest.conviction === "HIGH") squeezeConf += 20;
  }

  // Accumulation / distribution
  const accConf = volume.accumulationDetected
    ? Math.min(100, 50 + (cvd.cvdHigherLow ? 25 : 0) + (structure.overallBias === "BULLISH" ? 0 : 25))
    : 0;
  const distConf = volume.distributionDetected
    ? Math.min(100, 50 + (!cvd.cvdHigherLow ? 25 : 0) + (structure.overallBias === "BEARISH" ? 0 : 25))
    : 0;

  return {
    reversal: { detected: reversalConf >= 50, confidence: reversalConf },
    continuation: { detected: continuationConf >= 50, confidence: continuationConf },
    squeeze: { type: squeezeType as SignalAnalysis["squeeze"]["type"], confidence: squeezeConf },
    accumulation: { detected: accConf >= 50, confidence: accConf },
    distribution: { detected: distConf >= 50, confidence: distConf },
    overallBias,
    compositeScore,
  };
}
