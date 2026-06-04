import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { Order } from "../../domain/orders/order.js";
import type { Fill } from "../../domain/fills/fill.js";
import type { Position } from "../../domain/positions/position.js";
import type { Side, OrderType } from "../../domain/common/types.js";

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
  leverage?: number;
  clientOrderId?: string;
}

export interface PlaceOrderResult {
  exchangeOrderId: string;
  clientOrderId: string;
  status: Order["status"];
}

export interface CancelOrderInput {
  exchangeOrderId: string;
  symbol: string;
  clientOrderId?: string;
}

export interface ModifyOrderInput {
  exchangeOrderId: string;
  symbol: string;
  price?: number;
  quantity?: number;
}

export interface BalanceSnapshot {
  currency: string;
  available: number;
  locked: number;
  total: number;
  unrealizedPnl: number;
  updatedAt: number;
}

export interface PositionSnapshot {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice?: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface ExchangeGatewayPort {
  readonly exchangeId: string;

  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  cancelOrder(input: CancelOrderInput): Promise<void>;
  modifyOrder(input: ModifyOrderInput): Promise<void>;

  fetchBalances(): Promise<BalanceSnapshot[]>;
  fetchPositions(symbol?: string): Promise<PositionSnapshot[]>;
  fetchOrder(exchangeOrderId: string, symbol: string): Promise<Order | null>;
  fetchFills(symbol?: string, since?: number): Promise<Fill[]>;

  /** Live orderbook stream — yields normalized snapshots */
  subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot>;

  /** Connect / disconnect lifecycle */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
