import type { BinanceKline } from "../binance";
import type { EMAFeature } from "./types";

export function computeEMA(klines: BinanceKline[]): EMAFeature {
  const defaultFeature: EMAFeature = {
    ema20: 0,
    ema50: 0,
    ema200: 0,
    crossover: "NONE",
    alignment: "NEUTRAL",
    distanceVsEma200Pct: 0,
    kaufmanEfficiencyRatio: 0.5,
    choppinessIndex: 50,
    verticalHorizontalFilter: 0.5,
    rollingRegressionSlope: 0,
  };

  if (klines.length < 200) {
    return defaultFeature;
  }

  const closes = klines.map(k => parseFloat(k.close));
  const highs = klines.map(k => parseFloat(k.high));
  const lows = klines.map(k => parseFloat(k.low));
  const length = closes.length;

  // 1. Calculate EMAs
  const ema20Series = calculateEMASeries(closes, 20);
  const ema50Series = calculateEMASeries(closes, 50);
  const ema200Series = calculateEMASeries(closes, 200);

  const curEma20 = ema20Series[length - 1];
  const curEma50 = ema50Series[length - 1];
  const curEma200 = ema200Series[length - 1];

  const prevEma20 = ema20Series[length - 2];
  const prevEma50 = ema50Series[length - 2];

  // 2. Crossover State
  let crossover: EMAFeature["crossover"] = "NONE";
  if (prevEma20 <= prevEma50 && curEma20 > curEma50) {
    crossover = "BULLISH";
  } else if (prevEma20 >= prevEma50 && curEma20 < curEma50) {
    crossover = "BEARISH";
  }

  // 3. Alignment State
  let alignment: EMAFeature["alignment"] = "NEUTRAL";
  if (curEma20 > curEma50 && curEma50 > curEma200) {
    alignment = "BULLISH";
  } else if (curEma20 < curEma50 && curEma50 < curEma200) {
    alignment = "BEARISH";
  }

  // 4. Distance vs EMA200 %
  const currentClose = closes[length - 1];
  const distanceVsEma200Pct = curEma200 !== 0 ? ((currentClose - curEma200) / curEma200) * 100 : 0;

  // 5. Kaufman Efficiency Ratio (KER) - Period 10
  const kerPeriod = 10;
  let kaufmanEfficiencyRatio = 0.5;
  if (length >= kerPeriod + 1) {
    const change = Math.abs(closes[length - 1] - closes[length - 1 - kerPeriod]);
    let volatility = 0;
    for (let i = length - kerPeriod; i < length; i++) {
      volatility += Math.abs(closes[i] - closes[i - 1]);
    }
    kaufmanEfficiencyRatio = volatility !== 0 ? change / volatility : 0;
  }

  // 6. Choppiness Index - Period 14
  const chopPeriod = 14;
  let choppinessIndex = 50;
  if (length >= chopPeriod + 1) {
    // Sum of True Range over last 14 periods
    let sumTR = 0;
    let maxHigh = highs[length - 1];
    let minLow = lows[length - 1];

    for (let i = length - chopPeriod; i < length; i++) {
      // TR calculation
      const val1 = highs[i] - lows[i];
      const val2 = Math.abs(highs[i] - closes[i - 1]);
      const val3 = Math.abs(lows[i] - closes[i - 1]);
      sumTR += Math.max(val1, val2, val3);

      if (highs[i] > maxHigh) maxHigh = highs[i];
      if (lows[i] < minLow) minLow = lows[i];
    }

    const range = maxHigh - minLow;
    if (range > 0 && sumTR > 0) {
      choppinessIndex = 100 * (Math.log10(sumTR / range) / Math.log10(chopPeriod));
    }
  }

  // 7. Vertical Horizontal Filter (VHF) - Period 28
  const vhfPeriod = 28;
  let verticalHorizontalFilter = 0.5;
  if (length >= vhfPeriod + 1) {
    let maxClose = closes[length - 1];
    let minClose = closes[length - 1];
    let sumDiff = 0;

    for (let i = length - vhfPeriod; i < length; i++) {
      if (closes[i] > maxClose) maxClose = closes[i];
      if (closes[i] < minClose) minClose = closes[i];
      sumDiff += Math.abs(closes[i] - closes[i - 1]);
    }

    const numerator = Math.abs(maxClose - minClose);
    verticalHorizontalFilter = sumDiff !== 0 ? numerator / sumDiff : 0;
  }

  // 8. Rolling Regression Slope - Period 20
  const regressionPeriod = 20;
  let rollingRegressionSlope = 0;
  if (length >= regressionPeriod) {
    const N = regressionPeriod;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < N; i++) {
      const x = i;
      const y = closes[length - N + i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denominator = N * sumXX - sumX * sumX;
    rollingRegressionSlope = denominator !== 0 ? (N * sumXY - sumX * sumY) / denominator : 0;
  }

  return {
    ema20: curEma20,
    ema50: curEma50,
    ema200: curEma200,
    crossover,
    alignment,
    distanceVsEma200Pct,
    kaufmanEfficiencyRatio,
    choppinessIndex,
    verticalHorizontalFilter,
    rollingRegressionSlope,
  };
}

function calculateEMASeries(values: number[], period: number): number[] {
  const ema: number[] = new Array(values.length).fill(0);
  if (values.length === 0) return ema;

  ema[0] = values[0];
  const k = 2 / (period + 1);

  for (let i = 1; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}
