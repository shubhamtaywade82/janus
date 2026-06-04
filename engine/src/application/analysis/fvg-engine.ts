import { nanoid } from "nanoid";
import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type { FairValueGap, FvgAnalysis } from "../../domain/analysis/fvg.js";

/**
 * Fair Value Gap (FVG) / Imbalance Detection
 *
 * Bullish FVG: Occurs in a 3-candle pattern where:
 *   candle[i+1].low > candle[i-1].high
 *   → gap between prev high and next low where no trading occurred
 *   → acts as a magnet for price (typically fills 50-100%)
 *
 * Bearish FVG: candle[i+1].high < candle[i-1].low
 *   → gap on the downside
 *
 * Only candles where the middle is an impulsive move (large body) are considered.
 */
export function detectFVGs(
  candles: Candle[],
  timeframe: CandleInterval,
  minGapPct = 0.001 // minimum gap size relative to price (0.1%)
): FairValueGap[] {
  const fvgs: FairValueGap[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish FVG
    const bullishGapLow = prev.high;
    const bullishGapHigh = next.low;
    if (
      bullishGapHigh > bullishGapLow &&
      (bullishGapHigh - bullishGapLow) / bullishGapLow >= minGapPct &&
      curr.close > curr.open // middle candle is bullish
    ) {
      fvgs.push({
        id: nanoid(),
        type: "BULLISH",
        timeframe,
        low: bullishGapLow,
        high: bullishGapHigh,
        midpoint: (bullishGapLow + bullishGapHigh) / 2,
        ts: curr.openTime,
        filled: false,
        fillPct: 0,
      });
    }

    // Bearish FVG
    const bearishGapHigh = prev.low;
    const bearishGapLow = next.high;
    if (
      bearishGapHigh > bearishGapLow &&
      (bearishGapHigh - bearishGapLow) / bearishGapLow >= minGapPct &&
      curr.close < curr.open // middle candle is bearish
    ) {
      fvgs.push({
        id: nanoid(),
        type: "BEARISH",
        timeframe,
        low: bearishGapLow,
        high: bearishGapHigh,
        midpoint: (bearishGapLow + bearishGapHigh) / 2,
        ts: curr.openTime,
        filled: false,
        fillPct: 0,
      });
    }
  }

  return fvgs;
}

/**
 * Checks whether a FVG has been partially or fully filled by subsequent price action.
 */
export function updateFVGStatus(fvgs: FairValueGap[], currentPrice: number): FairValueGap[] {
  return fvgs.map((fvg) => {
    if (fvg.filled) return fvg;

    // How much of the gap has price penetrated?
    if (fvg.type === "BULLISH") {
      if (currentPrice <= fvg.low) {
        // Fully filled — price came down through the gap
        return { ...fvg, filled: true, fillPct: 100 };
      }
      if (currentPrice < fvg.high) {
        const fillPct = Math.round(((fvg.high - currentPrice) / (fvg.high - fvg.low)) * 100);
        return { ...fvg, fillPct };
      }
    } else {
      if (currentPrice >= fvg.high) {
        return { ...fvg, filled: true, fillPct: 100 };
      }
      if (currentPrice > fvg.low) {
        const fillPct = Math.round(((currentPrice - fvg.low) / (fvg.high - fvg.low)) * 100);
        return { ...fvg, fillPct };
      }
    }
    return fvg;
  });
}

export function buildFvgAnalysis(fvgs: FairValueGap[], currentPrice: number): FvgAnalysis {
  const unfilled = fvgs.filter((f) => !f.filled);
  const bullish = unfilled.filter((f) => f.type === "BULLISH").slice(-5);
  const bearish = unfilled.filter((f) => f.type === "BEARISH").slice(-5);

  let nearest: FairValueGap | null = null;
  let nearestDistancePct = Infinity;

  for (const fvg of [...bullish, ...bearish]) {
    const dist = Math.abs(fvg.midpoint - currentPrice) / currentPrice * 100;
    if (dist < nearestDistancePct) {
      nearestDistancePct = dist;
      nearest = fvg;
    }
  }

  return {
    bullish,
    bearish,
    nearest,
    nearestDistancePct: parseFloat(nearestDistancePct.toFixed(2)),
  };
}
