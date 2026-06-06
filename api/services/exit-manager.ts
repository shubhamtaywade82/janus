import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { latestTickerCache } from "./streaming";
import { STRATEGY_CONFIGS, type StrategyType } from "./strategy-config";
import { SUPPORTED_PAIRS } from "./binance";

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

export function startExitMonitor(userId: number, positions: MonitoredPosition[]) {
  stopExitMonitor(userId);

  if (positions.length === 0) return;

  // Group positions by strategy type; use the shortest interval across active positions
  const minInterval = positions.reduce((min, p) => {
    const interval = STRATEGY_CONFIGS[p.strategyType].signalIntervalMs;
    return interval < min ? interval : min;
  }, Infinity);

  const interval = setInterval(() => {
    for (const pos of positions) {
      const config = STRATEGY_CONFIGS[pos.strategyType];
      const binanceSym = pos.symbol.toUpperCase();

      // CoinDCX mark price takes priority over Binance last price
      const markKey = `B-${binanceSym.replace("USDT", "_USDT")}`;
      const currentPrice =
        markPriceCache?.get(markKey) ??
        latestTickerCache.get(binanceSym)?.lastPrice;

      if (!currentPrice || currentPrice <= 0) continue;

      const decision = evaluateExitCondition(
        pos.side,
        pos.entryPrice,
        currentPrice,
        pos.size,
        config.takerFeeRate,
        pos.stopLoss,
        pos.takeProfit
      );

      if (decision.shouldExit) {
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

export function stopExitMonitor(userId: number) {
  const existing = activeMonitors.get(userId);
  if (existing) {
    clearInterval(existing);
    activeMonitors.delete(userId);
  }
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
    const currentPrice =
      markPriceCache.get(markKey) ??
      latestTickerCache.get(pair.binance)?.lastPrice ??
      0;

    const minMovePct = 2 * takerFeeRate * 100;          // e.g. 0.10
    const minMoveAbs = currentPrice * 2 * takerFeeRate;  // e.g. $100 for BTC

    return {
      symbol: pair.binance,
      coindcx: pair.coindcx,
      name: pair.name,
      currentPrice,
      takerFeeRate,
      minMovePct,
      minMoveAbs,
    };
  });
}
