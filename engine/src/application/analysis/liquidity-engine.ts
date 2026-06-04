import type { Candle } from "../../domain/market-data/candle.js";
import type { LiquidityLevel, LiquiditySweepEvent, LiquidityAnalysis } from "../../domain/analysis/liquidity.js";
import { detectSwingPoints } from "./market-structure-engine.js";

const EQUAL_THRESHOLD = 0.002; // 0.2% — levels within this % are considered "equal"

/**
 * Liquidity is resting where retail traders place their stops.
 *
 * Buy-side liquidity = sell-stop clusters above swing highs (equal highs).
 *   → Smart money hunts this by pushing price above highs, triggering stops,
 *     then reversing.
 *
 * Sell-side liquidity = buy-stop clusters below swing lows (equal lows).
 *   → Smart money pushes price below lows, triggers stops, then reverses.
 *
 * "Equal highs" and "equal lows" are the strongest liquidity pools.
 */
export function detectLiquidityLevels(
  candles: Candle[],
  currentPrice: number,
  lookback = 3
): { buySide: LiquidityLevel[]; sellSide: LiquidityLevel[] } {
  const { highs, lows } = detectSwingPoints(candles, lookback);

  // Group equal highs (buy-side liquidity — stops above highs)
  const buySide = groupEqualLevels(
    highs.filter((h) => h.price > currentPrice).map((h) => ({ price: h.price, ts: h.ts })),
    "BUY_SIDE"
  );

  // Group equal lows (sell-side liquidity — stops below lows)
  const sellSide = groupEqualLevels(
    lows.filter((l) => l.price < currentPrice).map((l) => ({ price: l.price, ts: l.ts })),
    "SELL_SIDE"
  );

  return {
    buySide: buySide.sort((a, b) => a.price - b.price),
    sellSide: sellSide.sort((a, b) => b.price - a.price),
  };
}

function groupEqualLevels(
  levels: { price: number; ts: number }[],
  side: "BUY_SIDE" | "SELL_SIDE"
): LiquidityLevel[] {
  const result: LiquidityLevel[] = [];

  for (const level of levels) {
    const existing = result.find(
      (r) => Math.abs(r.price - level.price) / level.price < EQUAL_THRESHOLD
    );
    if (existing) {
      existing.strength++;
      existing.price = (existing.price + level.price) / 2; // average
    } else {
      result.push({ price: level.price, side, strength: 1, swept: false, ts: level.ts });
    }
  }

  return result;
}

/**
 * Detects liquidity sweeps — when price briefly wicks through a key level
 * and then reverses. This is a classic smart money maneuver.
 *
 * A sweep is confirmed when:
 *   - Price wicks beyond a liquidity level (wick > level, close back inside)
 *   - Volume is elevated
 */
export function detectLiquiditySweep(
  candles: Candle[],
  buySide: LiquidityLevel[],
  sellSide: LiquidityLevel[]
): LiquiditySweepEvent | null {
  if (candles.length < 3) return null;

  const recent = candles.slice(-5);
  const last = recent[recent.length - 1];
  const avgVolume = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / (recent.length - 1);
  const isVolumeElevated = last.volume > avgVolume * 1.5;

  // Buy-side sweep: wick above level, close below level
  for (const level of buySide.slice(0, 3)) {
    if (last.high > level.price && last.close < level.price) {
      const probability = calculateReversalProbability(isVolumeElevated, level.strength, "BUY_SIDE");
      return {
        type: "LIQUIDITY_GRAB",
        side: "BUY_SIDE",
        level: level.price,
        confirmed: isVolumeElevated,
        reversalProbability: probability,
        ts: last.openTime,
      };
    }
  }

  // Sell-side sweep: wick below level, close above level
  for (const level of sellSide.slice(0, 3)) {
    if (last.low < level.price && last.close > level.price) {
      const probability = calculateReversalProbability(isVolumeElevated, level.strength, "SELL_SIDE");
      return {
        type: "LIQUIDITY_GRAB",
        side: "SELL_SIDE",
        level: level.price,
        confirmed: isVolumeElevated,
        reversalProbability: probability,
        ts: last.openTime,
      };
    }
  }

  return null;
}

function calculateReversalProbability(
  volumeElevated: boolean,
  strength: number,
  _side: "BUY_SIDE" | "SELL_SIDE"
): number {
  let base = 50;
  if (volumeElevated) base += 15;
  base += Math.min(20, strength * 5);
  return Math.min(85, base);
}

export function buildLiquidityAnalysis(
  candles: Candle[],
  currentPrice: number
): LiquidityAnalysis {
  const { buySide, sellSide } = detectLiquidityLevels(candles, currentPrice);
  const lastSweep = detectLiquiditySweep(candles, buySide, sellSide);

  const sweepCount24h = 0; // requires historical data — left for extension
  const reversalProbability = lastSweep?.reversalProbability ?? 0;

  return {
    buySide: buySide.slice(0, 5),
    sellSide: sellSide.slice(0, 5),
    lastSweep,
    sweepCount24h,
    reversalProbability,
  };
}
