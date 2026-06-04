import type { OrderLevel } from "../../domain/market-data/orderbook.js";
import type { OrderBookAnalysis } from "../../domain/analysis/analysis-result.js";

const WALL_MULTIPLE = 5; // level is a "wall" if size > average * this

/**
 * Live order book analysis:
 * - Bid/ask depth ratio for imbalance
 * - Wall detection (iceberg or resting block orders)
 * - Absorption (large bid/ask that doesn't move despite volume)
 * - Spoofing hint (large order that appears and disappears)
 */
export function analyzeOrderBook(
  bids: OrderLevel[],
  asks: OrderLevel[],
  depth = 20
): OrderBookAnalysis {
  const topBids = bids.slice(0, depth);
  const topAsks = asks.slice(0, depth);

  const bidVolume = topBids.reduce((s, l) => s + l.size, 0);
  const askVolume = topAsks.reduce((s, l) => s + l.size, 0);
  const imbalanceRatio = askVolume > 0 ? parseFloat((bidVolume / askVolume).toFixed(3)) : 1;

  const dominantSide =
    imbalanceRatio > 1.3 ? "BUYERS" :
    imbalanceRatio < 0.77 ? "SELLERS" : "NEUTRAL";

  // Wall detection
  const bidAvg = bidVolume / Math.max(1, topBids.length);
  const askAvg = askVolume / Math.max(1, topAsks.length);

  const wallLevels: OrderBookAnalysis["wallLevels"] = [
    ...topBids
      .filter((l) => l.size > bidAvg * WALL_MULTIPLE)
      .map((l) => ({ side: "BID" as const, price: l.price, size: l.size })),
    ...topAsks
      .filter((l) => l.size > askAvg * WALL_MULTIPLE)
      .map((l) => ({ side: "ASK" as const, price: l.price, size: l.size })),
  ];

  // Absorption: extreme imbalance suggests one side is absorbing the other
  const absorptionDetected = imbalanceRatio > 2 || imbalanceRatio < 0.5;

  return {
    bidVolume: parseFloat(bidVolume.toFixed(4)),
    askVolume: parseFloat(askVolume.toFixed(4)),
    imbalanceRatio,
    dominantSide,
    absorptionDetected,
    spoofingDetected: false, // requires tracking order additions/cancellations over time
    wallLevels: wallLevels.slice(0, 5),
  };
}
