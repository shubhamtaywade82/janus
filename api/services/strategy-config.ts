export type StrategyType = "scalping" | "intraday" | "swing";

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
    threshold: 70,
    takerFeeRate: 0.0005,
    signalIntervalMs: 5_000,
    maxLeverage: 10,
  },
  intraday: {
    type: "intraday",
    weights: { micro: 0.20, intra: 0.60, swing: 0.20 },
    threshold: 75,
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
};
