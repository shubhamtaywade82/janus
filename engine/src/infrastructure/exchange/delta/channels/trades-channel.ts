import type { DeltaWsClient } from "../delta-ws-client.js";
import { mapTrade } from "../delta-mapper.js";
import type { TradeTick } from "../../../../domain/market-data/trade-tick.js";

/** Delta all_trades channel — yields normalized trade ticks */
export async function* subscribeDeltaTrades(
  client: DeltaWsClient,
  symbol: string
): AsyncIterable<TradeTick> {
  client.subscribe([`all_trades/${symbol}`]);

  const queue: TradeTick[] = [];
  let resolve: (() => void) | null = null;

  const handler = (msg: Record<string, unknown>) => {
    queue.push(mapTrade(msg, symbol));
    resolve?.();
    resolve = null;
  };

  client.on(`trades:${symbol}`, handler);
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((r) => { resolve = r; });
      while (queue.length) yield queue.shift()!;
    }
  } finally {
    client.off(`trades:${symbol}`, handler);
  }
}
