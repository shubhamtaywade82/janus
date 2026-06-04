import type { Side, OrderType, OrderStatus, ExchangeId } from "../common/types.js";

export interface Order {
  id: string;                 // internal UUID
  clientOrderId: string;
  exchangeOrderId?: string;   // assigned after submission
  symbol: string;
  exchange: ExchangeId;
  side: Side;
  type: OrderType;
  price?: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  status: OrderStatus;
  signalId?: string;
  strategyId?: string;
  stopLoss?: number;
  takeProfit?: number;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  filledAt?: number;
}
