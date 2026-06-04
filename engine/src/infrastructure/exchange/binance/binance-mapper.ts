import type { OrderbookSnapshot, OrderLevel } from "../../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../../domain/market-data/trade-tick.js";
import type { Candle, CandleInterval } from "../../../domain/market-data/candle.js";

export const EXCHANGE_ID = "binance";

export function mapDepthToSnapshot(symbol: string, data: Record<string, unknown>): OrderbookSnapshot {
  const rawBids = (data.bids ?? data.b ?? []) as [string, string][];
  const rawAsks = (data.asks ?? data.a ?? []) as [string, string][];

  const mapLevels = (levels: [string, string][]): OrderLevel[] =>
    levels.map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }));

  return {
    symbol,
    exchange: EXCHANGE_ID,
    bids: mapLevels(rawBids),
    asks: mapLevels(rawAsks),
    sequence: (data.lastUpdateId as number) ?? (data.u as number) ?? Date.now(),
    ts: (data.E as number) ?? Date.now(),
  };
}

export function mapTradeToTick(symbol: string, data: Record<string, unknown>): TradeTick {
  return {
    id: String(data.t ?? data.a ?? Date.now()),
    symbol,
    exchange: EXCHANGE_ID,
    price: parseFloat(String(data.p)),
    quantity: parseFloat(String(data.q)),
    side: data.m ? "sell" : "buy",    // m=true means seller is maker → buyer aggressed
    isMaker: Boolean(data.m),
    ts: (data.T as number) ?? Date.now(),
  };
}

export function mapKlineToCandle(symbol: string, data: Record<string, unknown>): Candle {
  const k = data.k as Record<string, unknown>;
  return {
    symbol,
    exchange: EXCHANGE_ID,
    interval: String(k.i) as CandleInterval,
    openTime: k.t as number,
    open: parseFloat(String(k.o)),
    high: parseFloat(String(k.h)),
    low: parseFloat(String(k.l)),
    close: parseFloat(String(k.c)),
    volume: parseFloat(String(k.v)),
    quoteVolume: parseFloat(String(k.q)),
    trades: k.n as number,
    closed: Boolean(k.x),
  };
}
