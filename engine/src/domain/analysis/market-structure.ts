import type { Candle, CandleInterval } from "../market-data/candle.js";

export type Trend = "BULLISH" | "BEARISH" | "RANGING";
export type Momentum = "STRONG_BULLISH" | "BULLISH" | "WEAKENING" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH" | "EXHAUSTING" | "RECOVERY";

export interface SwingPoint {
  price: number;
  ts: number;
  index: number;
  type: "HIGH" | "LOW";
}

export interface StructureBreak {
  type: "BOS" | "CHOCH";
  direction: "BULLISH" | "BEARISH";
  level: number;
  ts: number;
  timeframe: CandleInterval;
  confirmed: boolean;
}

export interface TimeframeAnalysis {
  timeframe: CandleInterval;
  trend: Trend;
  emaAlignment: Trend | "NEUTRAL";
  momentum: Momentum;
  bos: boolean;
  choch: boolean;
  latestBos?: StructureBreak;
  latestChoch?: StructureBreak;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
}

export interface MarketStructure {
  overallBias: Trend;
  biasConfidence: number;
  timeframes: Record<string, TimeframeAnalysis>;
  latestBos?: StructureBreak;
  latestChoch?: StructureBreak;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  structureScore: { bullish: number; bearish: number };
}
