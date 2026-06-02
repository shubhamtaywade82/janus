import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { latestTickerCache } from "./streaming";
import { type StrategyType } from "./strategy-config";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";

// Default trail % per strategy type
export const TRAIL_PCT: Record<StrategyType, number> = {
  scalping_micro: 0.003,  // 0.3% — very tight for micro scalps
  scalping:       0.005,  // 0.5%
  bb_reversion:   0.007,  // 0.7%
  momentum_reversal: 0.008, // 0.8%
  intraday:       0.010,  // 1.0%
  grid:           0.010,  // 1.0%
  swing:          0.020,  // 2.0%
  ml_sizing:      0.015,  // 1.5%
};

export function calcNewTrailingStop(
  side: "long" | "short",
  currentStop: number,
  currentPrice: number,
  trailPct: number
): number {
  if (side === "long") {
    // Ratchet up: new stop = max(current stop, price * (1 - trail%))
    return Math.max(currentStop, currentPrice * (1 - trailPct));
  } else {
    // Ratchet down: new stop = min(current stop, price * (1 + trail%))
    return Math.min(currentStop, currentPrice * (1 + trailPct));
  }
}

export function shouldStopOut(
  side: "long" | "short",
  currentPrice: number,
  stopLevel: number
): boolean {
  return side === "long" ? currentPrice <= stopLevel : currentPrice >= stopLevel;
}

export interface TrackedPosition {
  id: number;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  strategyType: StrategyType;
  userId: number;
}

const trackedPositions = new Map<number, TrackedPosition>();
let trailingTimer: ReturnType<typeof setInterval> | null = null;

export function registerPositionForTrailing(pos: TrackedPosition) {
  trackedPositions.set(pos.id, { ...pos });
  ensureTrailingEngine();
}

export function unregisterPosition(positionId: number) {
  trackedPositions.delete(positionId);
}

function ensureTrailingEngine() {
  if (trailingTimer) return;
  trailingTimer = setInterval(async () => {
    if (trackedPositions.size === 0) return;
    const db = getDb();

    for (const [posId, pos] of trackedPositions) {
      // Price: CoinDCX mark price (accurate) → Binance last price (fallback)
      const markKey = `B-${pos.symbol.replace("USDT", "_USDT")}`;
      const currentPrice =
        markPriceCache.get(markKey) ??
        latestTickerCache.get(pos.symbol)?.lastPrice;

      if (!currentPrice || currentPrice <= 0) continue;

      const trailPct = TRAIL_PCT[pos.strategyType];

      // Check stop-out first
      if (shouldStopOut(pos.side, currentPrice, pos.stopLoss)) {
        tradingEvents.emit(`exit-signal:${pos.userId}`, {
          positionId: pos.id,
          symbol: pos.symbol,
          strategyType: pos.strategyType,
          currentPrice,
          triggerType: "trailing_stop",
          decision: {
            shouldExit: true,
            unrealizedPnl: pos.side === "long"
              ? (currentPrice - pos.entryPrice) * 1
              : (pos.entryPrice - currentPrice) * 1,
            reason: `Trailing stop hit — price ${currentPrice.toFixed(4)} crossed stop ${pos.stopLoss.toFixed(4)}`,
          },
        });
        trackedPositions.delete(posId);
        continue;
      }

      // Ratchet stop
      const newStop = calcNewTrailingStop(pos.side, pos.stopLoss, currentPrice, trailPct);
      if (Math.abs(newStop - pos.stopLoss) > 1e-8) {
        pos.stopLoss = newStop;
        db.update(positions)
          .set({ stopLoss: String(newStop), updatedAt: new Date() })
          .where(and(eq(positions.id, posId), eq(positions.status, "open")))
          .catch(() => {});
      }
    }
  }, 2_000);
}
