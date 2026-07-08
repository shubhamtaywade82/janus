import type { InstrumentState } from "../market-state";
import type { LiquidityFeature } from "./types";

export function computeLiquidity(state: InstrumentState): LiquidityFeature {
  const defaultFeature: LiquidityFeature = {
    sweepScore: 0,
    absorptionScore: 0,
    liquidityAdded: 0,
    liquidityRemoved: 0,
    state: "NORMAL",
  };

  if (!state.metrics) {
    return defaultFeature;
  }

  const {
    sweepScore = 0,
    absorptionScore = 0,
    liquidityAdded = 0,
    liquidityRemoved = 0,
  } = state.metrics;

  // Determine state based on sweep/absorption and liquidity addition/removal
  let liquidityState: LiquidityFeature["state"] = "NORMAL";
  
  if (liquidityRemoved > liquidityAdded * 1.5 && sweepScore > 50) {
    liquidityState = "VACUUM";
  } else if (absorptionScore > 50 && liquidityAdded > liquidityRemoved) {
    liquidityState = "HIGH_LIQUIDITY";
  }

  return {
    sweepScore,
    absorptionScore,
    liquidityAdded,
    liquidityRemoved,
    state: liquidityState,
  };
}
