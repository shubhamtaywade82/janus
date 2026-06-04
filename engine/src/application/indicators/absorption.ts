import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { OrderLevel } from "../../domain/market-data/orderbook.js";

export interface AbsorptionSignal {
  /** true when sellers are absorbed by bid-side liquidity (potential bounce) */
  bidAbsorption: boolean;
  /** true when buyers are absorbed by ask-side liquidity (potential drop) */
  askAbsorption: boolean;
  bidAbsorptionScore: number; // 0-1
  askAbsorptionScore: number; // 0-1
}

/**
 * Absorption detection: detect when large sell (buy) volume is being
 * absorbed at a price level without moving price significantly.
 *
 * High sell volume + price doesn't fall → bids are absorbing → bullish.
 * High buy volume + price doesn't rise → asks are absorbing → bearish.
 */
export class AbsorptionDetector {
  private readonly tradeWindow: TradeTick[] = [];
  private priceAtWindowStart = 0;

  constructor(
    private readonly windowMs = 5_000,
    private readonly minVolumeMultiple = 3
  ) {}

  onTrade(tick: TradeTick, topBids: OrderLevel[], topAsks: OrderLevel[]): AbsorptionSignal {
    const now = tick.ts;
    while (this.tradeWindow.length > 0 && now - this.tradeWindow[0].ts > this.windowMs) {
      this.tradeWindow.shift();
    }
    if (this.tradeWindow.length === 0) this.priceAtWindowStart = tick.price;
    this.tradeWindow.push(tick);

    const sellVolume = this.tradeWindow
      .filter((t) => t.side === "sell")
      .reduce((s, t) => s + t.quantity, 0);
    const buyVolume = this.tradeWindow
      .filter((t) => t.side === "buy")
      .reduce((s, t) => s + t.quantity, 0);

    const avgBidSize = topBids.slice(0, 3).reduce((s, l) => s + l.size, 0) / 3;
    const avgAskSize = topAsks.slice(0, 3).reduce((s, l) => s + l.size, 0) / 3;

    const priceMove = Math.abs(tick.price - this.priceAtWindowStart);
    const priceMovePct = this.priceAtWindowStart > 0 ? priceMove / this.priceAtWindowStart : 0;

    // Bid absorption: heavy sell volume but price held / moved up
    const bidAbsorptionScore =
      avgBidSize > 0
        ? Math.min(1, (sellVolume / avgBidSize / this.minVolumeMultiple) * (1 - priceMovePct * 100))
        : 0;

    // Ask absorption: heavy buy volume but price held / moved down
    const askAbsorptionScore =
      avgAskSize > 0
        ? Math.min(1, (buyVolume / avgAskSize / this.minVolumeMultiple) * (1 - priceMovePct * 100))
        : 0;

    return {
      bidAbsorption: bidAbsorptionScore > 0.6,
      askAbsorption: askAbsorptionScore > 0.6,
      bidAbsorptionScore: Math.max(0, bidAbsorptionScore),
      askAbsorptionScore: Math.max(0, askAbsorptionScore),
    };
  }

  reset(): void {
    this.tradeWindow.length = 0;
    this.priceAtWindowStart = 0;
  }
}
