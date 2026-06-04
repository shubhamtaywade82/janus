import type { CoinDCXCredentials } from "./coindcx-rest-client.js";
import { CoinDCXWsClient } from "./coindcx-ws-client.js";
import { CoinDCXOrderClient } from "./clients/order-client.js";
import { CoinDCXFillClient } from "./clients/fill-client.js";
import { CoinDCXPositionClient } from "./clients/position-client.js";
import { EXCHANGE_ID } from "./coindcx-mapper.js";
import { BinanceMarketFeed } from "../binance/binance-market-feed.js";
import type {
  ExchangeGatewayPort, PlaceOrderInput, PlaceOrderResult, BalanceSnapshot, PositionSnapshot,
  CancelOrderInput, ModifyOrderInput,
} from "../../../application/ports/exchange-gateway.port.js";
import type { MarketDataFeedPort } from "../../../application/ports/market-data-feed.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { Order } from "../../../domain/orders/order.js";
import type { Fill } from "../../../domain/fills/fill.js";
import { buildVenueSnapshot, isDriftExcessive } from "../../../application/ports/venue-snapshot.port.js";
import { logger } from "../../observability/logger.js";
import { OrderbookMaintainer } from "../../market-data/orderbook-maintainer.js";

const MAX_VENUE_DRIFT_BPS = parseFloat(process.env.MAX_VENUE_DRIFT_BPS ?? "10");

/**
 * CoinDCX Gateway
 * - Market data: Binance USD-M Futures (price discovery authority)
 * - Execution + account data: CoinDCX REST & Socket.io private stream
 *
 * Cross-exchange drift guard: rejects orders when CoinDCX has moved
 * more than MAX_VENUE_DRIFT_BPS basis points away from Binance mid.
 */
export class CoinDCXGateway implements ExchangeGatewayPort {
  readonly exchangeId = EXCHANGE_ID;

  private readonly ws: CoinDCXWsClient;
  private readonly orderClient: CoinDCXOrderClient;
  private readonly fillClient: CoinDCXFillClient;
  private readonly positionClient: CoinDCXPositionClient;
  private readonly marketFeed: BinanceMarketFeed;
  private readonly log = logger.child({ gateway: EXCHANGE_ID });

  // Live caches
  readonly balancesCache = new Map<string, Record<string, unknown>>();
  readonly positionsCache = new Map<string, Record<string, unknown>>();
  readonly markPriceCache = new Map<string, number>();

  // Per-symbol orderbook maintainers for NBBO drift check
  private readonly books = new Map<string, OrderbookMaintainer>();

  constructor(private readonly creds: CoinDCXCredentials) {
    this.ws = new CoinDCXWsClient(creds);
    this.orderClient = new CoinDCXOrderClient(creds);
    this.fillClient = new CoinDCXFillClient(creds);
    this.positionClient = new CoinDCXPositionClient(creds);
    this.marketFeed = new BinanceMarketFeed();
  }

  async connect(): Promise<void> {
    await this.marketFeed.connect();

    this.ws.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("CoinDCX WS auth timeout")), 15_000);
      this.ws.once("authenticated", () => { clearTimeout(t); resolve(); });
      this.ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    this.ws.on("balanceUpdate", (list: Record<string, unknown>[]) => {
      for (const b of list) {
        const cur = String(b.currency_short_name ?? b.currency ?? "").toUpperCase();
        if (cur) this.balancesCache.set(cur, b);
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
    // Cross-exchange drift guard
    await this.checkVenueDrift(input.symbol, input.price);

    return this.orderClient.placeOrder(input);
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    return this.orderClient.cancelOrder(input);
  }

  async modifyOrder(_input: ModifyOrderInput): Promise<void> {
    throw new Error("CoinDCX does not support order modification. Cancel and re-place.");
  }

  // ─── Account Data ────────────────────────────────────────────────────────────

  async fetchBalances(): Promise<BalanceSnapshot[]> {
    return this.positionClient.fetchBalances();
  }

  async fetchPositions(symbol?: string): Promise<PositionSnapshot[]> {
    return this.positionClient.fetchPositions(symbol);
  }

  async fetchOrder(exchangeOrderId: string, _symbol: string): Promise<Order | null> {
    return this.orderClient.fetchOrder(exchangeOrderId);
  }

  async fetchFills(symbol?: string, since?: number): Promise<Fill[]> {
    return this.fillClient.fetchFills(symbol, since);
  }

  // ─── Market Data (Binance) ──────────────────────────────────────────────────

  get marketDataFeed(): MarketDataFeedPort {
    return this.marketFeed;
  }

  async *subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    const maintainer = this.getOrCreateBook(symbol);
    for await (const snapshot of this.marketFeed.subscribeOrderbook(symbol)) {
      maintainer.applySnapshot(snapshot);
      yield snapshot;
    }
  }

  // ─── Drift guard ─────────────────────────────────────────────────────────────

  private getOrCreateBook(symbol: string): OrderbookMaintainer {
    if (!this.books.has(symbol)) {
      this.books.set(symbol, new OrderbookMaintainer(symbol, "binance"));
    }
    return this.books.get(symbol)!;
  }

  /**
   * Checks whether the CoinDCX mark price has drifted from the Binance mid
   * beyond the configured threshold. Throws if drift is excessive.
   */
  private async checkVenueDrift(symbol: string, signalPrice?: number): Promise<void> {
    const book = this.books.get(symbol);
    const binanceMid = book ? (book.bestBid() ?? 0 + (book.bestAsk() ?? 0)) / 2 : 0;

    // CoinDCX mark price from WS cache (B-BTC_USDT format)
    const nativePair = `B-${symbol.replace("USDT", "_USDT")}`;
    const coindcxMid = this.markPriceCache.get(nativePair) ?? signalPrice ?? 0;

    if (binanceMid === 0 || coindcxMid === 0) return; // can't check — allow through

    const snapshot = buildVenueSnapshot(symbol, binanceMid, binanceMid, coindcxMid, coindcxMid);

    if (isDriftExcessive(snapshot, MAX_VENUE_DRIFT_BPS)) {
      throw new Error(
        `[CoinDCXGateway] Venue drift too high for ${symbol}: ` +
        `${snapshot.driftBps.toFixed(1)} bps > ${MAX_VENUE_DRIFT_BPS} bps limit. ` +
        `Binance mid=${binanceMid}, CoinDCX mid=${coindcxMid}. Signal stale — order rejected.`
      );
    }
  }
}
