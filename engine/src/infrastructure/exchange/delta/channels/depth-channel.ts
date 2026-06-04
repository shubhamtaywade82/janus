import type { DeltaWsClient } from "../delta-ws-client.js";
import { mapOrderbook } from "../delta-mapper.js";
import type { OrderbookSnapshot } from "../../../../domain/market-data/orderbook.js";

/** Delta l2_orderbook channel — yields normalized snapshots */
export async function* subscribeDeltaDepth(
  client: DeltaWsClient,
  symbol: string
): AsyncIterable<OrderbookSnapshot> {
  client.subscribe([`l2_orderbook/${symbol}`]);

  const queue: OrderbookSnapshot[] = [];
  let resolve: (() => void) | null = null;

  const handler = (msg: Record<string, unknown>) => {
    queue.push(mapOrderbook(msg, symbol));
    resolve?.();
    resolve = null;
  };

  client.on(`orderbook:${symbol}`, handler);
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
      while (queue.length) yield queue.shift()!;
    }
  } finally {
    client.off(`orderbook:${symbol}`, handler);
  }
}
