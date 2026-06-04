import type { CandleInterval } from "../market-data/candle.js";

export type OrderBlockStatus = "ACTIVE" | "MITIGATED" | "BROKEN";

export interface OrderBlock {
  id: string;
  type: "BULLISH" | "BEARISH";
  timeframe: CandleInterval;
  high: number;
  low: number;
  midpoint: number;
  originTs: number;
  status: OrderBlockStatus;
  strength: number; // 0-100, based on the move it caused
  touched: number;  // number of times price returned to it
}

export interface OrderBlockAnalysis {
  bullish: OrderBlock[];
  bearish: OrderBlock[];
  nearest: OrderBlock | null;
  nearestDistancePct: number;
}
