export interface BinanceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WindowMetrics {
  atr: number;
  ker: number;
  stdDev: number;
  isNoisy: boolean;
}

function getTrueRange(current: BinanceCandle, previous?: BinanceCandle): number {
  if (!previous) return current.high - current.low;

  const highLow = current.high - current.low;
  const highPrevClose = Math.abs(current.high - previous.close);
  const lowPrevClose = Math.abs(current.low - previous.close);

  return Math.max(highLow, highPrevClose, lowPrevClose);
}

export function calculateATR(candles: BinanceCandle[], period: number = 14): number {
  if (candles.length <= period) return 0;

  const slice = candles.slice(-(period + 1));
  let trSum = 0;

  for (let i = 1; i < slice.length; i++) {
    trSum += getTrueRange(slice[i], slice[i - 1]);
  }

  return trSum / period;
}

export function calculateKER(candles: BinanceCandle[], period: number = 10): number {
  if (candles.length <= period) return 0;

  const slice = candles.slice(-(period + 1));

  const direction = Math.abs(slice[slice.length - 1].close - slice[0].close);

  let volatility = 0;
  for (let i = 1; i < slice.length; i++) {
    volatility += Math.abs(slice[i].close - slice[i - 1].close);
  }

  if (volatility === 0) return 0;
  return direction / volatility;
}

export function calculateStdDev(candles: BinanceCandle[], period: number = 20): number {
  if (candles.length < period) return 0;

  const closes = candles.slice(-period).map(c => c.close);
  const mean = closes.reduce((sum, val) => sum + val, 0) / period;

  const variance = closes.reduce((sqDiff, val) => sqDiff + Math.pow(val - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

export function evaluateWindow(candles: BinanceCandle[]): WindowMetrics {
  const atr = calculateATR(candles, 14);
  const ker = calculateKER(candles, 10);
  const stdDev = calculateStdDev(candles, 20);

  // If KER is below 0.3, the market is chopping sideways (high noise)
  const isNoisy = ker < 0.3;

  return { atr, ker, stdDev, isNoisy };
}
