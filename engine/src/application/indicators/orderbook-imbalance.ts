import type { OrderLevel } from "../../domain/market-data/orderbook.js";

export interface ImbalanceResult {
  /** [-1, 1] — positive = bid-heavy, negative = ask-heavy */
  imbalance: number;
  bidDepth: number;
  askDepth: number;
  /** Weighted imbalance — top levels carry more weight */
  weightedImbalance: number;
}

/**
 * Orderbook imbalance — compares bid vs ask depth.
 * Weighted version gives more weight to levels closer to mid.
 */
export function computeImbalance(
  bids: OrderLevel[],
  asks: OrderLevel[],
  depth = 10
): ImbalanceResult {
  const topBids = bids.slice(0, depth);
  const topAsks = asks.slice(0, depth);

  const bidDepth = topBids.reduce((s, l) => s + l.size, 0);
  const askDepth = topAsks.reduce((s, l) => s + l.size, 0);
  const total = bidDepth + askDepth;

  const imbalance = total > 0 ? (bidDepth - askDepth) / total : 0;

  // Linear weights: level 0 = weight N, level N-1 = weight 1
  let wBid = 0;
  let wAsk = 0;
  let wTotal = 0;

  for (let i = 0; i < Math.max(topBids.length, topAsks.length); i++) {
    const w = depth - i;
    wTotal += w * 2;
    if (i < topBids.length) wBid += topBids[i].size * w;
    if (i < topAsks.length) wAsk += topAsks[i].size * w;
  }

  const weightedImbalance = wTotal > 0 ? (wBid - wAsk) / wTotal : 0;

  return { imbalance, bidDepth, askDepth, weightedImbalance };
}

/** Running imbalance with smoothing */
export class OrderbookImbalanceIndicator {
  private smoothed = 0;

  constructor(private readonly smoothingFactor = 0.3, private readonly depth = 10) {}

  update(bids: OrderLevel[], asks: OrderLevel[]): ImbalanceResult {
    const result = computeImbalance(bids, asks, this.depth);
    this.smoothed =
      result.imbalance * this.smoothingFactor +
      this.smoothed * (1 - this.smoothingFactor);
    return { ...result, imbalance: this.smoothed };
  }

  get current(): number {
    return this.smoothed;
  }
}
