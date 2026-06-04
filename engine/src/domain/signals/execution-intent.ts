import type { Side, ExchangeId, OrderType } from "../common/types.js";

export interface ExecutionIntent {
  signalId: string;
  symbol: string;
  exchange: ExchangeId;
  side: Side;
  orderType: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
  leverage?: number;
  clientOrderId: string;
}
