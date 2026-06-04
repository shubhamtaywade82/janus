import type { Side, ExchangeId, OrderType } from "../common/types.js";

export interface TradeSignal {
  id: string;
  symbol: string;
  exchange: ExchangeId;
  side: Side;
  /** 0–1 */
  confidence: number;
  /** Composite confluence score 0–100 */
  score: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity: number;
  orderType: OrderType;
  strategyId: string;
  ts: number;
  meta?: Record<string, unknown>;
}
