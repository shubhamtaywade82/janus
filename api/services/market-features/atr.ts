import { BinanceKline } from "../binance";
import { ATRFeature } from "./types";

export function computeATR(klines: BinanceKline[], period: number = 14): ATRFeature {
  const defaultFeature: ATRFeature = {
    value: 0,
    percentile100: 50,
    percentile500: 50,
    isExpanding: false,
    isContracting: false,
    state: "NORMAL",
    atrExpansionRate: 1.0,
  };

  if (klines.length < period + 1) {
    return defaultFeature;
  }

  // 1. Calculate True Range (TR) for all klines
  const tr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    const high = parseFloat(klines[i].high);
    const low = parseFloat(klines[i].low);
    if (i === 0) {
      tr.push(high - low);
    } else {
      const prevClose = parseFloat(klines[i - 1].close);
      const val1 = high - low;
      const val2 = Math.abs(high - prevClose);
      const val3 = Math.abs(low - prevClose);
      tr.push(Math.max(val1, val2, val3));
    }
  }

  // 2. Calculate Wilder's ATR series
  const atr: number[] = new Array(klines.length).fill(0);
  
  // First ATR is the simple average of the first 'period' TR values
  let firstSum = 0;
  for (let i = 0; i < period; i++) {
    firstSum += tr[i];
  }
  atr[period - 1] = firstSum / period;

  // Subsequent ATR values use Wilder's smoothing
  for (let i = period; i < klines.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  const currentATR = atr[atr.length - 1];

  // 3. Extract historical ATR values for percentiles
  // We need to slice the atr array to exclude the initial uncalculated zeros (before index period - 1)
  const validAtrs = atr.slice(period - 1);
  if (validAtrs.length === 0) {
    return defaultFeature;
  }

  const last100 = validAtrs.slice(-100);
  const last500 = validAtrs.slice(-500);

  const percentile100 = calculatePercentile(currentATR, last100);
  const percentile500 = calculatePercentile(currentATR, last500);

  // 4. Calculate expansion rate
  // Compare current ATR against ATR N periods ago (e.g. N = period = 14)
  const lookback = period;
  let atrExpansionRate = 1.0;
  if (validAtrs.length > lookback) {
    const pastATR = validAtrs[validAtrs.length - 1 - lookback];
    if (pastATR > 0) {
      atrExpansionRate = currentATR / pastATR;
    }
  }

  // State flags
  const isExpanding = atrExpansionRate > 1.05;
  const isContracting = atrExpansionRate < 0.95;
  let state: ATRFeature["state"] = "NORMAL";
  if (isExpanding) state = "EXPANDING";
  else if (isContracting) state = "CONTRACTING";

  return {
    value: currentATR,
    percentile100,
    percentile500,
    isExpanding,
    isContracting,
    state,
    atrExpansionRate,
  };
}

function calculatePercentile(current: number, history: number[]): number {
  if (history.length <= 1) return 50;
  const count = history.filter((v) => v < current).length;
  return (count / history.length) * 100;
}
