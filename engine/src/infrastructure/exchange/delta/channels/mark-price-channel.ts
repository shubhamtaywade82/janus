import type { DeltaWsClient } from "../delta-ws-client.js";
import type { MarkPrice } from "../../../../domain/market-data/funding.js";
import { EXCHANGE_ID } from "../delta-mapper.js";

/** Delta v2/ticker channel — streams mark price, index price, OI */
export async function* subscribeDeltaMarkPrice(
  client: DeltaWsClient,
  symbol: string
): AsyncIterable<MarkPrice> {
  client.subscribe([`v2/ticker/${symbol}`]);

  const queue: MarkPrice[] = [];
  let resolve: (() => void) | null = null;

  const handler = (msg: Record<string, unknown>) => {
    queue.push({
      symbol,
      exchange: EXCHANGE_ID,
      markPrice: parseFloat(String(msg.mark_price ?? msg.mp ?? 0)),
      indexPrice: parseFloat(String(msg.spot_price ?? msg.index_price ?? 0)),
      ts: Date.now(),
    });
    resolve?.();
    resolve = null;
  };

  client.on(`ticker:${symbol}`, handler);
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
      while (queue.length) yield queue.shift()!;
    }
  } finally {
    client.off(`ticker:${symbol}`, handler);
  }
}
