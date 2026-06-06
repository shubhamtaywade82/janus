import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { Candle } from "../../domain/market-data/candle.js";
import type { CvdAnalysis } from "../../domain/analysis/analysis-result.js";

export interface CvdPoint {
  ts: number;
  delta: number;        // buy volume - sell volume for this candle
  cumulative: number;   // running sum
  price: number;
}

/**
 * Cumulative Volume Delta (CVD) Engine
 *
 * CVD tracks the cumulative difference between aggressive buy and sell volume.
 * Key signals:
 *   Price LL + CVD HL → Bullish Divergence (hidden accumulation)
 *   Price HH + CVD LH → Bearish Divergence (hidden distribution)
 *   Price and CVD move together → Confirming
 */
export class CvdEngine {
  private points: CvdPoint[] = [];
  private running = 0;

  onTrade(tick: TradeTick): void {
    const delta = tick.side === "buy" ? tick.quantity : -tick.quantity;
    this.running += delta;

    const last = this.points[this.points.length - 1];
    if (last && tick.ts - last.ts < 60_000) {
      // Same candle (1m) — update in place
      last.delta += delta;
      last.cumulative = this.running;
      last.price = tick.price;
    } else {
      this.points.push({ ts: tick.ts, delta, cumulative: this.running, price: tick.price });
    }

    // Keep only last 500 points
    if (this.points.length > 500) this.points.shift();
  }

  /** Seed CVD from historical OHLCV using close delta (close > open = buy, else sell) */
  seedFromCandles(candles: Candle[]): void {
    this.points = [];
    this.running = 0;
    for (const c of candles) {
      const isBullish = c.close >= c.open;
      const buyVol = isBullish ? c.volume * 0.6 : c.volume * 0.4;
      const sellVol = c.volume - buyVol;
      const delta = buyVol - sellVol;
      this.running += delta;
      this.points.push({ ts: c.openTime, delta, cumulative: this.running, price: c.close });
    }
  }

  analyze(): CvdAnalysis {
    if (this.points.length < 10) {
      return {
        current: this.running,
        sessionDelta: this.running,
        trend: "NEUTRAL",
        signalStrength: "WEAK",
        priceHigherLow: false,
        cvdHigherLow: false,
      };
    }

    const recent = this.points.slice(-20);
    const sessionStart = this.points.length > 100 ? this.points[this.points.length - 100] : this.points[0];

    // Find recent pivot highs/lows in both price and CVD
    const priceValues = recent.map((p) => p.price);
    const cvdValues = recent.map((p) => p.cumulative);

    const priceLow1 = Math.min(...priceValues.slice(0, 10));
    const priceLow2 = Math.min(...priceValues.slice(10));
    const cvdLow1 = Math.min(...cvdValues.slice(0, 10));
    const cvdLow2 = Math.min(...cvdValues.slice(10));

    const priceHigh1 = Math.max(...priceValues.slice(0, 10));
    const priceHigh2 = Math.max(...priceValues.slice(10));
    const cvdHigh1 = Math.max(...cvdValues.slice(0, 10));
    const cvdHigh2 = Math.max(...cvdValues.slice(10));

    const priceHigherLow = priceLow2 > priceLow1;
    const cvdHigherLow = cvdLow2 > cvdLow1;
    const cvdLowerHigh = cvdHigh2 < cvdHigh1;

    let trend: CvdAnalysis["trend"] = "NEUTRAL";
    let signalStrength: CvdAnalysis["signalStrength"] = "WEAK";

    if (priceLow2 < priceLow1 && cvdHigherLow) {
      // Price making lower low, CVD making higher low → bullish divergence
      trend = "BULLISH_DIVERGENCE";
      signalStrength = "STRONG";
    } else if (priceHigh2 > priceHigh1 && cvdLowerHigh) {
      // Price making higher high, CVD making lower high → bearish divergence
      trend = "BEARISH_DIVERGENCE";
      signalStrength = "STRONG";
    } else if (this.running > sessionStart.cumulative) {
      trend = "CONFIRMING";
      signalStrength = "MODERATE";
    }

    return {
      current: this.running,
      sessionDelta: this.running - (sessionStart.cumulative ?? 0),
      trend,
      signalStrength,
      priceHigherLow,
      cvdHigherLow,
    };
  }

  get series(): CvdPoint[] {
    return this.points;
  }
}
