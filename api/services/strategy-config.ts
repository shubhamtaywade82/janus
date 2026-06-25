export type StrategyType =
  | "intraday"
  | "swing"
  | "grid"
  | "momentum_reversal"
  | "bb_reversion"
  | "ml_sizing"
  | "h6_momentum"
  | "alpha_protocol";

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
  /**
   * Minimum stop-loss width once breakeven is reached.
   * Expressed as a fraction of entry price (e.g. 0.003 = 0.3%).
   * Prevents the trade from being stopped out by spread noise immediately after breakeven.
   */
  minPostBreakevenSlPct: number;
  /**
   * Minimum fraction of TP1 target that must be reached before activation of
   * breakeven / aggressive trailing. Used by `trailing-stop.ts`.
   */
  tp1ActivationThresholdPct: number;
  /**
   * Minimum required adverse move % before entering an early stop-out.
   * Provides a noise floor; actual SL will be the looser of this or computed trail.
   */
  minAdverseMovePct: number;
  /**
   * When true, entries are placed as marketable limit orders (at best ask/bid) with a
   * short timeout before falling back to a market order, instead of crossing the spread
   * immediately. Disabled for strategies where fill speed matters more than a few bps
   * of slippage (scalping / momentum).
   */
  preferLimitEntry: boolean;
}

export const STRATEGY_CONFIGS: Record<StrategyType, StrategyConfig> = {
  intraday: {
    type: "intraday",
    weights: { micro: 0.20, intra: 0.60, swing: 0.20 },
    threshold: 82,
    takerFeeRate: 0.0005,
    signalIntervalMs: 30_000,
    maxLeverage: 15,
    minPostBreakevenSlPct: 0.006,
    tp1ActivationThresholdPct: 0.30,
    minAdverseMovePct: 0.0015,
    preferLimitEntry: true,
  },
  swing: {
    type: "swing",
    weights: { micro: 0.05, intra: 0.25, swing: 0.70 },
    threshold: 85,
    takerFeeRate: 0.0005,
    signalIntervalMs: 300_000,
    maxLeverage: 5,
    minPostBreakevenSlPct: 0.009,
    tp1ActivationThresholdPct: 0.40,
    minAdverseMovePct: 0.003,
    preferLimitEntry: true,
  },
  grid: {
    type: "grid",
    weights: { micro: 0.10, intra: 0.80, swing: 0.10 },
    threshold: 72,
    takerFeeRate: 0.0005,
    signalIntervalMs: 15_000,
    maxLeverage: 5,
    minPostBreakevenSlPct: 0.008,
    tp1ActivationThresholdPct: 0.35,
    minAdverseMovePct: 0.002,
    preferLimitEntry: true,
  },
  momentum_reversal: {
    type: "momentum_reversal",
    weights: { micro: 0.10, intra: 0.40, swing: 0.50 },
    threshold: 80,
    takerFeeRate: 0.0005,
    signalIntervalMs: 30_000,
    maxLeverage: 5,
    minPostBreakevenSlPct: 0.007,
    tp1ActivationThresholdPct: 0.35,
    minAdverseMovePct: 0.002,
    preferLimitEntry: false,
  },
  bb_reversion: {
    type: "bb_reversion",
    weights: { micro: 0.15, intra: 0.55, swing: 0.30 },
    threshold: 75,
    takerFeeRate: 0.0005,
    signalIntervalMs: 10_000,
    maxLeverage: 8,
    minPostBreakevenSlPct: 0.006,
    tp1ActivationThresholdPct: 0.30,
    minAdverseMovePct: 0.0015,
    preferLimitEntry: true,
  },
  ml_sizing: {
    type: "ml_sizing",
    weights: { micro: 0.05, intra: 0.45, swing: 0.50 },
    threshold: 80,
    takerFeeRate: 0.0005,
    signalIntervalMs: 60_000,
    maxLeverage: 5,
    minPostBreakevenSlPct: 0.007,
    tp1ActivationThresholdPct: 0.35,
    minAdverseMovePct: 0.002,
    preferLimitEntry: true,
  },

  h6_momentum: {
    type: "h6_momentum",
    weights: { micro: 0.10, intra: 0.30, swing: 0.60 },
    threshold: 78,
    takerFeeRate: 0.0005,
    signalIntervalMs: 21_600_000, // 6 Hours
    maxLeverage: 10,
    minPostBreakevenSlPct: 0.009, // 0.5% min width after breakeven
    tp1ActivationThresholdPct: 0.25, // Activate trailing at 25% of target
    minAdverseMovePct: 0.0020, // 0.2% adverse filter
    preferLimitEntry: true,
  },
  alpha_protocol: {
    type: "alpha_protocol",
    weights: { micro: 0.20, intra: 0.50, swing: 0.30 },
    threshold: 80,
    takerFeeRate: 0.0005,
    signalIntervalMs: 30_000,
    maxLeverage: 10,
    minPostBreakevenSlPct: 0.006,
    tp1ActivationThresholdPct: 0.30,
    minAdverseMovePct: 0.002,
    preferLimitEntry: true,
  },
};
