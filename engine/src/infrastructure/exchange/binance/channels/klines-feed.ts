import type { BinanceWsClient } from "../binance-ws-client.js";
import { mapKlineToCandle } from "../binance-mapper.js";
import type { Candle, CandleInterval } from "../../../../domain/market-data/candle.js";

export async function* subscribeBinanceKlines(
  client: BinanceWsClient,
  symbol: string,
  interval: CandleInterval = "1m"
): AsyncIterable<Candle> {
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  client.subscribe([stream]);

  const queue: Candle[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    queue.push(mapKlineToCandle(symbol, data));
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
