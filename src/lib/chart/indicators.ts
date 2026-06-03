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

// ─── Ichimoku Cloud ───
export interface IchimokuResult {
  tenkan:  (number | null)[];  // conversion line (9)
  kijun:   (number | null)[];  // base line (26)
  spanA:   (number | null)[];  // leading span A, shifted +26 (index = future bar)
  spanB:   (number | null)[];  // leading span B (52), shifted +26
  chikou:  (number | null)[];  // lagging span: close shifted -26
}

function donchianMid(highs: number[], lows: number[], i: number, period: number): number | null {
  if (i < period - 1) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, highs[j]); lo = Math.min(lo, lows[j]); }
  return (hi + lo) / 2;
}

export function calcIchimoku(
  highs: number[], lows: number[], closes: number[],
  tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52, displacement = 26
): IchimokuResult {
  const n = closes.length;
  const total = n + displacement;  // extend arrays to hold future Span A/B values
  const tenkan: (number | null)[] = new Array(total).fill(null);
  const kijun:  (number | null)[] = new Array(total).fill(null);
  const spanA:  (number | null)[] = new Array(total).fill(null);
  const spanB:  (number | null)[] = new Array(total).fill(null);
  const chikou: (number | null)[] = new Array(total).fill(null);

  for (let i = 0; i < n; i++) {
    tenkan[i] = donchianMid(highs, lows, i, tenkanPeriod);
    kijun[i]  = donchianMid(highs, lows, i, kijunPeriod);
    // Span A/B plotted displacement bars into the future
    if (tenkan[i] !== null && kijun[i] !== null) {
      spanA[i + displacement] = ((tenkan[i] as number) + (kijun[i] as number)) / 2;
    }
    const sB = donchianMid(highs, lows, i, senkouBPeriod);
    if (sB !== null) spanB[i + displacement] = sB;
    // Chikou = close plotted displacement bars in the past
    if (i >= displacement) chikou[i - displacement] = closes[i];
  }

  return { tenkan, kijun, spanA, spanB, chikou };
}

// ─── ADX + DI lines ───
export interface ADXResult {
  adx:    (number | null)[];
  diPlus: (number | null)[];
  diMinus:(number | null)[];
}
export function calcADX(
  highs: number[], lows: number[], closes: number[], period = 14
): ADXResult {
  const n = closes.length;
  const adx:    (number | null)[] = new Array(n).fill(null);
  const diPlus: (number | null)[] = new Array(n).fill(null);
  const diMinus:(number | null)[] = new Array(n).fill(null);
  if (n < period * 2) return { adx, diPlus, diMinus };

  const trArr: number[]  = new Array(n).fill(0);
  const dmPArr: number[] = new Array(n).fill(0);
  const dmMArr: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    trArr[i]  = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    const upMove   = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    dmPArr[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    dmMArr[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  // Wilder smoothing
  let smoothTR = trArr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothDP = dmPArr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothDM = dmMArr.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const getDI = (dp: number, tr: number) => tr === 0 ? 0 : (dp / tr) * 100;
  let adxSmooth = 0;
  const dxArr: number[] = [];

  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + trArr[i];
      smoothDP = smoothDP - smoothDP / period + dmPArr[i];
      smoothDM = smoothDM - smoothDM / period + dmMArr[i];
    }
    const dp = getDI(smoothDP, smoothTR);
    const dm = getDI(smoothDM, smoothTR);
    diPlus[i]  = dp;
    diMinus[i] = dm;
    const dx = dp + dm === 0 ? 0 : Math.abs(dp - dm) / (dp + dm) * 100;
    dxArr.push(dx);

    if (dxArr.length === period) {
      adxSmooth = dxArr.reduce((a, b) => a + b, 0) / period;
      adx[i] = adxSmooth;
    } else if (dxArr.length > period) {
      adxSmooth = (adxSmooth * (period - 1) + dx) / period;
      adx[i] = adxSmooth;
    }
  }

  return { adx, diPlus, diMinus };
}

// ─── Keltner Channels ───
export interface KeltnerResult {
  upper:  (number | null)[];
  middle: (number | null)[];
  lower:  (number | null)[];
}
export function calcKeltner(
  highs: number[], lows: number[], closes: number[],
  emaPeriod = 20, atrPeriod = 10, mult = 2
): KeltnerResult {
  const n = closes.length;
  const middle = calcEMA(closes, emaPeriod);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);

  // ATR (Wilder smoothing)
  const tr: number[] = new Array(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const atr: (number | null)[] = new Array(n).fill(null);
  let atrSum = 0;
  for (let i = 0; i < atrPeriod; i++) atrSum += tr[i];
  let atrVal = atrSum / atrPeriod;
  atr[atrPeriod - 1] = atrVal;
  for (let i = atrPeriod; i < n; i++) {
    atrVal = (atrVal * (atrPeriod - 1) + tr[i]) / atrPeriod;
    atr[i] = atrVal;
  }

  for (let i = 0; i < n; i++) {
    if (middle[i] !== null && atr[i] !== null) {
      upper[i] = (middle[i] as number) + mult * (atr[i] as number);
      lower[i] = (middle[i] as number) - mult * (atr[i] as number);
    }
  }
  return { upper, middle, lower };
}

// ─── Donchian Channels ───
export interface DonchianResult {
  upper:  (number | null)[];
  middle: (number | null)[];
  lower:  (number | null)[];
}
export function calcDonchian(
  highs: number[], lows: number[], period = 20
): DonchianResult {
  const n = highs.length;
  const upper:  (number | null)[] = new Array(n).fill(null);
  const middle: (number | null)[] = new Array(n).fill(null);
  const lower:  (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j]  < lo) lo = lows[j];
    }
    upper[i]  = hi;
    lower[i]  = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, middle, lower };
}

// ─── Z-Score ───
// Measures standard deviations from rolling mean. ±2 = statistically extreme.
export function calcZScore(closes: number[], period = 20): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, v) => a + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    result[i] = std === 0 ? 0 : (closes[i] - mean) / std;
  }
  return result;
}

// ─── Volume Profile ───
export interface VPBucket {
  price:  number;  // midpoint price of bucket
  vol:    number;  // total volume
  buyVol: number;  // estimated buy volume
}
export interface VolumeProfileResult {
  buckets:        VPBucket[];
  maxVol:         number;
  poc:            number;   // price of highest volume bucket
  valueAreaHigh:  number;
  valueAreaLow:   number;
}
export function calcVolumeProfile(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  bucketCount = 48
): VolumeProfileResult | null {
  const n = closes.length;
  if (n === 0) return null;

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  if (priceMax === priceMin) return null;

  const bucketSize = (priceMax - priceMin) / bucketCount;
  const vols    = new Float64Array(bucketCount).fill(0);
  const buyVols = new Float64Array(bucketCount).fill(0);

  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i];
    const buyFrac = range === 0 ? 0.5 : (closes[i] - lows[i]) / range;
    const bv = volumes[i] * buyFrac;
    // Distribute volume across all buckets the candle overlaps, proportionally
    const bLo = Math.max(0, Math.floor((lows[i] - priceMin) / bucketSize));
    const bHi = Math.min(bucketCount - 1, Math.floor((highs[i] - priceMin) / bucketSize));
    const span = bHi - bLo + 1;
    for (let b = bLo; b <= bHi; b++) {
      vols[b]    += volumes[i] / span;
      buyVols[b] += bv / span;
    }
  }

  let maxVol = 0, pocIdx = 0;
  for (let b = 0; b < bucketCount; b++) {
    if (vols[b] > maxVol) { maxVol = vols[b]; pocIdx = b; }
  }

  // Value area: expand from POC until 70% of total volume is enclosed
  const totalVol = Array.from(vols).reduce((a, b) => a + b, 0);
  const vaTarget = totalVol * 0.70;
  let lo = pocIdx, hi = pocIdx, vaVol = vols[pocIdx];
  while (vaVol < vaTarget && (lo > 0 || hi < bucketCount - 1)) {
    const upGain   = hi < bucketCount - 1 ? vols[hi + 1] : 0;
    const downGain = lo > 0               ? vols[lo - 1] : 0;
    if (upGain >= downGain && hi < bucketCount - 1) { hi++; vaVol += vols[hi]; }
    else if (lo > 0) { lo--; vaVol += vols[lo]; }
    else { hi++; vaVol += vols[hi]; }
  }

  const buckets: VPBucket[] = Array.from({ length: bucketCount }, (_, b) => ({
    price:  priceMin + (b + 0.5) * bucketSize,
    vol:    vols[b],
    buyVol: buyVols[b],
  }));

  return {
    buckets,
    maxVol,
    poc:           priceMin + (pocIdx + 0.5) * bucketSize,
    valueAreaHigh: priceMin + (hi + 1) * bucketSize,
    valueAreaLow:  priceMin + lo * bucketSize,
  };
}

// ─── Stochastic RSI ───
export interface StochRSIResult {
  k: (number | null)[];  // smoothed %K
  d: (number | null)[];  // signal %D = SMA(%K, smoothD)
}
export function calcStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3
): StochRSIResult {
  const n = closes.length;
  const rsi = calcRSI(closes, rsiPeriod);

  // Raw StochRSI
  const rawStoch: (number | null)[] = new Array(n).fill(null);
  for (let i = stochPeriod - 1; i < n; i++) {
    const window = rsi.slice(i - stochPeriod + 1, i + 1).filter((v): v is number => v !== null);
    if (window.length < stochPeriod) continue;
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    rawStoch[i] = hi === lo ? 0 : ((rsi[i] as number) - lo) / (hi - lo) * 100;
  }

  // %K = SMA(rawStoch, smoothK)
  const kArr = calcSMA(rawStoch.map((v) => v ?? 0), smoothK);
  const k: (number | null)[] = rawStoch.map((v, i) => v !== null && kArr[i] !== null ? kArr[i] : null);

  // %D = SMA(%K, smoothD)
  const dArr = calcSMA(k.map((v) => v ?? 0), smoothD);
  const d: (number | null)[] = k.map((v, i) => v !== null && dArr[i] !== null ? dArr[i] : null);

  return { k, d };
}

// ─── MACD ───
export interface MACDResult {
  macd:      (number | null)[];  // fast EMA - slow EMA
  signal:    (number | null)[];  // EMA(macd, signalPeriod)
  histogram: (number | null)[];  // macd - signal
}
export function calcMACD(
  closes: number[],
  fast = 12, slow = 26, signal = 9
): MACDResult {
  const fastEMA = calcEMA(closes, fast);
  const slowEMA = calcEMA(closes, slow);
  const n = closes.length;

  const macd:      (number | null)[] = new Array(n).fill(null);
  const signalArr: (number | null)[] = new Array(n).fill(null);
  const histogram: (number | null)[] = new Array(n).fill(null);

  // MACD line — valid only where both EMAs have values
  for (let i = 0; i < n; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macd[i] = (fastEMA[i] as number) - (slowEMA[i] as number);
    }
  }

  // Signal line = EMA of MACD values; compute using only non-null values in order
  const macdNonNull = macd.map((v, i) => ({ v, i })).filter((x) => x.v !== null);
  if (macdNonNull.length >= signal) {
    const k = 2 / (signal + 1);
    let ema = macdNonNull.slice(0, signal).reduce((s, x) => s + (x.v as number), 0) / signal;
    signalArr[macdNonNull[signal - 1].i] = ema;
    for (let j = signal; j < macdNonNull.length; j++) {
      ema = (macdNonNull[j].v as number) * k + ema * (1 - k);
      signalArr[macdNonNull[j].i] = ema;
    }
  }

  // Histogram
  for (let i = 0; i < n; i++) {
    if (macd[i] !== null && signalArr[i] !== null) {
      histogram[i] = (macd[i] as number) - (signalArr[i] as number);
    }
  }

  return { macd, signal: signalArr, histogram };
}

// ─── Parabolic SAR ───
// Returns SAR values per bar (null during warmup). Direction: "up" = bullish (SAR below price).
export interface PSARResult {
  values:    (number | null)[];
  direction: ("up" | "down" | null)[];
}
export function calcPSAR(
  highs: number[], lows: number[], closes: number[],
  step = 0.02, max = 0.2
): PSARResult {
  const n = closes.length;
  const values:    (number | null)[] = new Array(n).fill(null);
  const direction: ("up" | "down" | null)[] = new Array(n).fill(null);
  if (n < 2) return { values, direction };

  let bull = closes[1] > closes[0];
  let sar  = bull ? lows[0]  : highs[0];
  let ep   = bull ? highs[0] : lows[0];
  let af   = step;

  for (let i = 1; i < n; i++) {
    // Advance SAR
    let nextSar = sar + af * (ep - sar);

    if (bull) {
      nextSar = Math.min(nextSar, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < nextSar) {
        // Flip to bearish
        bull = false; nextSar = ep; ep = lows[i]; af = step;
      } else {
        if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max); }
      }
    } else {
      nextSar = Math.max(nextSar, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > nextSar) {
        // Flip to bullish
        bull = true; nextSar = ep; ep = highs[i]; af = step;
      } else {
        if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, max); }
      }
    }

    sar = nextSar;
    values[i]    = sar;
    direction[i] = bull ? "up" : "down";
  }

  return { values, direction };
}

// ─── Nadaraya-Watson Envelope ───
// Non-parametric kernel regression using Gaussian weights.
// h (bandwidth) controls smoothness; mult scales the MAE bands.
// Lookback limits computation window — full O(n²) only over last `lookback` bars.
export interface NWResult {
  estimate: (number | null)[];
  upper:    (number | null)[];
  lower:    (number | null)[];
}
export function calcNW(
  closes: number[],
  h = 8,
  mult = 3,
  lookback = 300
): NWResult {
  const n = closes.length;
  const estimate: (number | null)[] = new Array(n).fill(null);
  const upper:    (number | null)[] = new Array(n).fill(null);
  const lower:    (number | null)[] = new Array(n).fill(null);

  const start = Math.max(0, n - lookback);

  // Compute kernel estimate for each bar within lookback window
  for (let i = start; i < n; i++) {
    let wSum = 0, wySum = 0;
    for (let j = start; j < n; j++) {
      const w = Math.exp(-((i - j) ** 2) / (2 * h * h));
      wSum  += w;
      wySum += w * closes[j];
    }
    estimate[i] = wSum > 0 ? wySum / wSum : null;
  }

  // MAE over the lookback window
  let absErrSum = 0, count = 0;
  for (let i = start; i < n; i++) {
    if (estimate[i] !== null) {
      absErrSum += Math.abs(closes[i] - (estimate[i] as number));
      count++;
    }
  }
  const mae = count > 0 ? (absErrSum / count) * mult : 0;

  for (let i = start; i < n; i++) {
    if (estimate[i] !== null) {
      upper[i] = (estimate[i] as number) + mae;
      lower[i] = (estimate[i] as number) - mae;
    }
  }

  return { estimate, upper, lower };
}

// ─── CVD (Cumulative Volume Delta) ───
// Delta per bar = estimated buy vol - sell vol using candle body position within wick.
// Formula: delta = volume × (2 × (close - low) / (high - low) - 1)  [ranges -vol..+vol]
// Edge case: high === low (doji) → delta = 0
export interface CVDResult {
  delta: (number | null)[];  // per-bar delta (histogram)
  cvd:   (number | null)[];  // running cumulative delta (line)
}
export function calcCVD(
  highs: number[], lows: number[], closes: number[], volumes: number[]
): CVDResult {
  const n = closes.length;
  const delta: (number | null)[] = new Array(n).fill(null);
  const cvd:   (number | null)[] = new Array(n).fill(null);
  let running = 0;

  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i];
    const d = range === 0 ? 0 : volumes[i] * (2 * (closes[i] - lows[i]) / range - 1);
    running += d;
    delta[i] = d;
    cvd[i]   = running;
  }
  return { delta, cvd };
}

// ─── VWAP + bands (session, resets at midnight UTC) ───
export interface VWAPResult {
  vwap:   (number | null)[];
  upper1: (number | null)[];  // +1σ
  lower1: (number | null)[];  // -1σ
  upper2: (number | null)[];  // +2σ
  lower2: (number | null)[];  // -2σ
}
export function calcVWAP(
  times: number[], highs: number[], lows: number[], closes: number[], volumes: number[]
): VWAPResult {
  const n = closes.length;
  const vwap:   (number | null)[] = new Array(n).fill(null);
  const upper1: (number | null)[] = new Array(n).fill(null);
  const lower1: (number | null)[] = new Array(n).fill(null);
  const upper2: (number | null)[] = new Array(n).fill(null);
  const lower2: (number | null)[] = new Array(n).fill(null);

  let tpvSum = 0, tp2vSum = 0, volSum = 0, lastDate = -1;

  for (let i = 0; i < n; i++) {
    const dayMs = Math.floor(times[i] / 86_400_000);
    if (dayMs !== lastDate) { tpvSum = 0; tp2vSum = 0; volSum = 0; lastDate = dayMs; }
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpvSum  += tp * volumes[i];
    tp2vSum += tp * tp * volumes[i];
    volSum  += volumes[i];
    if (volSum > 0) {
      const v  = tpvSum / volSum;
      const variance = Math.max(0, tp2vSum / volSum - v * v);
      const std = Math.sqrt(variance);
      vwap[i]   = v;
      upper1[i] = v + std;
      lower1[i] = v - std;
      upper2[i] = v + 2 * std;
      lower2[i] = v - 2 * std;
    }
  }
  return { vwap, upper1, lower1, upper2, lower2 };
}
