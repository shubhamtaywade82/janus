export interface AdaptiveCandle {
  i: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

export interface AdaptiveSupertrendParams {
  atrPeriod: number;
  erLength: number;
  smoothLength: number;
  minFactor: number;
  maxFactor: number;
}

export interface AdaptiveSignal {
  i: number;
  type: "long" | "short";
  price: number;
}

export interface AdaptiveEngineStats {
  winRate: string;
  finalReturn: string;
  totalTrades: number;
  maxDD: string;
}

export interface AdaptiveEngineResult {
  atr: number[];
  er: number[];
  smoothedFactor: number[];
  stLine: number[];
  direction: number[];
  signals: AdaptiveSignal[];
  equityCurve: number[];
  stats: AdaptiveEngineStats;
}

export function klinesToAdaptiveCandles(
  klines: { open: string; high: string; low: string; close: string; volume: string }[]
): AdaptiveCandle[] {
  return klines.map((k, i) => ({
    i,
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    vol: parseFloat(k.volume),
  }));
}

function computeATR(candles: AdaptiveCandle[], period: number): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });

  const atr = new Array<number>(candles.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function computeER(candles: AdaptiveCandle[], length: number): number[] {
  return candles.map((_, i) => {
    if (i < length) return 0;
    const net = Math.abs(candles[i].close - candles[i - length].close);
    let path = 0;
    for (let j = i - length + 1; j <= i; j++) {
      path += Math.abs(candles[j].close - candles[j - 1].close);
    }
    return path > 0 ? net / path : 0;
  });
}

function smoothEMA(arr: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(arr.length).fill(NaN);
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) continue;
    if (Number.isNaN(out[i - 1])) {
      out[i] = arr[i];
      continue;
    }
    out[i] = arr[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function computeAdaptiveSupertrend(
  candles: AdaptiveCandle[],
  atr: number[],
  smoothedFactor: number[]
): { stLine: number[]; direction: number[] } {
  const n = candles.length;
  const stLine = new Array<number>(n).fill(NaN);
  const direction = new Array<number>(n).fill(1);
  let fLower = NaN;
  let fUpper = NaN;

  for (let i = 1; i < n; i++) {
    if (Number.isNaN(atr[i]) || Number.isNaN(smoothedFactor[i])) continue;

    const mid = (candles[i].high + candles[i].low) / 2;
    const bLower = mid - smoothedFactor[i] * atr[i];
    const bUpper = mid + smoothedFactor[i] * atr[i];
    const prevClose = candles[i - 1].close;

    const prevFLower = Number.isNaN(fLower) ? bLower : fLower;
    const prevFUpper = Number.isNaN(fUpper) ? bUpper : fUpper;

    fLower = prevClose > prevFLower ? Math.max(bLower, prevFLower) : bLower;
    fUpper = prevClose < prevFUpper ? Math.min(bUpper, prevFUpper) : bUpper;

    const prevDir = direction[i - 1];
    if (prevDir === 1 && candles[i].close < fLower) direction[i] = -1;
    else if (prevDir === -1 && candles[i].close > fUpper) direction[i] = 1;
    else direction[i] = prevDir;

    stLine[i] = direction[i] === 1 ? fLower : fUpper;
  }

  return { stLine, direction };
}

function computeMaxDD(curve: number[]): string {
  let peak = curve[0];
  let maxDD = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = ((peak - v) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD.toFixed(1);
}

export function runAdaptiveSupertrendEngine(
  candles: AdaptiveCandle[],
  params: AdaptiveSupertrendParams
): AdaptiveEngineResult {
  const { atrPeriod, erLength, smoothLength, minFactor, maxFactor } = params;
  const atr = computeATR(candles, atrPeriod);
  const er = computeER(candles, erLength);
  const rawFactor = er.map((e) => maxFactor - e * (maxFactor - minFactor));
  const smoothedFactor = smoothEMA(rawFactor, smoothLength);
  const { stLine, direction } = computeAdaptiveSupertrend(candles, atr, smoothedFactor);

  const signals: AdaptiveSignal[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (direction[i] !== direction[i - 1]) {
      signals.push({
        i,
        type: direction[i] === 1 ? "long" : "short",
        price: candles[i].close,
      });
    }
  }

  let equity = 10000;
  const equityCurve = [equity];
  let inPos = 0;
  let entryPrice = 0;
  let totalTrades = 0;
  let winners = 0;

  for (let i = 1; i < candles.length; i++) {
    const sig = signals.find((s) => s.i === i);
    if (sig) {
      if (inPos !== 0) {
        const pnl =
          inPos === 1
            ? (sig.price - entryPrice) / entryPrice
            : (entryPrice - sig.price) / entryPrice;
        equity *= 1 + pnl * 0.1;
        totalTrades++;
        if (pnl > 0) winners++;
      }
      inPos = sig.type === "long" ? 1 : -1;
      entryPrice = sig.price;
    }
    equityCurve.push(equity);
  }

  const winRate =
    totalTrades > 0 ? ((winners / totalTrades) * 100).toFixed(1) : "—";
  const finalReturn = ((equity / 10000 - 1) * 100).toFixed(1);
  const maxDD = computeMaxDD(equityCurve);

  return {
    atr,
    er,
    smoothedFactor,
    stLine,
    direction,
    signals,
    equityCurve,
    stats: { winRate, finalReturn, totalTrades, maxDD },
  };
}

export function classifyErRegime(er: number): "Trending" | "Mixed" | "Choppy" {
  if (er > 0.6) return "Trending";
  if (er > 0.35) return "Mixed";
  return "Choppy";
}
