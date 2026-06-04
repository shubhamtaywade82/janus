import type { OrderLevel } from "../../domain/market-data/orderbook.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";

export interface SweepEvent {
  symbol: string;
  side: "buy" | "sell";
  /** Levels that were hit/absorbed */
  levelsHit: number;
  /** Total size consumed */
  sizeConsumed: number;
  price: number;
  ts: number;
}

/**
 * Detects liquidity sweeps — rapid consumption of multiple price levels.
 * A sweep happens when a trade or sequence of aggressive trades removes
 * multiple orderbook levels within a short time window.
 */
export class LiquiditySweepDetector {
  private readonly tradeWindow: { price: number; size: number; side: "buy" | "sell"; ts: number }[] = [];

  constructor(
    private readonly windowMs = 500,
    private readonly minLevelsHit = 3,
    private readonly minSizeMultiple = 2
  ) {}

  onTrade(tick: TradeTick, asks: OrderLevel[], bids: OrderLevel[]): SweepEvent | null {
    const now = tick.ts;
    // Prune old trades
    while (this.tradeWindow.length > 0 && now - this.tradeWindow[0].ts > this.windowMs) {
      this.tradeWindow.shift();
    }
    this.tradeWindow.push({ price: tick.price, size: tick.quantity, side: tick.side, ts: now });

    const buyTrades = this.tradeWindow.filter((t) => t.side === "buy");
    const sellTrades = this.tradeWindow.filter((t) => t.side === "sell");

    const buySweep = this.detectSweep(buyTrades, asks, "buy", tick.ts);
    if (buySweep) return buySweep;

    const sellSweep = this.detectSweep(sellTrades, bids, "sell", tick.ts);
    if (sellSweep) return sellSweep;

    return null;
  }

  private detectSweep(
    trades: typeof this.tradeWindow,
    levels: OrderLevel[],
    side: "buy" | "sell",
    ts: number
  ): SweepEvent | null {
    if (trades.length === 0 || levels.length === 0) return null;

    const totalSize = trades.reduce((s, t) => s + t.size, 0);
    const avgLevelSize = levels.slice(0, 5).reduce((s, l) => s + l.size, 0) / Math.min(5, levels.length);

    // How many levels does this volume represent?
    let remaining = totalSize;
    let levelsConsumed = 0;
    for (const level of levels.slice(0, 10)) {
      if (remaining <= 0) break;
      remaining -= level.size;
      levelsConsumed++;
    }

    if (levelsConsumed >= this.minLevelsHit && totalSize >= avgLevelSize * this.minSizeMultiple) {
      return {
        symbol: trades[0]?.price.toString() ?? "",
        side,
        levelsHit: levelsConsumed,
        sizeConsumed: totalSize,
        price: trades[trades.length - 1]?.price ?? 0,
        ts,
      };
    }

    return null;
  }

  reset(): void {
    this.tradeWindow.length = 0;
  }
}
