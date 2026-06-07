import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { STRATEGY_CONFIGS, type StrategyType } from "./strategy-config";
import { SUPPORTED_PAIRS } from "./binance";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { env } from "../lib/env";

export interface MonitoredPosition {
  id: number;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  size: number;
  strategyType: StrategyType;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface ExitDecision {
  shouldExit: boolean;
  unrealizedPnl: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  feeAdjustedPnl: number;
  reason: string;
}

const activeMonitors = new Map<number, ReturnType<typeof setInterval>>();
const closingPositions = new Set<number>();

export function evaluateExitCondition(
  side: "long" | "short",
  entryPrice: number,
  currentPrice: number,
  size: number,
  takerFeeRate: number,
  stopLoss: number | null = null,
  takeProfit: number | null = null
): ExitDecision {
  const unrealizedPnl = side === "long" ? (currentPrice - entryPrice) * size : (entryPrice - currentPrice) * size;
  const totalFees = (entryPrice + currentPrice) * size * takerFeeRate;
  const feeAdjustedPnl = unrealizedPnl - totalFees;

  let shouldExit = false;
  let reason = feeAdjustedPnl > 0 ? `PnL ${unrealizedPnl.toFixed(6)} > fees ${totalFees.toFixed(6)}` : "Hold";

  const isLong = side === "long";
  const slHit = stopLoss && stopLoss > 0 && (isLong ? currentPrice <= stopLoss : currentPrice >= stopLoss);
  const tpHit = takeProfit && takeProfit > 0 && (isLong ? currentPrice >= takeProfit : currentPrice <= takeProfit);

  if (slHit) {
    shouldExit = true;
    reason = `Stop Loss hit at ${currentPrice} (SL: ${stopLoss})`;
  } else if (tpHit) {
    shouldExit = true;
    reason = `Take Profit hit at ${currentPrice} (TP: ${takeProfit})`;
  }

  return {
    shouldExit,
    unrealizedPnl,
    entryFee: entryPrice * size * takerFeeRate,
    exitFee: currentPrice * size * takerFeeRate,
    totalFees,
    feeAdjustedPnl,
    reason,
  };
}

export function startExitMonitor(userId: number, positions: MonitoredPosition[]) {
  stopExitMonitor(userId);
  if (positions.length === 0) return;

  const minInterval = Math.min(...positions.map(p => STRATEGY_CONFIGS[p.strategyType].signalIntervalMs));

  const interval = setInterval(() => {
    for (const pos of positions) {
      if (closingPositions.has(pos.id)) continue;

      const currentPrice = getMarkPrice(pos.symbol);
      if (!currentPrice) continue;

      const config = STRATEGY_CONFIGS[pos.strategyType];
      const decision = evaluateExitCondition(
        pos.side, pos.entryPrice, currentPrice, pos.size, config.takerFeeRate, pos.stopLoss, pos.takeProfit
      );

      if (decision.shouldExit) {
        closingPositions.add(pos.id);
        tradingEvents.emit(`exit-signal:${userId}`, {
          positionId: pos.id,
          symbol: pos.symbol,
          strategyType: pos.strategyType,
          currentPrice,
          decision,
        });
      }
    }
  }, minInterval);

  activeMonitors.set(userId, interval);
}

function getMarkPrice(symbol: string): number | null {
  const markKey = `B-${symbol.toUpperCase().replace("USDT", "_USDT")}`;
  const price = markPriceCache?.get(markKey);
  return (price && price > 0 && !Number.isNaN(price)) ? price : null;
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

      const openPositions = await db.select().from(positions).where(and(eq(positions.status, "open"), eq(positions.isPaper, isPaperMode)));
      const openPosIds = new Set(openPositions.map(p => p.id));

      // Clean up closing set
      for (const id of closingPositions) {
        if (!openPosIds.has(id)) closingPositions.delete(id);
      }

      // Group by user and start monitors
      const userPosMap = openPositions.reduce((acc, p) => {
        const userId = p.userId;
        if (!acc.has(userId)) acc.set(userId, []);
        acc.get(userId)!.push({
          id: p.id,
          symbol: p.symbol,
          side: p.side as "long" | "short",
          entryPrice: parseFloat(p.entryPrice),
          size: parseFloat(p.size),
          strategyType: (p.strategyType ?? "intraday") as any,
          stopLoss: p.stopLoss ? parseFloat(p.stopLoss) : null,
          takeProfit: p.takeProfit ? parseFloat(p.takeProfit) : null,
        });
        return acc;
      }, new Map<number, MonitoredPosition[]>());

      for (const [userId, monitored] of userPosMap) {
        startExitMonitor(userId, monitored);
      }

      // Stop idle monitors
      for (const userId of activeMonitors.keys()) {
        if (!userPosMap.has(userId)) stopExitMonitor(userId);
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
