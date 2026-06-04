import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { AggTrade } from "../../domain/market-data/market-tick.js";

export interface AggressorFlow {
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  /** (buyVolume - sellVolume) / totalVolume, [-1, 1] */
  delta: number;
  /** Cumulative delta over the window */
  cumulativeDelta: number;
  dominance: "buy" | "sell" | "neutral";
}

/**
 * Tracks aggressive (taker-initiated) volume in a rolling time window.
 * A strongly positive delta means buyers are aggressively lifting the ask
 * — bullish pressure. Negative = bearish pressure.
 */
export class AggressiveVolumeTracker {
  private readonly window: { side: "buy" | "sell"; size: number; ts: number }[] = [];
  private cumulativeDelta = 0;

  constructor(
    private readonly windowMs = 30_000,
    private readonly neutralThreshold = 0.1
  ) {}

  onTrade(tick: TradeTick | AggTrade): AggressorFlow {
    const now = tick.ts;
    while (this.window.length > 0 && now - this.window[0].ts > this.windowMs) {
      const evicted = this.window.shift()!;
      this.cumulativeDelta += evicted.side === "buy" ? -evicted.size : evicted.size;
    }
    this.window.push({ side: tick.side, size: tick.quantity, ts: now });
    this.cumulativeDelta += tick.side === "buy" ? tick.quantity : -tick.quantity;

    const buyVolume = this.window.filter((t) => t.side === "buy").reduce((s, t) => s + t.size, 0);
    const sellVolume = this.window.filter((t) => t.side === "sell").reduce((s, t) => s + t.size, 0);
    const totalVolume = buyVolume + sellVolume;
    const delta = totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;

    return {
      buyVolume,
      sellVolume,
      totalVolume,
      delta,
      cumulativeDelta: this.cumulativeDelta,
      dominance:
        delta > this.neutralThreshold
          ? "buy"
          : delta < -this.neutralThreshold
          ? "sell"
          : "neutral",
    };
  }

  reset(): void {
    this.window.length = 0;
    this.cumulativeDelta = 0;
  }
}
