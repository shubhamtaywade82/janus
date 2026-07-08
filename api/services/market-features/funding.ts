import { InstrumentState } from "../market-state";
import { FundingFeature } from "./types";

// In-memory rolling cache of funding rates to compute statistical z-score
const fundingHistory = new Map<string, number[]>();

export function computeFunding(state: InstrumentState): FundingFeature {
  const defaultFeature: FundingFeature = {
    value: 0,
    zScore: 0,
    state: "NORMAL",
    predictedRate: 0,
  };

  const fundingTick = state.latestFunding;
  if (!fundingTick) {
    return defaultFeature;
  }

  const rate = fundingTick.fundingRate;
  const symbol = state.symbol;

  // Update in-memory history
  let history = fundingHistory.get(symbol);
  if (!history) {
    history = [];
    fundingHistory.set(symbol, history);
  }

  // To prevent polluting with identical values, we only append if it's the first
  // or different from the last cached rate.
  if (history.length === 0 || history[history.length - 1] !== rate) {
    history.push(rate);
    if (history.length > 100) {
      history.shift();
    }
  }

  // Compute Mean and Standard Deviation
  let zScore = 0;
  if (history.length > 2) {
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);
    zScore = stdDev > 0 ? (rate - mean) / stdDev : 0;
  }

  // Crowdedness State
  // 0.0005 = 0.05% per 8 hours (typical high funding threshold)
  let fundingState: FundingFeature["state"] = "NORMAL";
  if (rate > 0.0005 || zScore > 2.0) {
    fundingState = "CROWDED_LONG";
  } else if (rate < -0.0005 || zScore < -2.0) {
    fundingState = "CROWDED_SHORT";
  }

  return {
    value: rate,
    zScore,
    state: fundingState,
    predictedRate: rate, // Default to current rate
  };
}
