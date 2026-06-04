import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";

export interface MarketDataFeedPort {
  readonly feedId: string;

  subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot>;
  subscribeTrades(symbol: string): AsyncIterable<TradeTick>;
  subscribeCandles(symbol: string, interval: CandleInterval): AsyncIterable<Candle>;

  fetchCandles(symbol: string, interval: CandleInterval, limit?: number): Promise<Candle[]>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
