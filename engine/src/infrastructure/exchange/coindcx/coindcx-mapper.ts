import type { BalanceSnapshot, PlaceOrderResult, PositionSnapshot } from "../../../application/ports/exchange-gateway.port.js";
import type { Fill } from "../../../domain/fills/fill.js";
import type { Order } from "../../../domain/orders/order.js";

export const EXCHANGE_ID = "coindcx" as const;

/** B-BTC_USDT → BTCUSDT */
export function toCanonical(nativeSymbol: string): string {
  return nativeSymbol.replace("B-", "").replace("_", "");
}

/** BTCUSDT → B-BTC_USDT */
export function toNative(canonicalSymbol: string): string {
  return `B-${canonicalSymbol.replace("USDT", "_USDT")}`;
}

export function mapOrderStatus(status: string): Order["status"] {
  switch (status?.toLowerCase()) {
    case "open":
    case "init":
      return "submitted";
    case "partially_filled":
      return "partially_filled";
    case "filled":
      return "filled";
    case "cancelled":
    case "cancel":
      return "cancelled";
    case "rejected":
      return "rejected";
    default:
      return "submitted";
  }
}

export function mapBalance(raw: Record<string, unknown>): BalanceSnapshot {
  const balance = parseFloat(String(raw.balance ?? 0));
  const locked = parseFloat(String(raw.locked_balance ?? 0));
  return {
    currency: String(raw.currency_short_name ?? raw.currency ?? "USDT").toUpperCase(),
    available: parseFloat(String(raw.available_balance_cross ?? raw.available_balance ?? balance)),
    locked,
    total: balance + locked,
    unrealizedPnl: parseFloat(String(raw.unrealized_pnl ?? 0)),
    updatedAt: Date.now(),
  };
}

export function mapPosition(raw: Record<string, unknown>): PositionSnapshot {
  const side = String(raw.side ?? "long").toLowerCase() === "long" ? "long" : "short";
  return {
    symbol: toCanonical(String(raw.pair ?? "")),
    side,
    quantity: parseFloat(String(raw.size ?? raw.total_quantity ?? 0)),
    entryPrice: parseFloat(String(raw.entry_price ?? raw.average_price ?? 0)),
    markPrice: parseFloat(String(raw.mark_price ?? raw.last_price ?? 0)),
    liquidationPrice: raw.liquidation_price ? parseFloat(String(raw.liquidation_price)) : undefined,
    leverage: parseFloat(String(raw.leverage ?? 1)),
    margin: parseFloat(String(raw.margin ?? raw.initial_margin ?? 0)),
    unrealizedPnl: parseFloat(String(raw.unrealized_pnl ?? 0)),
    realizedPnl: parseFloat(String(raw.realized_pnl ?? 0)),
  };
}

export function mapFill(raw: Record<string, unknown>, orderId: string): Fill {
  const side = String(raw.side ?? "buy").toLowerCase() as "buy" | "sell";
  const qty = parseFloat(String(raw.total_quantity ?? raw.filled_quantity ?? 0));
  const price = parseFloat(String(raw.price ?? 0));
  return {
    id: String(raw.id ?? Date.now()),
    orderId,
    exchangeOrderId: String(raw.id ?? ""),
    exchangeFillId: String(raw.id ?? ""),
    symbol: toCanonical(String(raw.market ?? "")),
    exchange: EXCHANGE_ID,
    side,
    price,
    quantity: qty,
    fee: parseFloat(String(raw.fee ?? 0)),
    feeCurrency: "USDT",
    isMaker: false,
    ts: new Date(String(raw.created_at ?? Date.now())).getTime(),
  };
}
