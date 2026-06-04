import type { BinanceWsClient } from "../binance-ws-client.js";
import type { FundingRate, MarkPrice, BookTicker } from "../../../../domain/market-data/funding.js";
import { EXCHANGE_ID } from "../binance-mapper.js";

/**
 * @markPrice — streams mark price + funding rate every 3s (or 1s with @1s suffix)
 * Only available on USD-M Futures stream (fstream.binance.com)
 */
export async function* subscribeBinanceMarkPrice(
  client: BinanceWsClient,
  symbol: string
): AsyncIterable<{ markPrice: MarkPrice; fundingRate: FundingRate }> {
  const stream = `${symbol.toLowerCase()}@markPrice@1s`;
  client.subscribe([stream]);

  const queue: { markPrice: MarkPrice; fundingRate: FundingRate }[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    const ts = (data.T ?? data.E ?? Date.now()) as number;
    const mp: MarkPrice = {
      symbol,
      exchange: EXCHANGE_ID,
      markPrice: parseFloat(String(data.p ?? data.mp ?? 0)),
      indexPrice: parseFloat(String(data.i ?? 0)),
      ts,
    };
    const fr: FundingRate = {
      symbol,
      exchange: EXCHANGE_ID,
      rate: parseFloat(String(data.r ?? 0)),
      nextFundingTime: (data.T as number) ?? ts,
      ts,
    };
    queue.push({ markPrice: mp, fundingRate: fr });
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

/** @bookTicker — fastest bid/ask update (~5ms) */
export async function* subscribeBinanceBookTicker(
  client: BinanceWsClient,
  symbol: string
): AsyncIterable<BookTicker> {
  const stream = `${symbol.toLowerCase()}@bookTicker`;
  client.subscribe([stream]);

  const queue: BookTicker[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    queue.push({
      symbol,
      exchange: EXCHANGE_ID,
      bidPrice: parseFloat(String(data.b ?? 0)),
      bidQty: parseFloat(String(data.B ?? 0)),
      askPrice: parseFloat(String(data.a ?? 0)),
      askQty: parseFloat(String(data.A ?? 0)),
      ts: Date.now(),
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
