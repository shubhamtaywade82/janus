import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { AggTrade } from "../../domain/market-data/market-tick.js";
import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type { FundingRate, OpenInterest, MarkPrice, BookTicker } from "../../domain/market-data/funding.js";

export interface MarketDataFeedPort {
  readonly feedId: string;

  // Order book
  subscribeOrderbook(symbol: string): AsyncIterable<OrderbookSnapshot>;
  subscribeBookTicker(symbol: string): AsyncIterable<BookTicker>;

  // Trades
  subscribeTrades(symbol: string): AsyncIterable<TradeTick>;
  subscribeAggTrades(symbol: string): AsyncIterable<AggTrade>;

  // Candles
  subscribeCandles(symbol: string, interval: CandleInterval): AsyncIterable<Candle>;
  fetchCandles(symbol: string, interval: CandleInterval, limit?: number): Promise<Candle[]>;

  // Derivatives data
  subscribeMarkPrice(symbol: string): AsyncIterable<MarkPrice>;
  subscribeFundingRate(symbol: string): AsyncIterable<FundingRate>;
  subscribeOpenInterest(symbol: string): AsyncIterable<OpenInterest>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
