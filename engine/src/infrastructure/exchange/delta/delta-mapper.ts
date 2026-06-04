import type { BalanceSnapshot, PositionSnapshot, PlaceOrderResult } from "../../../application/ports/exchange-gateway.port.js";
import type { Order } from "../../../domain/orders/order.js";
import type { Fill } from "../../../domain/fills/fill.js";
import type { OrderbookSnapshot, OrderLevel } from "../../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../../domain/market-data/trade-tick.js";

export const EXCHANGE_ID = "delta" as const;

export function mapOrderStatus(status: string): Order["status"] {
  switch (status) {
    case "open": return "submitted";
    case "pending": return "submitted";
    case "partially_filled": return "partially_filled";
    case "filled": return "filled";
    case "cancelled": return "cancelled";
    case "rejected": return "rejected";
    default: return "submitted";
  }
}

export function mapBalance(raw: Record<string, unknown>): BalanceSnapshot {
  return {
    currency: String(raw.asset_symbol ?? raw.currency ?? "USDT").toUpperCase(),
    available: parseFloat(String(raw.available_balance ?? raw.balance ?? 0)),
    locked: parseFloat(String(raw.position_margin ?? raw.order_margin ?? 0)),
    total: parseFloat(String(raw.balance ?? 0)),
    unrealizedPnl: parseFloat(String(raw.unrealized_pnl ?? 0)),
    updatedAt: Date.now(),
  };
}

export function mapPosition(raw: Record<string, unknown>): PositionSnapshot {
  const size = parseFloat(String(raw.size ?? 0));
  const side = size >= 0 ? "long" : "short";
  return {
    symbol: String(raw.product_symbol ?? raw.symbol ?? ""),
    side,
    quantity: Math.abs(size),
    entryPrice: parseFloat(String(raw.entry_price ?? 0)),
    markPrice: parseFloat(String(raw.mark_price ?? 0)),
    liquidationPrice: raw.liquidation_price ? parseFloat(String(raw.liquidation_price)) : undefined,
    leverage: parseFloat(String(raw.leverage ?? 1)),
    margin: parseFloat(String(raw.margin ?? 0)),
    unrealizedPnl: parseFloat(String(raw.unrealized_pnl ?? 0)),
    realizedPnl: parseFloat(String(raw.realized_pnl ?? raw.realized_pnl ?? 0)),
  };
}

export function mapOrderResult(raw: Record<string, unknown>): PlaceOrderResult {
  return {
    exchangeOrderId: String(raw.id ?? ""),
    clientOrderId: String(raw.client_order_id ?? ""),
    status: mapOrderStatus(String(raw.state ?? "")),
  };
}

export function mapFill(raw: Record<string, unknown>): Fill {
  const side = String(raw.side ?? "buy").toLowerCase() as "buy" | "sell";
  return {
    id: String(raw.id ?? Date.now()),
    orderId: String(raw.order_id ?? ""),
    exchangeOrderId: String(raw.order_id ?? ""),
    exchangeFillId: String(raw.id ?? ""),
    symbol: String(raw.product_symbol ?? ""),
    exchange: EXCHANGE_ID,
    side,
    price: parseFloat(String(raw.price ?? raw.fill_price ?? 0)),
    quantity: parseFloat(String(raw.size ?? raw.quantity ?? 0)),
    fee: parseFloat(String(raw.commission ?? raw.fee ?? 0)),
    feeCurrency: "USD",
    isMaker: raw.role === "maker",
    ts: raw.created_at
      ? new Date(String(raw.created_at)).getTime()
      : Date.now(),
  };
}

export function mapOrderbook(raw: Record<string, unknown>, symbol: string): OrderbookSnapshot {
  const mapLevels = (levels: [string, string][]): OrderLevel[] =>
    levels.map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }));

  const bids = (raw.bids ?? raw.buy ?? []) as [string, string][];
  const asks = (raw.asks ?? raw.sell ?? []) as [string, string][];

  return {
    symbol,
    exchange: EXCHANGE_ID,
    bids: mapLevels(bids),
    asks: mapLevels(asks),
    sequence: (raw.last_sequence_no ?? raw.sequence ?? Date.now()) as number,
    ts: Date.now(),
  };
}

export function mapTrade(raw: Record<string, unknown>, symbol: string): TradeTick {
  return {
    id: String(raw.sequence_id ?? raw.id ?? Date.now()),
    symbol,
    exchange: EXCHANGE_ID,
    price: parseFloat(String(raw.price ?? 0)),
    quantity: parseFloat(String(raw.size ?? raw.quantity ?? 0)),
    side: String(raw.buyer_role ?? "taker") === "maker" ? "sell" : "buy",
    isMaker: false,
    ts: raw.timestamp ? Number(raw.timestamp) * 1000 : Date.now(),
  };
}
