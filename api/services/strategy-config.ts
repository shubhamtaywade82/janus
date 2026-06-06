export type StrategyType =
  | "scalping"
  | "intraday"
  | "swing"
  | "grid"
  | "momentum_reversal"
  | "bb_reversion"
  | "ml_sizing"
  | "scalping_micro";

export interface StrategyWeights {
  micro: number;
  intra: number;
  swing: number;
}

export interface StrategyConfig {
  type: StrategyType;
  weights: StrategyWeights;
  threshold: number;
  takerFeeRate: number;
  signalIntervalMs: number;
  maxLeverage: number;
}

export const STRATEGY_CONFIGS: Record<StrategyType, StrategyConfig> = {
  scalping: {
    type: "scalping",
    weights: { micro: 0.55, intra: 0.35, swing: 0.10 },
    threshold: 50,
    takerFeeRate: 0.0005,
    signalIntervalMs: 5_000,
    maxLeverage: 10,
  },
  intraday: {
    type: "intraday",
    weights: { micro: 0.20, intra: 0.60, swing: 0.20 },
    threshold: 50,
    takerFeeRate: 0.0005,
    signalIntervalMs: 30_000,
    maxLeverage: 5,
  },
  swing: {
    type: "swing",
    weights: { micro: 0.05, intra: 0.25, swing: 0.70 },
    threshold: 80,
    takerFeeRate: 0.0005,
    signalIntervalMs: 300_000,
    maxLeverage: 3,
  },
  grid: {
    type: "grid",
    weights: { micro: 0.10, intra: 0.80, swing: 0.10 },
    threshold: 65,
    takerFeeRate: 0.0005,
    signalIntervalMs: 15_000,
    maxLeverage: 5,
  },
  momentum_reversal: {
    type: "momentum_reversal",
    weights: { micro: 0.10, intra: 0.40, swing: 0.50 },
    threshold: 75,
    takerFeeRate: 0.0005,
    signalIntervalMs: 30_000,
    maxLeverage: 5,
  },
  bb_reversion: {
    type: "bb_reversion",
    weights: { micro: 0.15, intra: 0.55, swing: 0.30 },
    threshold: 70,
    takerFeeRate: 0.0005,
    signalIntervalMs: 10_000,
    maxLeverage: 8,
  },
  ml_sizing: {
    type: "ml_sizing",
    weights: { micro: 0.05, intra: 0.45, swing: 0.50 },
    threshold: 75,
    takerFeeRate: 0.0005,
    signalIntervalMs: 60_000,
    maxLeverage: 5,
  },
  scalping_micro: {
    type: "scalping_micro",
    weights: { micro: 0.80, intra: 0.15, swing: 0.05 },
    threshold: 65,
    takerFeeRate: 0.0005,
    signalIntervalMs: 2_000,
    maxLeverage: 10,
  },
};

