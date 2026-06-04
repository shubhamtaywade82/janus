import { DeltaWsClient } from "./delta-ws-client.js";
import { subscribeDeltaDepth } from "./channels/depth-channel.js";
import { subscribeDeltaTrades } from "./channels/trades-channel.js";
import { subscribeDeltaMarkPrice } from "./channels/mark-price-channel.js";
import { subscribeDeltaFunding } from "./channels/funding-channel.js";
import { deltaPublicGet, type DeltaCredentials } from "./delta-rest-client.js";
import { EXCHANGE_ID } from "./delta-mapper.js";
import type { MarketDataFeedPort } from "../../../application/ports/market-data-feed.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../../domain/market-data/trade-tick.js";
import type { AggTrade } from "../../../domain/market-data/market-tick.js";
import type { Candle, CandleInterval } from "../../../domain/market-data/candle.js";
import type { FundingRate, OpenInterest, MarkPrice, BookTicker } from "../../../domain/market-data/funding.js";
import { logger } from "../../observability/logger.js";

/**
 * Delta Exchange India market data feed.
 * Uses Delta's own WebSocket (l2_orderbook, all_trades, v2/ticker) — no Binance dependency.
 */
export class DeltaMarketFeed implements MarketDataFeedPort {
  readonly feedId = EXCHANGE_ID;

  private ws: DeltaWsClient;
  private log = logger.child({ feed: "delta" });

  constructor(creds?: DeltaCredentials) {
    this.ws = new DeltaWsClient(creds);
  }

  async connect(): Promise<void> {
    this.ws.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Delta WS connect timeout")), 15_000);
      this.ws.once("connected", () => { clearTimeout(t); resolve(); });
      this.ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });
    this.log.info("connected");
  }

  async disconnect(): Promise<void> {
    this.ws.disconnect();
  }

  subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    return subscribeDeltaDepth(this.ws, symbol);
  }

  async *subscribeBookTicker(symbol: string): AsyncIterable<BookTicker> {
    for await (const mp of subscribeDeltaMarkPrice(this.ws, symbol)) {
      // Delta doesn't have a separate bookTicker channel — approximate with mark price
      yield {
        symbol,
        exchange: EXCHANGE_ID,
        bidPrice: mp.markPrice,
        bidQty: 0,
        askPrice: mp.markPrice,
        askQty: 0,
        ts: mp.ts,
      };
    }
  }

  subscribeTrades(symbol: string): AsyncIterable<TradeTick> {
    return subscribeDeltaTrades(this.ws, symbol);
  }

  async *subscribeAggTrades(symbol: string): AsyncIterable<AggTrade> {
    // Delta doesn't aggregate trades — proxy through raw trades
    for await (const t of subscribeDeltaTrades(this.ws, symbol)) {
      yield {
        id: t.id,
        symbol: t.symbol,
        exchange: t.exchange,
        price: t.price,
        quantity: t.quantity,
        side: t.side,
        firstTradeId: 0,
        lastTradeId: 0,
        ts: t.ts,
      };
    }
  }

  subscribeMarkPrice(symbol: string): AsyncIterable<MarkPrice> {
    return subscribeDeltaMarkPrice(this.ws, symbol);
  }

  subscribeFundingRate(symbol: string): AsyncIterable<FundingRate> {
    return subscribeDeltaFunding(this.ws, symbol);
  }

  async *subscribeOpenInterest(symbol: string): AsyncIterable<OpenInterest> {
    while (true) {
      try {
        const res = await deltaPublicGet<{ result: Record<string, unknown> }>(
          `/v2/tickers/${symbol}`
        );
        const r = res.result ?? {};
        yield {
          symbol,
          exchange: EXCHANGE_ID,
          openInterest: parseFloat(String(r.oi_value ?? r.open_interest ?? 0)),
          openInterestUsd: parseFloat(String(r.oi_value_usd ?? 0)),
          ts: Date.now(),
        };
      } catch {
        // non-fatal
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  async *subscribeCandles(symbol: string, interval: CandleInterval): AsyncIterable<Candle> {
    // Delta candle WS — uses candlestick_1m/${symbol} format
    this.ws.subscribe([`candlestick_${interval}/${symbol}`]);
    const queue: Candle[] = [];
    let resolve: (() => void) | null = null;
    const handler = (msg: Record<string, unknown>) => {
      const c = msg.candle as Record<string, unknown> ?? msg;
      queue.push({
        symbol,
        exchange: EXCHANGE_ID,
        interval,
        openTime: (parseFloat(String(c.time ?? c.start ?? 0))) * 1000,
        open: parseFloat(String(c.open ?? 0)),
        high: parseFloat(String(c.high ?? 0)),
        low: parseFloat(String(c.low ?? 0)),
        close: parseFloat(String(c.close ?? 0)),
        volume: parseFloat(String(c.volume ?? 0)),
        quoteVolume: 0,
        trades: 0,
        closed: Boolean(c.close !== undefined),
      });
      resolve?.();
      resolve = null;
    };
    this.ws.on("candle", handler);
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      this.ws.off("candle", handler);
    }
  }

  async fetchCandles(symbol: string, interval: CandleInterval, limit = 200): Promise<Candle[]> {
    const res = await deltaPublicGet<{ result: Record<string, unknown>[] }>(
      "/v2/history/candles",
      { symbol, resolution: interval, limit: String(limit) }
    );
    return (res.result ?? []).map((c) => ({
      symbol,
      exchange: EXCHANGE_ID,
      interval,
      openTime: parseFloat(String(c.time ?? 0)) * 1000,
      open: parseFloat(String(c.open ?? 0)),
      high: parseFloat(String(c.high ?? 0)),
      low: parseFloat(String(c.low ?? 0)),
      close: parseFloat(String(c.close ?? 0)),
      volume: parseFloat(String(c.volume ?? 0)),
      quoteVolume: 0,
      trades: 0,
      closed: true,
    }));
  }

  get rawClient(): DeltaWsClient {
    return this.ws;
  }
}
