import { cdxPost } from "../coindcx-rest-client.js";
import type { CoinDCXCredentials } from "../coindcx-rest-client.js";
import { mapOrderStatus, toNative, toCanonical } from "../coindcx-mapper.js";
import type { PlaceOrderInput, PlaceOrderResult, CancelOrderInput } from "../../../../application/ports/exchange-gateway.port.js";
import type { Order } from "../../../../domain/orders/order.js";
import { EXCHANGE_ID } from "../coindcx-mapper.js";

export class CoinDCXOrderClient {
  constructor(private readonly creds: CoinDCXCredentials) {}

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const market = toNative(input.symbol);
    const body: Record<string, unknown> = {
      market,
      side: input.side,
      order_type: input.type === "post_only" ? "limit" : input.type === "bracket" ? "limit" : input.type,
      total_quantity: input.quantity,
    };
    if (input.price) body.price = input.price;
    if (input.leverage) body.leverage = input.leverage;
    if (input.clientOrderId) body.client_order_id = input.clientOrderId;

    const res = await cdxPost<Record<string, unknown>>(
      this.creds,
      "/exchange/v1/derivatives/futures/orders/create",
      body
    );

    return {
      exchangeOrderId: String(res.id ?? ""),
      clientOrderId: String(res.client_order_id ?? input.clientOrderId ?? ""),
      status: mapOrderStatus(String(res.status ?? "")),
    };
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    await cdxPost(this.creds, "/exchange/v1/orders/cancel", {
      id: input.exchangeOrderId,
      market: toNative(input.symbol),
    });
  }

  async fetchOrder(exchangeOrderId: string): Promise<Order | null> {
    try {
      const raw = await cdxPost<Record<string, unknown>>(
        this.creds,
        "/exchange/v1/orders/status",
        { id: exchangeOrderId }
      );
      const qty = parseFloat(String(raw.total_quantity ?? 0));
      const remaining = parseFloat(String(raw.remaining_quantity ?? 0));
      return {
        id: String(raw.client_order_id ?? raw.id),
        clientOrderId: String(raw.client_order_id ?? ""),
        exchangeOrderId: String(raw.id ?? ""),
        symbol: toCanonical(String(raw.market ?? "")),
        exchange: EXCHANGE_ID,
        side: String(raw.side ?? "buy") as "buy" | "sell",
        type: "limit",
        price: parseFloat(String(raw.price ?? 0)),
        quantity: qty,
        filledQuantity: qty - remaining,
        remainingQuantity: remaining,
        status: mapOrderStatus(String(raw.status ?? "")),
        createdAt: new Date(String(raw.created_at ?? Date.now())).getTime(),
        updatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
