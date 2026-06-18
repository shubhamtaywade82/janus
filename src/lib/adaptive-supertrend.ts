export const FEE_RT = 0.0008;
export const SLIP_RT = 0.0004;
export const COST_RT = FEE_RT + SLIP_RT;
export const RISK_PCT = 0.01;
export const STARTING_EQUITY = 10000;

export const AST_SYMBOLS = [
  "SOLUSDT", "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "NEARUSDT", "ATOMUSDT", "INJUSDT", "SUIUSDT", "WIFUSDT",
  "PEPEUSDT", "TIAUSDT", "SEIUSDT", "AAVEUSDT", "LTCUSDT",
] as const;

export const AST_INTERVALS = [
  { label: "1m", ms: 60_000 },
  { label: "3m", ms: 180_000 },
  { label: "5m", ms: 300_000 },
  { label: "15m", ms: 900_000 },
  { label: "30m", ms: 1_800_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "2h", ms: 7_200_000 },
  { label: "4h", ms: 14_400_000 },
  { label: "6h", ms: 21_600_000 },
  { label: "12h", ms: 43_200_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "3d", ms: 259_200_000 },
  { label: "1w", ms: 604_800_000 },
  { label: "1M", ms: 30 * 86_400_000 },
] as const;

export const AST_DATE_PRESETS = [
  { label: "1D", days: 1 },
  { label: "3D", days: 3 },
  { label: "1W", days: 7 },
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

export interface AdaptiveCandle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  closeTime?: number;
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

export interface AdaptiveTrade {
  n: number;
  dir: "Long" | "Short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  rawPnlPct: string;
  netPnlPct: string;
  dollarPnl: string;
  bars: number;
  equity: string;
  win: boolean;
}

export interface AdaptiveBacktestStats {
  netReturn: string;
  winRate: string;
  totalTrades: number;
  longs: number;
  shorts: number;
  profitFactor: string;
  avgWin: string;
  avgLoss: string;
  maxDD: string;
  sharpe: string;
  maxCW: number;
  maxCL: number;
  bestTrade: string;
  worstTrade: string;
}

export interface AdaptiveBacktestResult {
  atr: number[];
  er: number[];
  smoothedFactor: number[];
  stLine: number[];
  direction: number[];
  signals: AdaptiveSignal[];
  equityCurve: number[];
  trades: AdaptiveTrade[];
  stats: AdaptiveBacktestStats;
}

export function klinesToAdaptiveCandles(
  klines: {
    openTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    closeTime?: number;
  }[]
): AdaptiveCandle[] {
  return klines.map((k) => ({
    t: k.openTime,
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    vol: parseFloat(k.volume),
    closeTime: k.closeTime,
  }));
}

function atrRMA(candles: AdaptiveCandle[], period: number): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  });
  const out = new Array<number>(candles.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

function kaufmanER(candles: AdaptiveCandle[], len: number): number[] {
  return candles.map((_, i) => {
    if (i < len) return 0;
    const net = Math.abs(candles[i].close - candles[i - len].close);
    let path = 0;
    for (let j = i - len + 1; j <= i; j++) {
      path += Math.abs(candles[j].close - candles[j - 1].close);
    }
    return path > 0 ? net / path : 0;
  });
}

function ema(arr: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(arr.length).fill(NaN);
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) continue;
    out[i] = Number.isNaN(out[i - 1]) ? arr[i] : arr[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function adaptiveST(
  candles: AdaptiveCandle[],
  atr: number[],
  factor: number[]
): { stLine: number[]; direction: number[] } {
  const n = candles.length;
  const stLine = new Array<number>(n).fill(NaN);
  const direction = new Array<number>(n).fill(1);
  let fL = NaN;
  let fU = NaN;

  for (let i = 1; i < n; i++) {
    if (Number.isNaN(atr[i]) || Number.isNaN(factor[i])) continue;
    const mid = (candles[i].high + candles[i].low) / 2;
    const bL = mid - factor[i] * atr[i];
    const bU = mid + factor[i] * atr[i];
    const pL = Number.isNaN(fL) ? bL : fL;
    const pU = Number.isNaN(fU) ? bU : fU;
    fL = candles[i - 1].close > pL ? Math.max(bL, pL) : bL;
    fU = candles[i - 1].close < pU ? Math.min(bU, pU) : bU;
    const pd = direction[i - 1];
    if (pd === 1 && candles[i].close < fL) direction[i] = -1;
    else if (pd === -1 && candles[i].close > fU) direction[i] = 1;
    else direction[i] = pd;
    stLine[i] = direction[i] === 1 ? fL : fU;
  }
  return { stLine, direction };
}

export function runBacktest(
  candles: AdaptiveCandle[],
  p: AdaptiveSupertrendParams
): AdaptiveBacktestResult {
  const atr = atrRMA(candles, p.atrPeriod);
  const er = kaufmanER(candles, p.erLength);
  const rawF = er.map((e) => p.maxFactor - e * (p.maxFactor - p.minFactor));
  const smoothedFactor = ema(rawF, p.smoothLength);
  const { stLine, direction } = adaptiveST(candles, atr, smoothedFactor);

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

  let equity = STARTING_EQUITY;
  const equityCurve = new Array<number>(candles.length).fill(NaN);
  equityCurve[0] = equity;
  const trades: AdaptiveTrade[] = [];
  let inPos = 0;
  let entryPrice = 0;
  let entryIdx = 0;

  for (let i = 1; i < candles.length; i++) {
    const sig = signals.find((s) => s.i === i);

    if (sig) {
      if (inPos !== 0) {
        const exitPrice = candles[i].close;
        const rawPnl =
          inPos === 1
            ? (exitPrice - entryPrice) / entryPrice
            : (entryPrice - exitPrice) / entryPrice;
        const netPnl = rawPnl - COST_RT;
        const stopDist = Math.max(
          Math.abs(entryPrice - stLine[entryIdx]),
          entryPrice * 0.001
        );
        const posSize = (equity * RISK_PCT) / stopDist;
        const dollarPnl = posSize * netPnl * entryPrice;
        equity += dollarPnl;

        trades.push({
          n: trades.length + 1,
          dir: inPos === 1 ? "Long" : "Short",
          entryTime: candles[entryIdx].t,
          exitTime: candles[i].t,
          entryPrice,
          exitPrice,
          rawPnlPct: (rawPnl * 100).toFixed(2),
          netPnlPct: (netPnl * 100).toFixed(2),
          dollarPnl: dollarPnl.toFixed(2),
          bars: i - entryIdx,
          equity: equity.toFixed(2),
          win: netPnl > 0,
        });
      }
      inPos = sig.type === "long" ? 1 : -1;
      entryPrice = candles[i].close;
      entryIdx = i;
    }
    equityCurve[i] = equity;
  }

  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const grossWin = wins.reduce((s, t) => s + +t.netPnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + +t.netPnlPct, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "∞";
  const avgWin = wins.length ? (grossWin / wins.length).toFixed(2) : "0";
  const avgLoss = losses.length ? (grossLoss / losses.length).toFixed(2) : "0";

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (
      !Number.isNaN(equityCurve[i]) &&
      !Number.isNaN(equityCurve[i - 1]) &&
      equityCurve[i - 1] > 0
    ) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
  }
  const meanR = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
  const stdR = Math.sqrt(
    returns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (returns.length || 1)
  );
  const sharpe = stdR > 0 ? ((meanR / stdR) * Math.sqrt(252)).toFixed(2) : "—";

  let peak = equityCurve[0] || STARTING_EQUITY;
  let maxDD = 0;
  for (const v of equityCurve) {
    if (Number.isNaN(v)) continue;
    if (v > peak) peak = v;
    const dd = ((peak - v) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  let maxCW = 0;
  let maxCL = 0;
  let cw = 0;
  let cl = 0;
  for (const t of trades) {
    if (t.win) {
      cw++;
      cl = 0;
      maxCW = Math.max(maxCW, cw);
    } else {
      cl++;
      cw = 0;
      maxCL = Math.max(maxCL, cl);
    }
  }

  const longs = trades.filter((t) => t.dir === "Long").length;
  const shorts = trades.filter((t) => t.dir === "Short").length;
  const netReturn = ((equity / STARTING_EQUITY - 1) * 100).toFixed(2);

  return {
    atr,
    er,
    smoothedFactor,
    stLine,
    direction,
    signals,
    equityCurve,
    trades,
    stats: {
      netReturn,
      winRate: trades.length ? ((wins.length / trades.length) * 100).toFixed(1) : "—",
      totalTrades: trades.length,
      longs,
      shorts,
      profitFactor,
      avgWin,
      avgLoss,
      maxDD: maxDD.toFixed(2),
      sharpe,
      maxCW,
      maxCL,
      bestTrade: trades.length
        ? Math.max(...trades.map((t) => +t.netPnlPct)).toFixed(2)
        : "—",
      worstTrade: trades.length
        ? Math.min(...trades.map((t) => +t.netPnlPct)).toFixed(2)
        : "—",
    },
  };
}

/** @deprecated use runBacktest */
export const runAdaptiveSupertrendEngine = runBacktest;

export function classifyErRegime(er: number): "Trending" | "Mixed" | "Choppy" {
  if (er > 0.62) return "Trending";
  if (er > 0.38) return "Mixed";
  return "Choppy";
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtPrice(p: number | string | undefined, sym?: string): string {
  if (p === undefined || p === null || p === "") return "—";
  const n = +p;
  const digits =
    sym?.includes("BTC")
      ? 1
      : sym?.includes("DOGE") || sym?.includes("PEPE")
        ? 6
        : 3;
  return n.toFixed(digits);
}

export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function fromISO(s: string): number {
  return new Date(s).getTime();
}

export function intervalMs(label: string): number {
  return AST_INTERVALS.find((i) => i.label === label)?.ms ?? 3_600_000;
}
