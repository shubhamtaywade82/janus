import { nanoid } from "nanoid";
import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type { OrderBlock, OrderBlockAnalysis } from "../../domain/analysis/order-block.js";
import { detectSwingPoints } from "./market-structure-engine.js";

/**
 * Order Block Detection — Smart Money Concepts
 *
 * Bullish OB: The last bearish (red) candle before a bullish break of structure.
 *   It represents the origin of the impulsive up-move — institutional buy orders
 *   are likely resting in this zone. Price often retraces to it before continuing.
 *
 * Bearish OB: The last bullish (green) candle before a bearish break of structure.
 */
export function detectOrderBlocks(
  candles: Candle[],
  timeframe: CandleInterval,
  lookback = 3
): OrderBlock[] {
  if (candles.length < 10) return [];

  const blocks: OrderBlock[] = [];
  const { highs, lows } = detectSwingPoints(candles, lookback);
  if (highs.length < 2 || lows.length < 2) return blocks;

  // Detect bullish order blocks
  // Look for the last bearish candle before each bullish BOS
  for (let i = lookback; i < candles.length - 1; i++) {
    const next = candles[i + 1];
    if (!next) continue;

    // Bullish impulsive move: current candle closes above a recent swing high
    const swingHighBefore = highs.filter((h) => h.index < i).pop();
    if (swingHighBefore && next.close > swingHighBefore.price) {
      // Find the last bearish candle before this impulse
      let obIndex = i;
      while (obIndex >= 0 && candles[obIndex].close >= candles[obIndex].open) {
        obIndex--;
      }
      if (obIndex >= 0) {
        const ob = candles[obIndex];
        const moveSize = next.close - swingHighBefore.price;
        const strength = Math.min(100, Math.round((moveSize / swingHighBefore.price) * 1000));
        blocks.push({
          id: nanoid(),
          type: "BULLISH",
          timeframe,
          high: ob.high,
          low: ob.low,
          midpoint: (ob.high + ob.low) / 2,
          originTs: ob.openTime,
          status: "ACTIVE",
          strength,
          touched: 0,
        });
      }
    }

    // Bearish impulsive move: current candle closes below a recent swing low
    const swingLowBefore = lows.filter((l) => l.index < i).pop();
    if (swingLowBefore && next.close < swingLowBefore.price) {
      // Find the last bullish candle before this impulse
      let obIndex = i;
      while (obIndex >= 0 && candles[obIndex].close <= candles[obIndex].open) {
        obIndex--;
      }
      if (obIndex >= 0) {
        const ob = candles[obIndex];
        const moveSize = swingLowBefore.price - next.close;
        const strength = Math.min(100, Math.round((moveSize / swingLowBefore.price) * 1000));
        blocks.push({
          id: nanoid(),
          type: "BEARISH",
          timeframe,
          high: ob.high,
          low: ob.low,
          midpoint: (ob.high + ob.low) / 2,
          originTs: ob.openTime,
          status: "ACTIVE",
          strength,
          touched: 0,
        });
      }
    }
  }

  // De-duplicate by proximity (merge overlapping blocks)
  return deduplicateBlocks(blocks);
}

function deduplicateBlocks(blocks: OrderBlock[]): OrderBlock[] {
  const result: OrderBlock[] = [];
  for (const b of blocks) {
    const overlapping = result.find(
      (r) => r.type === b.type && Math.abs(r.midpoint - b.midpoint) / b.midpoint < 0.003
    );
    if (!overlapping) result.push(b);
  }
  return result;
}

/**
 * Marks order blocks as MITIGATED when price trades through them.
 */
export function updateOrderBlockStatus(blocks: OrderBlock[], currentPrice: number): OrderBlock[] {
  return blocks.map((ob) => {
    if (ob.status !== "ACTIVE") return ob;

    if (ob.type === "BULLISH" && currentPrice < ob.low) {
      return { ...ob, status: "BROKEN" };
    }
    if (ob.type === "BEARISH" && currentPrice > ob.high) {
      return { ...ob, status: "BROKEN" };
    }

    const inZone =
      ob.type === "BULLISH"
        ? currentPrice >= ob.low && currentPrice <= ob.high
        : currentPrice <= ob.high && currentPrice >= ob.low;

    if (inZone) {
      return { ...ob, touched: ob.touched + 1, status: ob.touched >= 2 ? "MITIGATED" : "ACTIVE" };
    }

    return ob;
  });
}

export function buildOrderBlockAnalysis(
  blocks: OrderBlock[],
  currentPrice: number
): OrderBlockAnalysis {
  const active = blocks.filter((b) => b.status === "ACTIVE");
  const bullish = active.filter((b) => b.type === "BULLISH").slice(-5);
  const bearish = active.filter((b) => b.type === "BEARISH").slice(-5);

  const allActive = [...bullish, ...bearish];
  let nearest: OrderBlock | null = null;
  let nearestDistancePct = Infinity;

  for (const ob of allActive) {
    const dist = Math.abs(ob.midpoint - currentPrice) / currentPrice * 100;
    if (dist < nearestDistancePct) {
      nearestDistancePct = dist;
      nearest = ob;
    }
  }

  return {
    bullish,
    bearish,
    nearest,
    nearestDistancePct: parseFloat(nearestDistancePct.toFixed(2)),
  };
}
