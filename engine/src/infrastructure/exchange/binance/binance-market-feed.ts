import { BinanceWsClient } from "./binance-ws-client.js";
import { mapDepthToSnapshot, mapTradeToTick, mapKlineToCandle } from "./binance-mapper.js";
import type { MarketDataFeedPort } from "../../../application/ports/market-data-feed.port.js";
import type { OrderbookSnapshot } from "../../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../../domain/market-data/trade-tick.js";
import type { Candle, CandleInterval } from "../../../domain/market-data/candle.js";
import { logger } from "../../observability/logger.js";

const FUTURES_WS_URL = "wss://fstream.binance.com";
const FUTURES_REST_BASE = "https://fapi.binance.com";

export class BinanceMarketFeed implements MarketDataFeedPort {
  readonly feedId = "binance";

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

  async *subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot> {
    const stream = `${symbol.toLowerCase()}@depth20@100ms`;
    this.wsClient.subscribe([stream]);

    const queue: OrderbookSnapshot[] = [];
    let resolve: (() => void) | null = null;

    const handler = (data: Record<string, unknown>) => {
      queue.push(mapDepthToSnapshot(symbol, data));
      resolve?.();
      resolve = null;
    };

    this.wsClient.on(`stream:${stream}`, handler);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => { resolve = r; });
        }
        while (queue.length) {
          yield queue.shift()!;
        }
      }
    } finally {
      this.wsClient.off(`stream:${stream}`, handler);
    }
  }

  async *subscribeTrades(symbol: string): AsyncIterable<TradeTick> {
    const stream = `${symbol.toLowerCase()}@trade`;
    this.wsClient.subscribe([stream]);

    const queue: TradeTick[] = [];
    let resolve: (() => void) | null = null;

    const handler = (data: Record<string, unknown>) => {
      queue.push(mapTradeToTick(symbol, data));
      resolve?.();
      resolve = null;
    };

    this.wsClient.on(`stream:${stream}`, handler);

    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      this.wsClient.off(`stream:${stream}`, handler);
    }
  }

  async *subscribeCandles(symbol: string, interval: CandleInterval): AsyncIterable<Candle> {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    this.wsClient.subscribe([stream]);

    const queue: Candle[] = [];
    let resolve: (() => void) | null = null;

    const handler = (data: Record<string, unknown>) => {
      const candle = mapKlineToCandle(symbol, data);
      queue.push(candle);
      resolve?.();
      resolve = null;
    };

    this.wsClient.on(`stream:${stream}`, handler);

    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      this.wsClient.off(`stream:${stream}`, handler);
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
}
