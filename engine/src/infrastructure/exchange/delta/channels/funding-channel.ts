import type { DeltaWsClient } from "../delta-ws-client.js";
import type { FundingRate } from "../../../../domain/market-data/funding.js";
import { EXCHANGE_ID } from "../delta-mapper.js";

/** Delta funding rate — derived from the v2/ticker channel payload */
export async function* subscribeDeltaFunding(
  client: DeltaWsClient,
  symbol: string
): AsyncIterable<FundingRate> {
  client.subscribe([`v2/ticker/${symbol}`]);

  const queue: FundingRate[] = [];
  let resolve: (() => void) | null = null;

  const handler = (msg: Record<string, unknown>) => {
    const rate = parseFloat(String(msg.funding_rate ?? 0));
    if (rate === 0) return; // skip if not in this tick
    queue.push({
      symbol,
      exchange: EXCHANGE_ID,
      rate,
      nextFundingTime: parseFloat(String(msg.next_funding_realization_ts ?? 0)) * 1000,
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
