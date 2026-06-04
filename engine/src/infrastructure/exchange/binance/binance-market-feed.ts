import { BinanceWsClient } from "./binance-ws-client.js";
import { EXCHANGE_ID } from "./binance-mapper.js";
import { subscribeBinanceDepth } from "./channels/depth-feed.js";
import { subscribeBinanceTrades, subscribeBinanceAggTrades } from "./channels/trade-feed.js";
import { subscribeBinanceKlines } from "./channels/klines-feed.js";
import { subscribeBinanceMarkPrice, subscribeBinanceBookTicker } from "./channels/funding-feed.js";
import type { MarketDataFeedPort } from "../../../application/ports/market-data-feed.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../../domain/market-data/trade-tick.js";
import type { AggTrade } from "../../../domain/market-data/market-tick.js";
import type { Candle, CandleInterval } from "../../../domain/market-data/candle.js";
import type { FundingRate, OpenInterest, MarkPrice, BookTicker } from "../../../domain/market-data/funding.js";
import { logger } from "../../observability/logger.js";

const FUTURES_WS_URL = "wss://fstream.binance.com";
const FUTURES_REST_BASE = "https://fapi.binance.com";

export class BinanceMarketFeed implements MarketDataFeedPort {
  readonly feedId = EXCHANGE_ID;

  private wsClient: BinanceWsClient;
  private log = logger.child({ feed: "binance" });

  constructor(wsBaseUrl = FUTURES_WS_URL) {
    this.wsClient = new BinanceWsClient(wsBaseUrl);
  }

  async connect(): Promise<void> {
    this.wsClient.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Binance WS connect timeout")), 10_000);
      this.wsClient.once("connected", () => { clearTimeout(t); resolve(); });
      this.wsClient.once("error", (e) => { clearTimeout(t); reject(e); });
    });
    this.log.info("connected");
  }

  async disconnect(): Promise<void> {
    this.wsClient.disconnect();
  }

  subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    return subscribeBinanceDepth(this.wsClient, symbol);
  }

  subscribeBookTicker(symbol: string): AsyncIterable<BookTicker> {
    return subscribeBinanceBookTicker(this.wsClient, symbol);
  }

  subscribeTrades(symbol: string): AsyncIterable<TradeTick> {
    return subscribeBinanceTrades(this.wsClient, symbol);
  }

  subscribeAggTrades(symbol: string): AsyncIterable<AggTrade> {
    return subscribeBinanceAggTrades(this.wsClient, symbol);
  }

  subscribeCandles(symbol: string, interval: CandleInterval): AsyncIterable<Candle> {
    return subscribeBinanceKlines(this.wsClient, symbol, interval);
  }

  async *subscribeMarkPrice(symbol: string): AsyncIterable<MarkPrice> {
    for await (const { markPrice } of subscribeBinanceMarkPrice(this.wsClient, symbol)) {
      yield markPrice;
    }
  }

  async *subscribeFundingRate(symbol: string): AsyncIterable<FundingRate> {
    for await (const { fundingRate } of subscribeBinanceMarkPrice(this.wsClient, symbol)) {
      yield fundingRate;
    }
  }

  async *subscribeOpenInterest(symbol: string): AsyncIterable<OpenInterest> {
    // Binance OI requires a separate REST poll — WS not available for futures OI changes
    while (true) {
      try {
        const res = await fetch(`${FUTURES_REST_BASE}/fapi/v1/openInterest?symbol=${symbol}`);
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          yield {
            symbol,
            exchange: EXCHANGE_ID,
            openInterest: parseFloat(String(data.openInterest ?? 0)),
            openInterestUsd: 0,
            ts: Date.now(),
          };
        }
      } catch {
        // non-fatal
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  async fetchCandles(symbol: string, interval: CandleInterval, limit = 200): Promise<Candle[]> {
    const url = `${FUTURES_REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance REST error ${res.status}`);
    const raw = (await res.json()) as [number, string, string, string, string, string, number, string, number][];
    return raw.map(([t, o, h, l, c, v, ct, qv, n]) => ({
      symbol,
      exchange: this.feedId,
      interval,
      openTime: t,
      open: parseFloat(o),
      high: parseFloat(h),
      low: parseFloat(l),
      close: parseFloat(c),
      volume: parseFloat(v),
      quoteVolume: parseFloat(qv),
      trades: n,
      closed: true,
    }));
  }

  get rawClient(): BinanceWsClient {
    return this.wsClient;
  }
}
