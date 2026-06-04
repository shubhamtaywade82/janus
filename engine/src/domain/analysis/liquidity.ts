export type LiquidityEventType =
  | "LIQUIDITY_GRAB"
  | "EQUAL_HIGHS_SWEEP"
  | "EQUAL_LOWS_SWEEP"
  | "STOP_HUNT"
  | "NONE";

export interface LiquidityLevel {
  price: number;
  side: "BUY_SIDE" | "SELL_SIDE"; // buy-side = above market (stops above highs), sell-side = below (stops below lows)
  strength: number; // number of equal highs/lows contributing
  swept: boolean;
  ts: number;
}

export interface LiquiditySweepEvent {
  type: LiquidityEventType;
  side: "BUY_SIDE" | "SELL_SIDE";
  level: number;
  confirmed: boolean;
  reversalProbability: number; // 0-100
  ts: number;
}

export interface LiquidityAnalysis {
  buySide: LiquidityLevel[];   // resting sell orders / buy stops above price
  sellSide: LiquidityLevel[];  // resting buy orders / sell stops below price
  lastSweep: LiquiditySweepEvent | null;
  sweepCount24h: number;
  reversalProbability: number;
}
