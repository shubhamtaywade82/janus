import type { BinanceKline } from "../binance";
import type { VolatilityFeature } from "./types";

export function computeVolatility(klines: BinanceKline[], period: number = 20): VolatilityFeature {
  const defaultFeature: VolatilityFeature = {
    value: 0,
    percentile: 50,
    state: "NORMAL",
  };

  if (klines.length < period + 2) {
    return defaultFeature;
  }

  const closes = klines.map(k => parseFloat(k.close));
  const length = closes.length;

  // 1. Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    } else {
      returns.push(0);
    }
  }

  // 2. Calculate rolling standard deviation of returns
  const vols: number[] = [];
  for (let i = period; i <= returns.length; i++) {
    const slice = returns.slice(i - period, i);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    vols.push(Math.sqrt(variance));
  }

  if (vols.length === 0) {
    return defaultFeature;
  }

  const currentValue = vols[vols.length - 1];

  // 3. Calculate percentile of current volatility against history
  const count = vols.filter(v => v < currentValue).length;
  const percentile = (count / vols.length) * 100;

  // 4. Determine state
  let state: VolatilityFeature["state"] = "NORMAL";
  if (percentile < 25) {
    state = "LOW";
  } else if (percentile >= 95) {
    state = "EXTREME";
  } else if (percentile >= 75) {
    state = "HIGH";
  }

  return {
    value: currentValue,
    percentile,
    state,
  };
}
