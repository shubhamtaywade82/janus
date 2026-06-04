import type { BinanceWsClient } from "../binance-ws-client.js";
import { mapDepthToSnapshot } from "../binance-mapper.js";
import type { OrderbookSnapshot } from "../../../../domain/market-data/orderbook.js";

/** Subscribes to @depth20@100ms and yields normalized orderbook snapshots */
export function* noop(): Generator<never> {} // ensures file is treated as ESM module

export async function* subscribeBinanceDepth(
  client: BinanceWsClient,
  symbol: string
): AsyncIterable<OrderbookSnapshot> {
  const stream = `${symbol.toLowerCase()}@depth20@100ms`;
  client.subscribe([stream]);

  const queue: OrderbookSnapshot[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: Record<string, unknown>) => {
    queue.push(mapDepthToSnapshot(symbol, data));
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
