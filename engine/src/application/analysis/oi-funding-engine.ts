import type {
  OpenInterestAnalysis, OiInterpretation,
  FundingAnalysis, FundingSentiment,
} from "../../domain/analysis/analysis-result.js";

/**
 * Open Interest + Funding Rate Analysis
 *
 * OI interpretation matrix:
 *   Price ↑ + OI ↑ → NEW_LONGS (bullish, strong conviction)
 *   Price ↓ + OI ↑ → NEW_SHORTS (bearish, strong conviction)
 *   Price ↑ + OI ↓ → SHORT_COVERING (bullish but weakening)
 *   Price ↓ + OI ↓ → LONG_LIQUIDATION (bearish, liquidation-driven)
 */
export function analyzeOpenInterest(params: {
  currentOi: number;
  previousOi: number;
  currentPrice: number;
  previousPrice: number;
}): OpenInterestAnalysis {
  const { currentOi, previousOi, currentPrice, previousPrice } = params;

  const oiChange = previousOi > 0 ? (currentOi - previousOi) / previousOi : 0;
  const priceChange = previousPrice > 0 ? (currentPrice - previousPrice) / previousPrice : 0;

  const priceUp = priceChange > 0.001;   // > 0.1%
  const priceDown = priceChange < -0.001;
  const oiUp = oiChange > 0.005;         // > 0.5% OI increase
  const oiDown = oiChange < -0.005;

  let interpretation: OiInterpretation = "UNKNOWN";
  if (priceUp && oiUp) interpretation = "NEW_LONGS";
  else if (priceDown && oiUp) interpretation = "NEW_SHORTS";
  else if (priceUp && oiDown) interpretation = "SHORT_COVERING";
  else if (priceDown && oiDown) interpretation = "LONG_LIQUIDATION";

  const conviction: OpenInterestAnalysis["conviction"] =
    Math.abs(oiChange) > 0.05 ? "HIGH" :
    Math.abs(oiChange) > 0.02 ? "MEDIUM" : "LOW";

  return {
    current: currentOi,
    change24hPct: parseFloat((oiChange * 100).toFixed(2)),
    interpretation,
    conviction,
  };
}

/**
 * Funding Rate Analysis
 *
 * Positive funding → longs pay shorts → market is long-heavy → potential long squeeze
 * Negative funding → shorts pay longs → market is short-heavy → potential short squeeze
 *
 * Extreme threshold: |rate| > 0.1% per 8h is considered extreme
 */
export function analyzeFunding(currentRate: number): FundingAnalysis {
  const EXTREME_THRESHOLD = 0.001; // 0.1%

  let sentiment: FundingSentiment;
  if (currentRate > 0.0001) sentiment = "LONG_HEAVY";
  else if (currentRate < -0.0001) sentiment = "SHORT_HEAVY";
  else sentiment = "NEUTRAL";

  const squeezeRisk =
    currentRate > EXTREME_THRESHOLD ? "LONG_SQUEEZE" :
    currentRate < -EXTREME_THRESHOLD ? "SHORT_SQUEEZE" : "NONE";

  return {
    current: currentRate,
    sentiment,
    squeezeRisk,
    extremeThreshold: Math.abs(currentRate) > EXTREME_THRESHOLD,
  };
}
