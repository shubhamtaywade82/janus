/**
 * Technical indicator computations — pure client-side functions.
 * All functions accept arrays of numbers and return (number | null)[] aligned
 * with the input index (null where insufficient lookback data exists).
 */

// ─── EMA ───
export function calcEMA(closes: number[], period: number): (number | null)[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(closes.length).fill(null);

  // Seed with SMA of first `period` values
  if (closes.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let ema = sum / period;
  result[period - 1] = ema;

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// ─── SMA ───
export function calcSMA(closes: number[], period: number): (number | null)[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => null);
  const result: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

// ─── Bollinger Bands ───
export interface BBResult {
  upper:  (number | null)[];
  middle: (number | null)[];
  lower:  (number | null)[];
}
export function calcBB(closes: number[], period = 20, mult = 2): BBResult {
  const middle = calcSMA(closes, period);
  const upper:  (number | null)[] = new Array(closes.length).fill(null);
  const lower:  (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean  = middle[i] as number;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { upper, middle, lower };
}

// ─── SuperTrend ───
export interface SuperTrendResult {
  values:    (number | null)[];
  direction: ("up" | "down" | null)[];  // "up" = bullish (price above), "down" = bearish
}
export function calcSuperTrend(
  highs: number[], lows: number[], closes: number[],
  period = 10, mult = 3
): SuperTrendResult {
  const len = closes.length;
  const values:    (number | null)[] = new Array(len).fill(null);
  const direction: ("up" | "down" | null)[] = new Array(len).fill(null);

  if (len < period + 1) return { values, direction };

  // ATR (Wilder smoothing)
  const tr: number[] = new Array(len).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < len; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  const atr: number[] = new Array(len).fill(0);
  let atrSum = 0;
  for (let i = 0; i < period; i++) atrSum += tr[i];
  atr[period - 1] = atrSum / period;
  for (let i = period; i < len; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  const upperBand: number[] = new Array(len).fill(0);
  const lowerBand: number[] = new Array(len).fill(0);
  const superTrend: number[] = new Array(len).fill(0);
  const inUpTrend: boolean[] = new Array(len).fill(true);

  for (let i = period; i < len; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    const rawUpper = hl2 + mult * atr[i];
    const rawLower = hl2 - mult * atr[i];

    upperBand[i] = (i > period && rawUpper < upperBand[i - 1]) || closes[i - 1] > upperBand[i - 1] ? rawUpper : upperBand[i - 1];
    lowerBand[i] = (i > period && rawLower > lowerBand[i - 1]) || closes[i - 1] < lowerBand[i - 1] ? rawLower : lowerBand[i - 1];

    if (i === period) {
      inUpTrend[i] = true;
    } else if (superTrend[i - 1] === upperBand[i - 1]) {
      inUpTrend[i] = closes[i] > upperBand[i];
    } else {
      inUpTrend[i] = closes[i] >= lowerBand[i];
    }

    superTrend[i] = inUpTrend[i] ? lowerBand[i] : upperBand[i];
    values[i]    = superTrend[i];
    direction[i] = inUpTrend[i] ? "up" : "down";
  }

  return { values, direction };
}

// ─── RSI ───
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0,  change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ─── VWAP (session, resets at midnight UTC) ───
export function calcVWAP(
  times: number[], highs: number[], lows: number[], closes: number[], volumes: number[]
): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  let tpvSum = 0, volSum = 0, lastDate = -1;

  for (let i = 0; i < closes.length; i++) {
    const dayMs  = Math.floor(times[i] / 86_400_000);
    if (dayMs !== lastDate) { tpvSum = 0; volSum = 0; lastDate = dayMs; }
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpvSum += tp * volumes[i];
    volSum += volumes[i];
    result[i] = volSum > 0 ? tpvSum / volSum : null;
  }
  return result;
}
