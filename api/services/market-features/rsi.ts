import type { BinanceKline } from "../binance";
import type { RSIFeature } from "./types";

export function computeRSI(klines: BinanceKline[], period: number = 14): RSIFeature {
  const defaultFeature: RSIFeature = {
    value: 50,
    state: "NEUTRAL",
    slope: 0,
  };

  if (klines.length < period + 1) {
    return defaultFeature;
  }

  const closes = klines.map(k => parseFloat(k.close));
  const length = closes.length;

  const gains: number[] = new Array(length).fill(0);
  const losses: number[] = new Array(length).fill(0);

  for (let i = 1; i < length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gains[i] = diff;
    } else {
      losses[i] = -diff;
    }
  }

  const avgGains: number[] = new Array(length).fill(0);
  const avgLosses: number[] = new Array(length).fill(0);

  // First average is simple average
  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    sumGain += gains[i];
    sumLoss += losses[i];
  }
  avgGains[period] = sumGain / period;
  avgLosses[period] = sumLoss / period;

  // Wilder's smoothing
  for (let i = period + 1; i < length; i++) {
    avgGains[i] = (avgGains[i - 1] * (period - 1) + gains[i]) / period;
    avgLosses[i] = (avgLosses[i - 1] * (period - 1) + losses[i]) / period;
  }

  const rsi: number[] = new Array(length).fill(50);
  for (let i = period; i < length; i++) {
    const avgGain = avgGains[i];
    const avgLoss = avgLosses[i];
    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }

  const currentValue = rsi[length - 1];

  // State
  let state: RSIFeature["state"] = "NEUTRAL";
  if (currentValue >= 70) {
    state = "OVERBOUGHT";
  } else if (currentValue <= 30) {
    state = "OVERSOLD";
  }

  // Slope over last 3 periods
  let slope = 0;
  if (length >= period + 4) {
    slope = currentValue - rsi[length - 4];
  }

  return {
    value: currentValue,
    state,
    slope,
  };
}
