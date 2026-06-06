import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { STRATEGY_CONFIGS, type StrategyType } from "./strategy-config";
import { SUPPORTED_PAIRS } from "./binance";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { env } from "../lib/env";

export interface ExitDecision {
  shouldExit: boolean;
  unrealizedPnl: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  feeAdjustedPnl: number;
  reason: string;
}

export function evaluateExitCondition(
  side: "long" | "short",
  entryPrice: number,
  currentPrice: number,
  size: number,
  takerFeeRate: number,
  stopLoss: number | null = null,
  takeProfit: number | null = null
): ExitDecision {
  const unrealizedPnl =
    side === "long"
      ? (currentPrice - entryPrice) * size
      : (entryPrice - currentPrice) * size;

  const entryFee = entryPrice * size * takerFeeRate;
  const exitFee = currentPrice * size * takerFeeRate;
  const totalFees = entryFee + exitFee;
  const feeAdjustedPnl = unrealizedPnl - totalFees;

  let shouldExit = false;
  let reason =
    feeAdjustedPnl > 0
      ? `PnL ${unrealizedPnl.toFixed(6)} > fees ${totalFees.toFixed(6)}`
      : `PnL ${unrealizedPnl.toFixed(6)} ≤ fees ${totalFees.toFixed(6)} — hold`;

  // Stop loss and take profit triggers
  if (side === "long") {
    if (stopLoss && stopLoss > 0 && currentPrice <= stopLoss) {
      shouldExit = true;
      reason = `Stop Loss hit at ${currentPrice} (SL: ${stopLoss})`;
    } else if (takeProfit && takeProfit > 0 && currentPrice >= takeProfit) {
      shouldExit = true;
      reason = `Take Profit hit at ${currentPrice} (TP: ${takeProfit})`;
    }
  } else {
    if (stopLoss && stopLoss > 0 && currentPrice >= stopLoss) {
      shouldExit = true;
      reason = `Stop Loss hit at ${currentPrice} (SL: ${stopLoss})`;
    } else if (takeProfit && takeProfit > 0 && currentPrice <= takeProfit) {
      shouldExit = true;
      reason = `Take Profit hit at ${currentPrice} (TP: ${takeProfit})`;
    }
  }

  return {
    shouldExit,
    unrealizedPnl,
    entryFee,
    exitFee,
    totalFees,
    feeAdjustedPnl,
    reason,
  };
}

interface MonitoredPosition {
  id: number;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  size: number;
  strategyType: StrategyType;
  stopLoss: number | null;
  takeProfit: number | null;
}

const activeMonitors = new Map<number, ReturnType<typeof setInterval>>();
const closingPositions = new Set<number>();

export function startExitMonitor(userId: number, positions: MonitoredPosition[]) {
  stopExitMonitor(userId);

  if (positions.length === 0) return;

  // Group positions by strategy type; use the shortest interval across active positions
  const minInterval = positions.reduce((min, p) => {
    const interval = STRATEGY_CONFIGS[p.strategyType].signalIntervalMs;
    return interval < min ? interval : min;
  }, Infinity);

  const interval = setInterval(() => {
    try {
      for (const pos of positions) {
        try {
          const config = STRATEGY_CONFIGS[pos.strategyType];
          const binanceSym = pos.symbol.toUpperCase();

          // CoinDCX mark price ONLY — never fall back to Binance for exit decisions
          const markKey = `B-${binanceSym.replace("USDT", "_USDT")}`;
          const currentPrice = markPriceCache?.get(markKey);

          if (!currentPrice || currentPrice <= 0 || Number.isNaN(currentPrice)) {
            console.warn(`[exit-manager] Stale/missing CoinDCX mark price for ${markKey}. Skipping exit evaluation.`);
            continue;
          }

          const decision = evaluateExitCondition(
            pos.side,
            pos.entryPrice,
            currentPrice,
            pos.size,
            config.takerFeeRate,
            pos.stopLoss,
            pos.takeProfit
          );

          if (decision.shouldExit && !closingPositions.has(pos.id)) {
            closingPositions.add(pos.id);
            tradingEvents.emit(`exit-signal:${userId}`, {
              positionId: pos.id,
              symbol: pos.symbol,
              strategyType: pos.strategyType,
              currentPrice,
              decision,
            });
          }
        } catch (posErr) {
          console.error(`[exit-manager] Error evaluating position ${pos.symbol}:`, posErr);
        }
      }
    } catch (loopErr) {
      console.error("[exit-manager] Fatal error in exit monitor loop:", loopErr);
    }
  }, minInterval);

  activeMonitors.set(userId, interval);
}

export function stopExitMonitor(userId: number) {
  const existing = activeMonitors.get(userId);
  if (existing) {
    clearInterval(existing);
    activeMonitors.delete(userId);
  }
}

let daemonInterval: ReturnType<typeof setInterval> | null = null;

export function startDaemon() {
  if (daemonInterval) return;

  const syncAndMonitor = async () => {
    try {
      const db = getDb();
      const isPaperMode = env.paperTrading || !env.placeOrders;

      // Load all open positions
      const openPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.status, "open"),
            eq(positions.isPaper, isPaperMode)
          )
        );

      // Group positions by userId
      const userPositions = new Map<number, MonitoredPosition[]>();
      for (const p of openPositions) {
        const userId = p.userId;
        if (!userPositions.has(userId)) {
          userPositions.set(userId, []);
        }
        userPositions.get(userId)!.push({
          id: p.id,
          symbol: p.symbol,
          side: p.side as "long" | "short",
          entryPrice: parseFloat(p.entryPrice),
          size: parseFloat(p.size),
          strategyType: (p.strategyType ?? "intraday") as any,
          stopLoss: p.stopLoss ? parseFloat(p.stopLoss) : null,
          takeProfit: p.takeProfit ? parseFloat(p.takeProfit) : null,
        });
      }

      // Sync closingPositions set (clean up IDs that are no longer open)
      const openPosIds = new Set(openPositions.map(p => p.id));
      for (const posId of closingPositions) {
        if (!openPosIds.has(posId)) {
          closingPositions.delete(posId);
        }
      }

      // Call startExitMonitor for each user with open positions
      for (const [userId, monitored] of userPositions.entries()) {
        startExitMonitor(userId, monitored);
      }

      // Stop exit monitor for users who no longer have open positions
      for (const userId of activeMonitors.keys()) {
        if (!userPositions.has(userId)) {
          stopExitMonitor(userId);
        }
      }
    } catch (err: any) {
      console.error("[exit-manager] Background sync daemon error:", err);
    }
  };

  syncAndMonitor();
  daemonInterval = setInterval(syncAndMonitor, 5000);
}

// ─── Fee Breakeven Map ───
// Min profitable move % = 2 × takerFeeRate (entry fee + exit fee must be recovered).
// Absolute min move = currentPrice × 2 × takerFeeRate.
// Independent of size — scales linearly, so it's a pure price-level threshold.

export interface FeeBreakevenEntry {
  symbol: string;         // Binance symbol, e.g. "BTCUSDT"
  coindcx: string;        // CoinDCX pair, e.g. "B-BTC_USDT"
  name: string;           // Human name, e.g. "Bitcoin"
  currentPrice: number;   // Live price (mark > ticker fallback > 0 if no feed yet)
  takerFeeRate: number;   // Fractional, e.g. 0.0005
  minMovePct: number;     // Always 2 × takerFeeRate × 100 = 0.10
  minMoveAbs: number;     // currentPrice × 2 × takerFeeRate
}

export function getFeeBreakevenMap(takerFeeRate = 0.0005): FeeBreakevenEntry[] {
  return SUPPORTED_PAIRS.map((pair) => {
    const markKey = pair.coindcx;
    const currentPrice = markPriceCache.get(markKey);

    if (!currentPrice || currentPrice <= 0 || Number.isNaN(currentPrice)) {
      console.warn(`[exit-manager] Stale/missing CoinDCX mark price for ${markKey} in fee breakeven map.`);
    }

    const safePrice = currentPrice && currentPrice > 0 && !Number.isNaN(currentPrice) ? currentPrice : 0;
    const minMovePct = 2 * takerFeeRate * 100;          // e.g. 0.10
    const minMoveAbs = safePrice * 2 * takerFeeRate;  // e.g. $100 for BTC

    return {
      symbol: pair.binance,
      coindcx: pair.coindcx,
      name: pair.name,
      currentPrice: safePrice,
      takerFeeRate,
      minMovePct,
      minMoveAbs,
    };
  });
}
