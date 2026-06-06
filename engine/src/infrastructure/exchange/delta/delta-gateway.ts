import { deltaRequest, deltaPublicGet, type DeltaCredentials } from "./delta-rest-client.js";
import { DeltaWsClient } from "./delta-ws-client.js";
import {
  EXCHANGE_ID, mapBalance, mapPosition, mapOrderResult, mapFill, mapOrderbook, mapOrderStatus,
} from "./delta-mapper.js";
import type {
  ExchangeGatewayPort, PlaceOrderInput, PlaceOrderResult, BalanceSnapshot, PositionSnapshot,
  CancelOrderInput, ModifyOrderInput,
} from "../../../application/ports/exchange-gateway.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { Order } from "../../../domain/orders/order.js";
import type { Fill } from "../../../domain/fills/fill.js";
import { logger } from "../../observability/logger.js";

/**
 * Delta Exchange India Gateway
 * - Own market data feed (l2_orderbook, all_trades, v2/ticker via WS)
 * - Own execution and account data via REST + private WS channels
 */
export class DeltaGateway implements ExchangeGatewayPort {
  readonly exchangeId = EXCHANGE_ID;

  private ws: DeltaWsClient;
  private log = logger.child({ gateway: EXCHANGE_ID });

  // product_id cache: symbol → product_id (needed for order placement)
  private productIdCache = new Map<string, number>();

  constructor(private readonly creds: DeltaCredentials) {
    this.ws = new DeltaWsClient(creds);
  }

  async connect(): Promise<void> {
    this.ws.connect();

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Delta WS connect timeout")), 15_000);
      const onAuth = () => { clearTimeout(t); resolve(); };
      const onConn = () => {
        // If no creds (public-only), resolve on connect
        if (!this.creds.apiKey) { clearTimeout(t); resolve(); }
      };
      this.ws.once("authenticated", onAuth);
      this.ws.once("connected", onConn);
      this.ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    // Subscribe private channels
    this.ws.subscribe(["orders", "fills", "positions"]);

    this.ws.on("fillReceived", (msg: Record<string, unknown>) => {
      const fill = mapFill(msg);
      this.log.info("fill received", { symbol: fill.symbol, qty: fill.quantity, price: fill.price });
    });

    this.log.info("connected");
  }

  async disconnect(): Promise<void> {
    this.ws.disconnect();
  }

  // ─── Product lookup ───────────────────────────────────────────────────────────

  private async getProductId(symbol: string): Promise<number> {
    const cached = this.productIdCache.get(symbol);
    if (cached) return cached;

    const res = await deltaPublicGet<{ result: { id: number; symbol: string }[] }>(
      "/v2/products",
      { contract_types: "perpetual_futures" }
    );

    for (const p of res.result ?? []) {
      this.productIdCache.set(p.symbol, p.id);
    }

    const id = this.productIdCache.get(symbol);
    if (!id) throw new Error(`Product not found for symbol: ${symbol}`);
    return id;
  }

  // ─── Execution ───────────────────────────────────────────────────────────────

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const productId = await this.getProductId(input.symbol);

    const body: Record<string, unknown> = {
      product_id: productId,
      side: input.side,
      order_type: this.mapOrderType(input.type),
      size: input.quantity,
    };

    if (input.price) body.limit_price = String(input.price);
    if (input.postOnly) body.post_only = true;
    if (input.reduceOnly) body.reduce_only = true;
    if (input.clientOrderId) body.client_order_id = input.clientOrderId;

    this.log.info("placing order", { symbol: input.symbol, side: input.side, qty: input.quantity });

    if (input.stopLoss || input.takeProfit) {
      // Use bracket order
      body.bracket_stop_loss_price = input.stopLoss ? String(input.stopLoss) : undefined;
      body.bracket_take_profit_price = input.takeProfit ? String(input.takeProfit) : undefined;
    }

    const res = await deltaRequest<{ result: Record<string, unknown> }>(
      this.creds, "POST", "/v2/orders", undefined, body
    );

    return mapOrderResult(res.result ?? {});
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    const productId = await this.getProductId(input.symbol);
    await deltaRequest(this.creds, "DELETE", "/v2/orders", undefined, {
      id: parseInt(input.exchangeOrderId, 10),
      product_id: productId,
    });
  }

  async modifyOrder(input: ModifyOrderInput): Promise<void> {
    const productId = await this.getProductId(input.symbol);
    const body: Record<string, unknown> = {
      id: parseInt(input.exchangeOrderId, 10),
      product_id: productId,
    };
    if (input.price) body.limit_price = String(input.price);
    if (input.quantity) body.size = input.quantity;
    await deltaRequest(this.creds, "PUT", "/v2/orders", undefined, body);
  }

  // ─── Account Data ─────────────────────────────────────────────────────────────

  async fetchBalances(): Promise<BalanceSnapshot[]> {
    const res = await deltaRequest<{ result: Record<string, unknown>[] }>(
      this.creds, "GET", "/v2/wallet/balances"
    );
    return (res.result ?? []).map(mapBalance);
  }

  async fetchPositions(symbol?: string): Promise<PositionSnapshot[]> {
    const params: Record<string, string> = {};
    if (symbol) {
      const id = await this.getProductId(symbol);
      params.product_ids = String(id);
    }
    const res = await deltaRequest<{ result: Record<string, unknown>[] }>(
      this.creds, "GET", "/v2/positions/margined", params
    );
    return (res.result ?? []).map(mapPosition);
  }

  async fetchOrder(exchangeOrderId: string, symbol: string): Promise<Order | null> {
    try {
      const productId = await this.getProductId(symbol);
      const res = await deltaRequest<{ result: Record<string, unknown> }>(
        this.creds, "GET", `/v2/orders/${exchangeOrderId}`,
        { product_id: String(productId) }
      );
      const raw = res.result ?? {};
      return {
        id: String(raw.client_order_id ?? raw.id),
        clientOrderId: String(raw.client_order_id ?? ""),
        exchangeOrderId: String(raw.id ?? ""),
        symbol: String(raw.product_symbol ?? symbol),
        exchange: EXCHANGE_ID,
        side: String(raw.side ?? "buy") as "buy" | "sell",
        type: "limit",
        price: parseFloat(String(raw.limit_price ?? 0)),
        quantity: parseFloat(String(raw.size ?? 0)),
        filledQuantity: parseFloat(String(raw.size ?? 0)) - parseFloat(String(raw.unfilled_size ?? 0)),
        remainingQuantity: parseFloat(String(raw.unfilled_size ?? 0)),
        status: mapOrderStatus(String(raw.state ?? "")),
        createdAt: new Date(String(raw.created_at ?? Date.now())).getTime(),
        updatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  async fetchFills(symbol?: string, since?: number): Promise<Fill[]> {
    const params: Record<string, string> = {};
    if (symbol) {
      const id = await this.getProductId(symbol);
      params.product_ids = String(id);
    }
    const res = await deltaRequest<{ result: Record<string, unknown>[] }>(
      this.creds, "GET", "/v2/fills", params
    );
    const fills = (res.result ?? []).map(mapFill);
    if (since) return fills.filter((f) => f.ts >= since);
    return fills;
  }

  // ─── Market Data (own Delta stream) ─────────────────────────────────────────

  async *subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    this.ws.subscribe([`l2_orderbook/${symbol}`]);

    const queue: OrderbookSnapshot[] = [];
    let resolveNext: (() => void) | null = null;

    const handler = (msg: Record<string, unknown>) => {
      queue.push(mapOrderbook(msg, symbol));
      resolveNext?.();
      resolveNext = null;
    };

    this.ws.on(`orderbook:${symbol}`, handler);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => { resolveNext = r; });
        }
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      this.ws.off(`orderbook:${symbol}`, handler);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapOrderType(type: string): string {
    switch (type) {
      case "market": return "market_order";
      case "limit":
      case "post_only": return "limit_order";
      default: return "limit_order";
    }
  }

  /** Raw WS client — useful for subscribing additional channels externally */
  get wsClient(): DeltaWsClient {
    return this.ws;
  }
}
