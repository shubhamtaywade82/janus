import type { CandleInterval } from "../market-data/candle.js";

export interface FairValueGap {
  id: string;
  type: "BULLISH" | "BEARISH";
  timeframe: CandleInterval;
  low: number;
  high: number;
  midpoint: number;
  ts: number;
  filled: boolean;
  fillPct: number; // 0-100, how much of the gap has been filled
}

export interface FvgAnalysis {
  bullish: FairValueGap[];
  bearish: FairValueGap[];
  nearest: FairValueGap | null;
  nearestDistancePct: number;
}
