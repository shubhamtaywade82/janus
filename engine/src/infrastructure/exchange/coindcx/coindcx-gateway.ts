import { cdxPost, cdxGet, type CoinDCXCredentials } from "./coindcx-rest-client.js";
import { CoinDCXWsClient } from "./coindcx-ws-client.js";
import {
  mapBalance, mapPosition, mapFill, mapOrderStatus, toNative, toCanonical, EXCHANGE_ID,
} from "./coindcx-mapper.js";
import { BinanceMarketFeed } from "../binance/binance-market-feed.js";
import type { ExchangeGatewayPort, PlaceOrderInput, PlaceOrderResult, BalanceSnapshot, PositionSnapshot, CancelOrderInput, ModifyOrderInput } from "../../../application/ports/exchange-gateway.port.js";
import type { MarketDataFeedPort } from "../../../application/ports/market-data-feed.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { Order } from "../../../domain/orders/order.js";
import type { Fill } from "../../../domain/fills/fill.js";
import { logger } from "../../observability/logger.js";

/**
 * CoinDCX Gateway
 * - Execution + account data: CoinDCX REST & Socket.io private stream
 * - Market data: Binance USD-M Futures WebSocket feed
 */
export class CoinDCXGateway implements ExchangeGatewayPort {
  readonly exchangeId = EXCHANGE_ID;

  private readonly ws: CoinDCXWsClient;
  private readonly marketFeed: BinanceMarketFeed;
  private readonly log = logger.child({ gateway: EXCHANGE_ID });

  // Live caches populated by WS events
  readonly balancesCache = new Map<string, Record<string, unknown>>();
  readonly positionsCache = new Map<string, Record<string, unknown>>();
  readonly markPriceCache = new Map<string, number>();

  constructor(private readonly creds: CoinDCXCredentials) {
    this.ws = new CoinDCXWsClient(creds);
    this.marketFeed = new BinanceMarketFeed();
  }

  async connect(): Promise<void> {
    // Connect Binance market feed
    await this.marketFeed.connect();

    // Connect CoinDCX private stream
    this.ws.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("CoinDCX WS auth timeout")), 15_000);
      this.ws.once("authenticated", () => { clearTimeout(t); resolve(); });
      this.ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    this.ws.on("balanceUpdate", (list: Record<string, unknown>[]) => {
      for (const b of list) {
        const currency = String(b.currency_short_name ?? b.currency ?? "").toUpperCase();
        if (currency) this.balancesCache.set(currency, b);
      }
    });

    this.ws.on("positionUpdate", (list: Record<string, unknown>[]) => {
      for (const p of list) {
        const pair = String(p.pair ?? "");
        if (pair) this.positionsCache.set(pair, p);
      }
    });

    this.ws.on("markPrices", (prices: Record<string, { mp: number }>) => {
      for (const [pair, data] of Object.entries(prices)) {
        if (data?.mp) this.markPriceCache.set(pair, data.mp);
      }
    });

    this.log.info("connected");
  }

  async disconnect(): Promise<void> {
    this.ws.disconnect();
    await this.marketFeed.disconnect();
  }

  // ─── Execution ───────────────────────────────────────────────────────────────

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

    this.log.info("placing order", { market, side: input.side, qty: input.quantity });
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

  async modifyOrder(_input: ModifyOrderInput): Promise<void> {
    // CoinDCX does not support order modification — cancel + re-place
    throw new Error("CoinDCX does not support order modification. Cancel and re-place.");
  }

  // ─── Account Data ────────────────────────────────────────────────────────────

  async fetchBalances(): Promise<BalanceSnapshot[]> {
    const raw = await cdxGet<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/wallets"
    );
    return raw.map(mapBalance);
  }

  async fetchPositions(_symbol?: string): Promise<PositionSnapshot[]> {
    const raw = await cdxPost<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/positions",
      { margin_currency_short_name: ["INR", "USDT"] }
    );
    return raw.map(mapPosition);
  }

  async fetchOrder(exchangeOrderId: string, _symbol: string): Promise<Order | null> {
    try {
      const raw = await cdxPost<Record<string, unknown>>(
        this.creds,
        "/exchange/v1/orders/status",
        { id: exchangeOrderId }
      );
      return {
        id: String(raw.client_order_id ?? raw.id),
        clientOrderId: String(raw.client_order_id ?? ""),
        exchangeOrderId: String(raw.id ?? ""),
        symbol: toCanonical(String(raw.market ?? "")),
        exchange: EXCHANGE_ID,
        side: String(raw.side ?? "buy") as "buy" | "sell",
        type: "limit",
        price: parseFloat(String(raw.price ?? 0)),
        quantity: parseFloat(String(raw.total_quantity ?? 0)),
        filledQuantity: parseFloat(String(raw.total_quantity ?? 0)) - parseFloat(String(raw.remaining_quantity ?? 0)),
        remainingQuantity: parseFloat(String(raw.remaining_quantity ?? 0)),
        status: mapOrderStatus(String(raw.status ?? "")),
        createdAt: new Date(String(raw.created_at ?? Date.now())).getTime(),
        updatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  async fetchFills(symbol?: string, _since?: number): Promise<Fill[]> {
    const body: Record<string, unknown> = { status: "filled", margin_currency_short_name: ["USDT", "INR"] };
    if (symbol) body.market = toNative(symbol);
    const raw = await cdxPost<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/orders",
      body
    );
    return raw.map((r) => mapFill(r, String(r.client_order_id ?? r.id)));
  }

  // ─── Market Data (delegates to Binance) ──────────────────────────────────────

  get marketDataFeed(): MarketDataFeedPort {
    return this.marketFeed;
  }

  async *subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    yield* this.marketFeed.subscribeOrderbook(symbol);
  }
}
