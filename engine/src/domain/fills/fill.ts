import type { Side, ExchangeId } from "../common/types.js";

export interface Fill {
  id: string;
  orderId: string;              // internal order id
  exchangeOrderId?: string;
  exchangeFillId?: string;
  symbol: string;
  exchange: ExchangeId;
  side: Side;
  price: number;
  quantity: number;
  fee: number;
  feeCurrency: string;
  isMaker: boolean;
  ts: number;
}
