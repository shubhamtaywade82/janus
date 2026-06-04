/**
 * KNN SuperTrend Indicator
 *
 * Hybrid: SuperTrend (ATR-based trend backbone) + KNN (ML quality filter).
 *
 * Flow:
 *   OHLCV → ATR → SuperTrend bands → Feature vectors → KNN labels →
 *   KNN classification → Rejection orb → Regime → Trade state snapshot
 *
 * Key invariants:
 *   - KNN is a FILTER, not an entry engine. Never generate trades directly.
 *   - Labels use future-return threshold to avoid noisy candle direction labels.
 *   - Regime "range" always suppresses entry (confidence irrelevant).
 *   - ST and KNN must agree for entryAllowed = true.
 */

export type KnnBias = "bullish" | "bearish" | "neutral";
export type MarketRegime = "trend" | "weak_trend" | "range" | "transition";

export interface SupertrendState {
  direction: "bullish" | "bearish";
  level: number;
  flip: boolean;
}

export interface KnnState {
  bias: KnnBias;
  confidence: number;   // 0-100
  neighbors: number;    // k used
  agreement: number;    // neighbors matching bias
}

export interface RejectionSignal {
  signal: boolean;
  type: "bullish_rejection" | "bearish_rejection" | null;
  wickToBody: number;
  volumeScore: number;
}

export interface KnnSupertrendSnapshot {
  symbol: string;
  timeframe: string;
  timestamp: number;
  price: number;
  supertrend: SupertrendState;
  knn: KnnState;
  rejection: RejectionSignal;
  regime: MarketRegime;
  entryAllowed: boolean;
  stopLoss: number | null;
  takeProfit: number | null;
  trailStop: number | null;
  setupQuality: "high" | "medium" | "low";
  note: string;
}

// Shared in-memory cache — updated by signal router, read by auto-executor and tRPC queries
export const knnSnapshotCache = new Map<string, KnnSupertrendSnapshot>();

// ── ATR (Wilder's smoothing / RMA) ──────────────────────────────────────────
function calcATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const n = highs.length;
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
  }

  const atr: number[] = [];
  // First value: simple average of first `period` TRs
  let rma = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Pad with NaN for bars before the first ATR value
  for (let i = 0; i < period - 1; i++) atr.push(NaN);
  atr.push(rma);
  // Wilder smoothing: rma = (rma*(period-1) + tr) / period
  for (let i = period; i < n; i++) {
    rma = (rma * (period - 1) + tr[i]) / period;
    atr.push(rma);
  }
  return atr;
}

// ── SuperTrend ───────────────────────────────────────────────────────────────
interface STBar { direction: "bullish" | "bearish"; level: number; }

function calcSupertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  atrPeriod: number,
  mult: number
): STBar[] {
  const n = closes.length;
  const atr = calcATR(highs, lows, closes, atrPeriod);
  const result: STBar[] = [];

  let upperBand = 0;
  let lowerBand = 0;
  let direction: "bullish" | "bearish" = "bullish";

  for (let i = 0; i < n; i++) {
    if (isNaN(atr[i])) {
      result.push({ direction: "bullish", level: lows[i] });
      continue;
    }
    const hl2 = (highs[i] + lows[i]) / 2;
    const rawUpper = hl2 + mult * atr[i];
    const rawLower = hl2 - mult * atr[i];

    if (i === 0 || isNaN(atr[i - 1])) {
      upperBand = rawUpper;
      lowerBand = rawLower;
    } else {
      // Upper band can only move down (tighten) or stay; lower band can only move up
      upperBand = rawUpper < upperBand || closes[i - 1] > upperBand ? rawUpper : upperBand;
      lowerBand = rawLower > lowerBand || closes[i - 1] < lowerBand ? rawLower : lowerBand;
    }

    if (i === 0) {
      direction = closes[i] >= hl2 ? "bullish" : "bearish";
    } else {
      if (direction === "bullish" && closes[i] < lowerBand) direction = "bearish";
      else if (direction === "bearish" && closes[i] > upperBand) direction = "bullish";
    }

    result.push({ direction, level: direction === "bullish" ? lowerBand : upperBand });
  }
  return result;
}

// ── Technical helpers ────────────────────────────────────────────────────────
function calcRSI(closes: number[], period: number): number[] {
  const n = closes.length;
  const out: number[] = new Array(Math.min(period, n)).fill(50);
  if (n <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return closes.slice();
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = new Array(period - 1).fill(ema);
  out.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcADX(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const n = closes.length;
  const out: number[] = new Array(Math.min(period * 2, n)).fill(20);
  if (n < period * 2) return out;

  let sPlusDM = 0, sMinusDM = 0, sTR = 0;
  for (let i = 1; i <= period; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    sPlusDM += up > dn && up > 0 ? up : 0;
    sMinusDM += dn > up && dn > 0 ? dn : 0;
    sTR += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  let prevDX = 20;
  for (let i = period + 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    sPlusDM = sPlusDM - sPlusDM / period + (up > dn && up > 0 ? up : 0);
    sMinusDM = sMinusDM - sMinusDM / period + (dn > up && dn > 0 ? dn : 0);
    sTR = sTR - sTR / period + tr;
    if (sTR < 0.0001) { out.push(prevDX); continue; }
    const pDI = (sPlusDM / sTR) * 100;
    const mDI = (sMinusDM / sTR) * 100;
    const dx = Math.abs(pDI - mDI) / (pDI + mDI + 0.001) * 100;
    const adx = (prevDX * (period - 1) + dx) / period;
    out.push(adx);
    prevDX = adx;
  }
  return out;
}

// ── Feature vector ────────────────────────────────────────────────────────────
interface FV {
  rsiN: number;       // RSI/100 → [0,1]
  atrPct: number;     // ATR/close
  stDist: number;     // (close - stLevel)/close
  volRatio: number;   // vol / avg_vol(20), capped 3
  clv: number;        // close location value [0,1]
  wickBody: number;   // totalWick/body, capped 5
  emaSlope: number;   // (ema20[i]-ema20[i-5])/ema20[i-5]
  adxN: number;       // ADX/100
}

const FV_WEIGHTS: FV = {
  rsiN: 1.5, atrPct: 1.0, stDist: 2.0, volRatio: 0.8,
  clv: 0.8, wickBody: 0.5, emaSlope: 1.2, adxN: 1.0,
};

function buildFV(
  i: number,
  closes: number[], highs: number[], lows: number[], volumes: number[],
  rsi: number[], atr: number[], st: STBar[], ema20: number[], adx: number[]
): FV {
  const close = closes[i];
  const high = highs[i];
  const low = lows[i];
  const vol = volumes[i];

  const rsiN = (rsi[i] ?? 50) / 100;
  const atrPct = close > 0 && !isNaN(atr[i]) ? atr[i] / close : 0.01;
  const stDist = close > 0 ? (close - (st[i]?.level ?? close)) / close : 0;

  const volSlice = volumes.slice(Math.max(0, i - 19), i + 1);
  const avgVol = volSlice.reduce((a, b) => a + b, 0) / (volSlice.length || 1);
  const volRatio = avgVol > 0 ? Math.min(3, vol / avgVol) : 1;

  const range = high - low;
  const clv = range > 0 ? (close - low) / range : 0.5;

  const prevClose = i > 0 ? closes[i - 1] : close;
  const body = Math.abs(close - prevClose);
  const uWick = high - Math.max(close, prevClose);
  const lWick = Math.min(close, prevClose) - low;
  const wickBody = body > 0 ? Math.min(5, (uWick + lWick) / body) : 1;

  const ema5Back = ema20[Math.max(0, i - 5)] ?? (ema20[i] ?? close);
  const emaSlope = ema5Back > 0 ? ((ema20[i] ?? close) - ema5Back) / ema5Back : 0;

  const adxN = Math.min(1, (adx[i] ?? 20) / 100);

  return { rsiN, atrPct, stDist, volRatio, clv, wickBody, emaSlope, adxN };
}

function euclidean(a: FV, b: FV): number {
  let sum = 0;
  for (const key of Object.keys(FV_WEIGHTS) as (keyof FV)[]) {
    const w = FV_WEIGHTS[key];
    sum += w * (a[key] - b[key]) ** 2;
  }
  return Math.sqrt(sum);
}

// ── Rejection orb ─────────────────────────────────────────────────────────────
function detectRejection(
  i: number,
  closes: number[], highs: number[], lows: number[], volumes: number[],
  st: STBar[], lastOrbIdx: number
): RejectionSignal {
  const nullOrb: RejectionSignal = { signal: false, type: null, wickToBody: 0, volumeScore: 1 };

  if (i < 5 || i - lastOrbIdx < 5) return nullOrb;

  const close = closes[i];
  const high = highs[i];
  const low = lows[i];
  const prevClose = closes[i - 1];
  const stLevel = st[i]?.level ?? close;
  const stDir = st[i]?.direction ?? "bullish";

  const body = Math.abs(close - prevClose);
  const uWick = high - Math.max(close, prevClose);
  const lWick = Math.min(close, prevClose) - low;
  const wickToBody = body > 0 ? (uWick + lWick) / body : 0;

  const volSlice = volumes.slice(Math.max(0, i - 9), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : volumes[i];
  const volumeScore = avgVol > 0 ? volumes[i] / avgVol : 1;

  const nearST = close > 0 && Math.abs(close - stLevel) / close < 0.015;
  const wickOk = wickToBody >= 2.0;
  const volOk = volumeScore >= 1.3;

  if (stDir === "bullish" && wickOk && volOk && (nearST || low < stLevel)) {
    return { signal: true, type: "bullish_rejection", wickToBody, volumeScore };
  }
  if (stDir === "bearish" && wickOk && volOk && (nearST || high > stLevel)) {
    return { signal: true, type: "bearish_rejection", wickToBody, volumeScore };
  }
  return { signal: false, type: null, wickToBody, volumeScore };
}

// ── Regime classifier ─────────────────────────────────────────────────────────
function classifyRegime(adx: number, confidence: number, stDir: "bullish" | "bearish", knnBias: KnnBias): MarketRegime {
  const agree = stDir === knnBias;
  if (adx >= 25 && confidence >= 70 && agree) return "trend";
  if (adx >= 20 && confidence >= 55 && agree) return "weak_trend";
  if (adx < 18 || confidence < 50) return "range";
  return "transition";
}

// ── Public API ────────────────────────────────────────────────────────────────
export interface KnnSupertrendOpts {
  k?: number;
  atrPeriod?: number;
  multiplier?: number;
  futureBars?: number;
  labelPct?: number;
  lookback?: number;
}

export function computeKnnSupertrend(
  symbol: string,
  timeframe: string,
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  opts: KnnSupertrendOpts = {}
): KnnSupertrendSnapshot {
  const {
    k = 5,
    atrPeriod = 10,
    multiplier = 3.0,
    futureBars = 3,
    labelPct = 0.005,
    lookback = 100,
  } = opts;

  const n = closes.length;
  const price = closes[n - 1] ?? 0;

  const fallback = (note: string): KnnSupertrendSnapshot => ({
    symbol, timeframe, timestamp: Date.now(), price,
    supertrend: { direction: "bullish", level: price, flip: false },
    knn: { bias: "neutral", confidence: 50, neighbors: k, agreement: 0 },
    rejection: { signal: false, type: null, wickToBody: 0, volumeScore: 1 },
    regime: "range", entryAllowed: false,
    stopLoss: null, takeProfit: null, trailStop: null,
    setupQuality: "low", note,
  });

  if (n < atrPeriod + futureBars + 10) return fallback("Insufficient data.");

  const atr = calcATR(highs, lows, closes, atrPeriod);
  const st = calcSupertrend(highs, lows, closes, atrPeriod, multiplier);
  const rsi = calcRSI(closes, 14);
  const ema20 = calcEMA(closes, 20);
  const adxArr = calcADX(highs, lows, closes, 14);

  // Build labeled training samples from historical bars
  const trainStart = Math.max(20, n - lookback);
  const trainEnd = n - futureBars - 1;

  type Sample = { fv: FV; label: KnnBias };
  const samples: Sample[] = [];
  let lastOrbIdx = -10;

  for (let i = trainStart; i <= trainEnd; i++) {
    const c = closes[i];
    const fc = closes[i + futureBars];
    if (!c || !fc) continue;
    const ret = (fc - c) / c;
    const label: KnnBias = ret > labelPct ? "bullish" : ret < -labelPct ? "bearish" : "neutral";
    if (label === "neutral") continue; // neutral bars dilute the vote

    const fv = buildFV(i, closes, highs, lows, volumes, rsi, atr, st, ema20, adxArr);
    samples.push({ fv, label });

    const orb = detectRejection(i, closes, highs, lows, volumes, st, lastOrbIdx);
    if (orb.signal) lastOrbIdx = i;
  }

  // Classify current bar
  const cur = n - 1;
  const curFV = buildFV(cur, closes, highs, lows, volumes, rsi, atr, st, ema20, adxArr);
  const curST = st[cur];
  const prevST = cur > 0 ? st[cur - 1] : curST;
  const flip = curST?.direction !== prevST?.direction;

  let knnBias: KnnBias = "neutral";
  let agreement = 0;

  if (samples.length >= k) {
    const ranked = samples
      .map((s) => ({ label: s.label, d: euclidean(curFV, s.fv) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);

    const votes: Record<KnnBias, number> = { bullish: 0, bearish: 0, neutral: 0 };
    for (const r of ranked) votes[r.label]++;

    let max = 0;
    for (const [bias, count] of Object.entries(votes) as [KnnBias, number][]) {
      if (count > max) { max = count; knnBias = bias; }
    }
    agreement = max;
  }

  const confidence = samples.length >= k ? Math.round((agreement / k) * 100) : 50;
  const rejection = detectRejection(cur, closes, highs, lows, volumes, st, lastOrbIdx);

  const currentADX = adxArr[cur] ?? 20;
  const stDir = curST?.direction ?? "bullish";
  const regime = classifyRegime(currentADX, confidence, stDir, knnBias);

  const stAgrees = stDir === knnBias;
  const entryAllowed = regime !== "range" && confidence >= 60 && stAgrees && knnBias !== "neutral";

  const currentATR = !isNaN(atr[cur]) ? atr[cur] : price * 0.01;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let trailStop: number | null = null;

  if (entryAllowed && curST) {
    if (knnBias === "bullish") {
      stopLoss = parseFloat(Math.min(curST.level, price - 1.5 * currentATR).toFixed(6));
      takeProfit = parseFloat((price + 3.0 * currentATR).toFixed(6));
      trailStop = parseFloat((price - 2.0 * currentATR).toFixed(6));
    } else {
      stopLoss = parseFloat(Math.max(curST.level, price + 1.5 * currentATR).toFixed(6));
      takeProfit = parseFloat((price - 3.0 * currentATR).toFixed(6));
      trailStop = parseFloat((price + 2.0 * currentATR).toFixed(6));
    }
  }

  const setupQuality: "high" | "medium" | "low" =
    confidence >= 75 && stAgrees && regime === "trend" ? "high" :
    confidence >= 55 && stAgrees ? "medium" : "low";

  const note =
    regime === "range" ? "Choppy regime. Signals suppressed." :
    !stAgrees ? `ST ${stDir} vs KNN ${knnBias} — conflict, no entry.` :
    flip ? `Trend flipped ${stDir}. KNN ${knnBias} (${confidence}%).` :
    confidence < 60 ? "Low KNN confidence. Await clearer conditions." :
    setupQuality === "high" ? `High-confidence ${knnBias} trend continuation.` :
    `${knnBias.charAt(0).toUpperCase() + knnBias.slice(1)} bias. Confidence: ${confidence}%.`;

  const snapshot: KnnSupertrendSnapshot = {
    symbol, timeframe, timestamp: Date.now(), price,
    supertrend: { direction: stDir, level: parseFloat((curST?.level ?? price).toFixed(6)), flip },
    knn: { bias: knnBias, confidence, neighbors: k, agreement },
    rejection,
    regime,
    entryAllowed,
    stopLoss,
    takeProfit,
    trailStop,
    setupQuality,
    note,
  };

  knnSnapshotCache.set(symbol, snapshot);
  return snapshot;
}
