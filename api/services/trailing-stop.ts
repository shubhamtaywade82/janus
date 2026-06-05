import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { latestTickerCache, marketEvents } from "./streaming";
import { type StrategyType } from "./strategy-config";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { detectSwings, computeAtrArray, type SwingPoint, type Kline } from "./price-action";

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

const TAKER_FEE = 0.0005;

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

// In-memory Kline buffer per symbol (keeps last 100 1m klines)
const klineBufferCache = new Map<string, Kline[]>();

// Listen to global kline updates to build the buffer
marketEvents.on("kline-update", (symbol: string, kline: any) => {
  if (!klineBufferCache.has(symbol)) klineBufferCache.set(symbol, []);
  const buffer = klineBufferCache.get(symbol)!;
  // If the new kline is the same closeTime as the last one, update it.
  if (buffer.length > 0 && buffer[buffer.length - 1].time === kline.openTime) {
    buffer[buffer.length - 1] = {
      time: kline.openTime,
      open: parseFloat(kline.open),
      high: parseFloat(kline.high),
      low: parseFloat(kline.low),
      close: parseFloat(kline.close),
      volume: parseFloat(kline.volume),
    };
  } else {
    buffer.push({
      time: kline.openTime,
      open: parseFloat(kline.open),
      high: parseFloat(kline.high),
      low: parseFloat(kline.low),
      close: parseFloat(kline.close),
      volume: parseFloat(kline.volume),
    });
    if (buffer.length > 100) buffer.shift();
  }
});

export function calcNewTrailingStop(
  side: "long" | "short",
  currentStop: number,
  currentPrice: number,
  trailPct: number,
  klines: Kline[],
  entryPrice: number
): number {
  let newStop = currentStop;
  
  if (klines.length >= 20) {
    // 1. Market Structure Exit
    const swings = detectSwings(klines, 5);
    if (side === "long") {
      // Find the most recent Swing Low that is > entryPrice
      const recentLows = swings.filter(s => s.type === "low" && s.price > entryPrice).sort((a, b) => b.time - a.time);
      if (recentLows.length > 0) {
        newStop = Math.max(currentStop, recentLows[0].price);
      } else {
        // Fallback to Chandelier Exit (ATR)
        const atrs = computeAtrArray(klines, 14);
        const atr = atrs[atrs.length - 1];
        const highestHigh = Math.max(...klines.slice(-14).map(k => k.high));
        const chandelierStop = highestHigh - (atr * 2.5);
        newStop = Math.max(currentStop, chandelierStop, currentPrice * (1 - trailPct));
      }
    } else {
      // Find the most recent Swing High that is < entryPrice
      const recentHighs = swings.filter(s => s.type === "high" && s.price < entryPrice).sort((a, b) => b.time - a.time);
      if (recentHighs.length > 0) {
        newStop = Math.min(currentStop, recentHighs[0].price);
      } else {
        // Fallback to Chandelier Exit (ATR)
        const atrs = computeAtrArray(klines, 14);
        const atr = atrs[atrs.length - 1];
        const lowestLow = Math.min(...klines.slice(-14).map(k => k.low));
        const chandelierStop = lowestLow + (atr * 2.5);
        newStop = Math.min(currentStop, chandelierStop, currentPrice * (1 + trailPct));
      }
    }
  } else {
    // Basic Ratchet
    if (side === "long") {
      newStop = Math.max(currentStop, currentPrice * (1 - trailPct));
    } else {
      newStop = Math.min(currentStop, currentPrice * (1 + trailPct));
    }
  }

  // 2. Fee-Aware Breakeven Logic (1:1 RR based on static trailPct risk)
  const initialRiskLevel = side === "long" ? entryPrice * (1 - trailPct) : entryPrice * (1 + trailPct);
  const initialRisk = Math.abs(entryPrice - initialRiskLevel);
  
  if (side === "long" && currentPrice >= entryPrice + initialRisk) {
    const breakeven = entryPrice * (1 + TAKER_FEE * 2);
    newStop = Math.max(newStop, breakeven);
  } else if (side === "short" && currentPrice <= entryPrice - initialRisk) {
    const breakeven = entryPrice * (1 - TAKER_FEE * 2);
    newStop = Math.min(newStop, breakeven);
  }
  return newStop;
}

export function shouldStopOut(
  side: "long" | "short",
  currentPrice: number,
  stopLevel: number
): boolean {
  return side === "long" ? currentPrice <= stopLevel : currentPrice >= stopLevel;
}

export function registerPositionForTrailing(pos: TrackedPosition) {
  trackedPositions.set(pos.id, { ...pos });
  ensureTrailingEngine();
}

export function unregisterPosition(positionId: number) {
  trackedPositions.delete(positionId);
}

// Called by position manager when it moves a SL so the trailing engine
// doesn't roll it back on the next 2s tick.
export function syncTrailingStopLoss(positionId: number, newStopLoss: number): void {
  const pos = trackedPositions.get(positionId);
  if (!pos) return;
  const isBetter =
    pos.side === "long" ? newStopLoss > pos.stopLoss : newStopLoss < pos.stopLoss;
  if (isBetter) {
    pos.stopLoss = newStopLoss;
  }
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
      const klines = klineBufferCache.get(pos.symbol) || [];
      const newStop = calcNewTrailingStop(pos.side, pos.stopLoss, currentPrice, trailPct, klines, pos.entryPrice);
      
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
