import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { latestTickerCache, marketEvents } from "./streaming";
import { type StrategyType } from "./strategy-config";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { detectSwings, computeAtrArray, type Kline } from "./price-action";

// Default trail % per strategy type
export const TRAIL_PCT: Record<StrategyType, number> = {
  scalping_micro: 0.005,  // 0.5% (was 0.3%)
  scalping:       0.010,  // 1.0% (was 0.5%)
  bb_reversion:   0.015,  // 1.5% (was 0.7%)
  momentum_reversal: 0.020, // 2.0% (was 0.8%)
  intraday:       0.025,  // 2.5% (was 1.0%)
  grid:           0.025,  // 2.5% (was 1.0%)
  swing:          0.050,  // 5.0% (was 2.0%)
  ml_sizing:      0.025,  // 2.5% (was 1.5%)
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
  size: number;
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

// Clean up kline buffers and tracked positions when exits happen
tradingEvents.on("position-closed", (posId: number, symbol: string) => {
  trackedPositions.delete(posId);
  // Optional: Clean up buffer if no other positions are open for this symbol
  let stillTracking = false;
  for (const p of trackedPositions.values()) {
    if (p.symbol === symbol) {
      stillTracking = true;
      break;
    }
  }
  if (!stillTracking) {
    klineBufferCache.delete(symbol);
  }
});

// ─── Core Calculations ───

export function calcNewTrailingStop(
  side: "long" | "short",
  currentStop: number,
  currentPrice: number,
  trailPct: number,
  klines: Kline[],
  entryPrice: number
): number {
  let newStop = currentStop;
  
  if (side === "long") {
    // 1. Swing High / Low Logic (if klines are available)
    if (klines.length >= 10) {
      const swings = detectSwings(klines);
      const activeSwings = swings.filter((s) => s.type === "low");
      if (activeSwings.length > 0) {
        const lastSwingLow = activeSwings[activeSwings.length - 1].price;
        // Don't shift SL down
        newStop = Math.max(currentStop, lastSwingLow);
      }
    }
    
    // 2. Average True Range (ATR) trailing stop
    if (klines.length >= 14) {
      const atrArray = computeAtrArray(klines, 14);
      const lastAtr = atrArray[atrArray.length - 1] ?? 0;
      if (lastAtr > 0) {
        const atrStop = currentPrice - lastAtr * 2.0;
        newStop = Math.max(newStop, atrStop);
      }
    }

    // 3. Percentage Trailing Stop (Fallback/Standard)
    // Ratchet trailing: only updates when price moves up.
    const pctStop = currentPrice * (1 - trailPct);
    newStop = Math.max(newStop, pctStop);
    
  } else {
    // Short side swing points
    if (klines.length >= 10) {
      const swings = detectSwings(klines);
      const activeSwings = swings.filter((s) => s.type === "high");
      if (activeSwings.length > 0) {
        const lastSwingHigh = activeSwings[activeSwings.length - 1].price;
        newStop = Math.min(currentStop, lastSwingHigh);
      }
    }

    // ATR for short
    if (klines.length >= 14) {
      const atrArray = computeAtrArray(klines, 14);
      const lastAtr = atrArray[atrArray.length - 1] ?? 0;
      if (lastAtr > 0) {
        const atrStop = currentPrice + lastAtr * 2.0;
        newStop = Math.min(newStop, atrStop);
      }
    }

    // Percentage Trailing for short
    const pctStop = currentPrice * (1 + trailPct);
    newStop = Math.min(newStop, pctStop);
  }

  // 2. Fee-Aware Breakeven Logic (Wait until 2x risk is reached to lock breakeven)
  const initialRiskLevel = side === "long" ? entryPrice * (1 - trailPct) : entryPrice * (1 + trailPct);
  const initialRisk = Math.abs(entryPrice - initialRiskLevel);
  
  if (side === "long" && currentPrice >= entryPrice + (initialRisk * 2)) {
    const breakeven = entryPrice * (1 + TAKER_FEE * 2);
    newStop = Math.max(newStop, breakeven);
  } else if (side === "short" && currentPrice <= entryPrice - (initialRisk * 2)) {
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

export function isPositionTracked(positionId: number): boolean {
  return trackedPositions.has(positionId);
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
    try {
      if (trackedPositions.size === 0) return;
      const db = getDb();

      for (const [posId, pos] of trackedPositions) {
        try {
          // Price: CoinDCX mark price (accurate) → Binance last price (fallback)
          const markKey = `B-${pos.symbol.replace("USDT", "_USDT")}`;
          let currentPrice = markPriceCache.get(markKey) ?? 0;
          if (currentPrice <= 0) {
            currentPrice = latestTickerCache.get(pos.symbol)?.lastPrice ?? 0;
          }

          if (!currentPrice || currentPrice <= 0) continue;

          const trailPct = TRAIL_PCT[pos.strategyType];
          
          // Check stop-out first
          if (shouldStopOut(pos.side, currentPrice, pos.stopLoss)) {
            // Calculate unrealized PnL using the correct position size
            const unrealizedPnl = pos.side === "long"
              ? (currentPrice - pos.entryPrice) * pos.size
              : (pos.entryPrice - currentPrice) * pos.size;

            // Approximate fees for trailing stop out
            const entryFee = pos.entryPrice * pos.size * TAKER_FEE;
            const exitFee = currentPrice * pos.size * TAKER_FEE;
            const totalFees = entryFee + exitFee;
            const feeAdjustedPnl = unrealizedPnl - totalFees;

            tradingEvents.emit(`exit-signal:${pos.userId}`, {
              positionId: pos.id,
              symbol: pos.symbol,
              strategyType: pos.strategyType,
              currentPrice,
              triggerType: "trailing_stop",
              decision: {
                shouldExit: true,
                unrealizedPnl,
                entryFee,
                exitFee,
                totalFees,
                feeAdjustedPnl,
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
            await db.update(positions)
              .set({ stopLoss: String(newStop), updatedAt: new Date() })
              .where(and(eq(positions.id, posId), eq(positions.status, "open")))
              .catch(() => {});
          }
        } catch (posErr) {
          console.error(`[trailing-stop] Error processing position ${posId} (${pos.symbol}):`, posErr);
        }
      }
    } catch (loopErr) {
      console.error("[trailing-stop] Fatal error in trailing stop loop:", loopErr);
    }
  }, 2_000);
}
