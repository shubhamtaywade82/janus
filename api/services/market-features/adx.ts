import type { BinanceKline } from "../binance";
import type { ADXFeature } from "./types";

export function computeADX(klines: BinanceKline[], period: number = 14): ADXFeature {
  const defaultFeature: ADXFeature = {
    value: 0,
    plusDI: 0,
    minusDI: 0,
    trendState: "RANGING",
    direction: "NEUTRAL",
    adxSlope: 0,
  };

  if (klines.length < 2 * period) {
    return defaultFeature;
  }

  const length = klines.length;
  const high = klines.map(k => parseFloat(k.high));
  const low = klines.map(k => parseFloat(k.low));
  const close = klines.map(k => parseFloat(k.close));

  // 1. Calculate TR, +DM, -DM
  const tr: number[] = new Array(length).fill(0);
  const plusDM: number[] = new Array(length).fill(0);
  const minusDM: number[] = new Array(length).fill(0);

  tr[0] = high[0] - low[0];

  for (let i = 1; i < length; i++) {
    const hDiff = high[i] - high[i - 1];
    const lDiff = low[i - 1] - low[i];

    const val1 = high[i] - low[i];
    const val2 = Math.abs(high[i] - close[i - 1]);
    const val3 = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(val1, val2, val3);

    plusDM[i] = (hDiff > lDiff && hDiff > 0) ? hDiff : 0;
    minusDM[i] = (lDiff > hDiff && lDiff > 0) ? lDiff : 0;
  }

  // 2. Wilder's Smoothing for TR, +DM, -DM
  const str: number[] = new Array(length).fill(0);
  const splusDM: number[] = new Array(length).fill(0);
  const sminusDM: number[] = new Array(length).fill(0);

  let trSum = 0;
  let pDmSum = 0;
  let mDmSum = 0;

  for (let i = 0; i < period; i++) {
    trSum += tr[i];
    pDmSum += plusDM[i];
    mDmSum += minusDM[i];
  }

  str[period - 1] = trSum;
  splusDM[period - 1] = pDmSum;
  sminusDM[period - 1] = mDmSum;

  for (let i = period; i < length; i++) {
    str[i] = str[i - 1] - (str[i - 1] / period) + tr[i];
    splusDM[i] = splusDM[i - 1] - (splusDM[i - 1] / period) + plusDM[i];
    sminusDM[i] = sminusDM[i - 1] - (sminusDM[i - 1] / period) + minusDM[i];
  }

  // 3. Calculate +DI, -DI, and DX
  const plusDI: number[] = new Array(length).fill(0);
  const minusDI: number[] = new Array(length).fill(0);
  const dx: number[] = new Array(length).fill(0);

  for (let i = period - 1; i < length; i++) {
    const trVal = str[i];
    if (trVal === 0) {
      plusDI[i] = 0;
      minusDI[i] = 0;
    } else {
      plusDI[i] = 100 * (splusDM[i] / trVal);
      minusDI[i] = 100 * (sminusDM[i] / trVal);
    }

    const diSum = plusDI[i] + minusDI[i];
    const diDiff = Math.abs(plusDI[i] - minusDI[i]);
    dx[i] = diSum === 0 ? 0 : 100 * (diDiff / diSum);
  }

  // 4. Calculate ADX (Wilder's smoothing of DX)
  const adx: number[] = new Array(length).fill(0);
  let dxSum = 0;
  for (let i = period - 1; i < 2 * period - 1; i++) {
    dxSum += dx[i];
  }
  adx[2 * period - 2] = dxSum / period;

  for (let i = 2 * period - 1; i < length; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  const currentValue = adx[length - 1];
  const currentPlusDI = plusDI[length - 1];
  const currentMinusDI = minusDI[length - 1];

  // ADX Slope (over last N periods, e.g., N = 14)
  let adxSlope = 0;
  if (length >= 2 * period + period) {
    const pastADX = adx[length - 1 - period];
    adxSlope = currentValue - pastADX;
  }

  // Determine trend state
  let trendState: ADXFeature["trendState"] = "RANGING";
  if (currentValue > 25) {
    trendState = "STRONG_TREND";
  } else if (currentValue > 20) {
    trendState = "TRENDING";
  } else if (currentValue > 15) {
    trendState = "WEAK_TREND";
  }

  // Determine trend direction
  let direction: ADXFeature["direction"] = "NEUTRAL";
  if (currentPlusDI > currentMinusDI + 2) {
    direction = "BULLISH";
  } else if (currentMinusDI > currentPlusDI + 2) {
    direction = "BEARISH";
  }

  return {
    value: currentValue,
    plusDI: currentPlusDI,
    minusDI: currentMinusDI,
    trendState,
    direction,
    adxSlope,
  };
}
