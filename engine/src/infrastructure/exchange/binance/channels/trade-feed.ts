import type { BinanceWsClient } from "../binance-ws-client.js";
import { mapTradeToTick } from "../binance-mapper.js";
import type { TradeTick } from "../../../../domain/market-data/trade-tick.js";
import type { AggTrade } from "../../../../domain/market-data/market-tick.js";
import { EXCHANGE_ID } from "../binance-mapper.js";

export async function* subscribeBinanceTrades(
  client: BinanceWsClient,
  symbol: string
): AsyncIterable<TradeTick> {
  const stream = `${symbol.toLowerCase()}@trade`;
  client.subscribe([stream]);

  const queue: TradeTick[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    queue.push(mapTradeToTick(symbol, data));
    resolve?.();
    resolve = null;
  };

  client.on(`stream:${stream}`, handler);
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
      while (queue.length) yield queue.shift()!;
    }
  } finally {
    client.off(`stream:${stream}`, handler);
  }
}

/** @aggTrade — aggregated trades (same price, consecutive taker fills merged) */
export async function* subscribeBinanceAggTrades(
  client: BinanceWsClient,
  symbol: string
): AsyncIterable<AggTrade> {
  const stream = `${symbol.toLowerCase()}@aggTrade`;
  client.subscribe([stream]);

  const queue: AggTrade[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    queue.push({
      id: String(data.a),
      symbol,
      exchange: EXCHANGE_ID,
      price: parseFloat(String(data.p)),
      quantity: parseFloat(String(data.q)),
      side: data.m ? "sell" : "buy", // m=true → seller is maker → taker bought
      firstTradeId: data.f as number,
      lastTradeId: data.l as number,
      ts: data.T as number,
    });
    resolve?.();
    resolve = null;
  };

  client.on(`stream:${stream}`, handler);
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
      while (queue.length) yield queue.shift()!;
    }
  } finally {
    client.off(`stream:${stream}`, handler);
  }
}
