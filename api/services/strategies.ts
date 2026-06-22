import type { OrderBookMetrics, TradeTapeMetrics } from "./confluence";

// ─── Technical Indicators ───

export function calculateSMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const sma: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prevEma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prevEma);
  for (let i = period; i < prices.length; i++) {
    const curEma = prices[i] * k + prevEma * (1 - k);
    ema.push(curEma);
    prevEma = curEma;
  }
  return ema;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  if (prices.length <= period) return [];
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + firstRS));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

export function calculateRMI(prices: number[], period: number = 14, momentum: number = 4): number[] {
  if (prices.length <= period + momentum) return [];

  const u: number[] = [];
  const d: number[] = [];
  for (let i = momentum; i < prices.length; i++) {
    const diff = prices[i] - prices[i - momentum];
    u.push(diff > 0 ? diff : 0);
    d.push(diff < 0 ? -diff : 0);
  }

  const rmi: number[] = [];
  let avgU = u.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgD = d.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const firstRS = avgD === 0 ? 100 : avgU / avgD;
  rmi.push(100 - 100 / (1 + firstRS));

  for (let i = period; i < u.length; i++) {
    avgU = (avgU * (period - 1) + u[i]) / period;
    avgD = (avgD * (period - 1) + d[i]) / period;
    const rs = avgD === 0 ? 100 : avgU / avgD;
    rmi.push(100 - 100 / (1 + rs));
  }

  return rmi;
}

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  multiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  if (prices.length < period) return { upper, middle, lower };

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    const mean = sum / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    middle.push(mean);
    upper.push(mean + multiplier * stdDev);
    lower.push(mean - multiplier * stdDev);
  }

  return { upper, middle, lower };
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const macdLine: number[] = [];
  const signalLine: number[] = [];
  const histogram: number[] = [];

  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);

  if (fastEma.length === 0 || slowEma.length === 0) {
    return { macdLine, signalLine, histogram };
  }

  const minLength = Math.min(fastEma.length, slowEma.length);
  const fastEmaAligned = fastEma.slice(fastEma.length - minLength);
  const slowEmaAligned = slowEma.slice(slowEma.length - minLength);

  for (let i = 0; i < minLength; i++) {
    macdLine.push(fastEmaAligned[i] - slowEmaAligned[i]);
  }

  const signal = calculateEMA(macdLine, signalPeriod);
  if (signal.length === 0) {
    return { macdLine, signalLine, histogram };
  }

  const macdAligned = macdLine.slice(macdLine.length - signal.length);
  for (let i = 0; i < signal.length; i++) {
    signalLine.push(signal[i]);
    histogram.push(macdAligned[i] - signal[i]);
  }

  return { macdLine: macdAligned, signalLine, histogram };
}

// ─── Simple OLS Linear Regression for SVR/LR High/Low Predictor ───
export function predictHighLow(
  historicalCloses: number[],
  historicalHighs: number[],
  historicalLows: number[],
  windowSize = 30
): { predictedHigh: number; predictedLow: number } {
  const n = historicalCloses.length;
  if (n < windowSize) {
    return {
      predictedHigh: historicalCloses[n - 1] * 1.01,
      predictedLow: historicalCloses[n - 1] * 0.99,
    };
  }

  // Linear Regression: Y = beta0 + beta1 * X
  // X = current close, Y_High = next period's High, Y_Low = next period's Low
  const fitModel = (xs: number[], ys: number[]) => {
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    const len = xs.length;
    for (let i = 0; i < len; i++) {
      sumX += xs[i];
      sumY += ys[i];
      sumXX += xs[i] * xs[i];
      sumXY += xs[i] * ys[i];
    }
    const denom = len * sumXX - sumX * sumX;
    if (denom === 0) return { beta0: sumY / len, beta1: 0 };
    const beta1 = (len * sumXY - sumX * sumY) / denom;
    const beta0 = (sumY - beta1 * sumX) / len;
    return { beta0, beta1 };
  };

  const xs = historicalCloses.slice(n - windowSize, n - 1);
  const ysHigh = historicalHighs.slice(n - windowSize + 1, n);
  const ysLow = historicalLows.slice(n - windowSize + 1, n);

  const modelHigh = fitModel(xs, ysHigh);
  const modelLow = fitModel(xs, ysLow);

  const currentClose = historicalCloses[n - 1];
  const predictedHigh = modelHigh.beta0 + modelHigh.beta1 * currentClose;
  const predictedLow = modelLow.beta0 + modelLow.beta1 * currentClose;

  return { predictedHigh, predictedLow };
}

// ─── Strategy Rule Processors ───

// 1. Grid Trading (Neutral Range Play)
export function evaluateGridStrategy(
  currentPrice: number,
  prices: number[],
  threshold = 65
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  if (prices.length < 30) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const high = Math.max(...prices.slice(-30));
  const low = Math.min(...prices.slice(-30));
  const mid = (high + low) / 2;

  // Grid works best in low volatility ranges
  let score = 50;
  const deviationFromMid = Math.abs(currentPrice - mid) / mid;
  
  // High score if near support (for long) or resistance (for short)
  let direction: "long" | "short" | "neutral" = "neutral";
  if (currentPrice < mid) {
    const proxToSupport = (currentPrice - low) / (mid - low);
    score += (1 - proxToSupport) * 35; // bullish range trigger
    direction = "long";
  } else {
    const proxToResistance = (high - currentPrice) / (high - mid);
    score += (1 - proxToResistance) * 35; // bearish range trigger
    direction = "short";
  }

  const isGated = score >= threshold;
  return {
    score: Math.max(0, Math.min(100, score)),
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: {
      rangeHigh: high,
      rangeLow: low,
      midPrice: mid,
      deviation: deviationFromMid,
    },
  };
}

// 2. Momentum Reversal (RMI + EMA)
export function evaluateMomentumReversal(
  currentPrice: number,
  prices: number[],
  threshold = 75
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  if (prices.length < 50) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const rmi = calculateRMI(prices, 14, 4);
  const ema200 = calculateEMA(prices, 50); // fast 50 EMA as trend filter
  
  if (rmi.length === 0 || ema200.length === 0) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const curRmi = rmi[rmi.length - 1];
  const prevRmi = rmi[rmi.length - 2] ?? curRmi;
  const curEma = ema200[ema200.length - 1];

  let score = 50;
  let direction: "long" | "short" | "neutral" = "neutral";

  const isUpTrend = currentPrice > curEma;

  if (isUpTrend && prevRmi < 30 && curRmi >= 30) {
    // oversold rebound in uptrend
    score = 80;
    direction = "long";
  } else if (!isUpTrend && prevRmi > 70 && curRmi <= 70) {
    // overbought rejection in downtrend
    score = 80;
    direction = "short";
  } else {
    // Normal scoring mapping
    if (curRmi < 30) score = 65;
    else if (curRmi > 70) score = 35;
  }

  const isGated = score >= threshold;
  return {
    score,
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: { rmi: curRmi, trendEma: curEma, isUpTrend },
  };
}

// 3. Bollinger Band Mean Reversion
export function evaluateBBReversion(
  currentPrice: number,
  prices: number[],
  threshold = 70
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  if (prices.length < 30) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const bands = calculateBollingerBands(prices, 20, 2);
  const rsi = calculateRSI(prices, 14);
  const macd = calculateMACD(prices, 12, 26, 9);

  if (bands.upper.length === 0 || rsi.length === 0 || macd.histogram.length === 0) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const curUpper = bands.upper[bands.upper.length - 1];
  const curLower = bands.lower[bands.lower.length - 1];
  const curMiddle = bands.middle[bands.middle.length - 1];
  const curRsi = rsi[rsi.length - 1];
  
  const curHist = macd.histogram[macd.histogram.length - 1];
  const prevHist = macd.histogram[macd.histogram.length - 2] ?? curHist;

  let score = 50;
  let direction: "long" | "short" | "neutral" = "neutral";

  // Reversal triggers
  if (currentPrice <= curLower && curRsi < 32) {
    score = 65;
    if (curHist > prevHist) {
      // MACD loss of downward momentum confirms trigger
      score = 78;
      direction = "long";
    }
  } else if (currentPrice >= curUpper && curRsi > 68) {
    score = 35;
    if (curHist < prevHist) {
      // MACD loss of upward momentum confirms trigger
      score = 78;
      direction = "short";
    }
  }

  const isGated = score >= threshold;
  return {
    score,
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: {
      bbUpper: curUpper,
      bbLower: curLower,
      bbMiddle: curMiddle,
      rsi: curRsi,
      macdHistogram: curHist,
    },
  };
}

// 4. ML-Driven Dynamic Position Sizing (Linear Regression High/Low)
export function evaluateMLSizing(
  currentPrice: number,
  prices: number[],
  highs: number[],
  lows: number[],
  threshold = 75
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  if (prices.length < 40) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  const { predictedHigh, predictedLow } = predictHighLow(prices, highs, lows, 30);
  const predictedRange = predictedHigh - predictedLow;
  
  let score = 50;
  let direction: "long" | "short" | "neutral" = "neutral";

  if (predictedRange > 0) {
    const position = (currentPrice - predictedLow) / predictedRange;
    if (position < 0.25) {
      // Close to predicted low, highly favorable for dynamic long sizing
      score = 82;
      direction = "long";
    } else if (position > 0.75) {
      // Close to predicted high, highly favorable for dynamic short sizing
      score = 82;
      direction = "short";
    }
  }

  const isGated = score >= threshold;
  return {
    score,
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: {
      predictedHigh,
      predictedLow,
      predictedRange,
    },
  };
}

// 5. High-Frequency microstructure order book wall scalper
export function evaluateScalpingMicro(
  _currentPrice: number,
  orderBook: OrderBookMetrics,
  tradeTape: TradeTapeMetrics,
  threshold = 65
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  let score = 50;
  let direction: "long" | "short" | "neutral" = "neutral";

  // Check bid/ask imbalance walls
  const totalDepth = orderBook.bidDepth + orderBook.askDepth;
  if (totalDepth > 0) {
    const bidPercentage = orderBook.bidDepth / totalDepth;
    if (bidPercentage > 0.7 && tradeTape.delta > 0) {
      // Buy wall absorption + net trade buys
      score = 75;
      direction = "long";
    } else if (bidPercentage < 0.3 && tradeTape.delta < 0) {
      // Sell wall absorption + net trade sells
      score = 75;
      direction = "short";
    }
  }

  const isGated = score >= threshold;
  return {
    score,
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: {
      bidDepth: orderBook.bidDepth,
      askDepth: orderBook.askDepth,
      spread: orderBook.spread,
      imbalance: orderBook.imbalance,
    },
  };
}

// 6. Alpha Protocol - Regime-Aware Priority Entry
export function evaluateAlphaProtocol(
  currentPrice: number,
  prices: number[],
  highs: number[],
  lows: number[],
  orderBook: OrderBookMetrics,
  tradeTape: TradeTapeMetrics,
  extraMetrics?: any,
  threshold = 75
): { score: number; direction: "long" | "short" | "neutral"; isGated: boolean; metadata: any } {
  if (prices.length < 50) {
    return { score: 50, direction: "neutral", isGated: false, metadata: {} };
  }

  let score = 50;
  let direction: "long" | "short" | "neutral" = "neutral";
  let activeTrigger = "none";

  const rsi = calculateRSI(prices, 14);
  const curRsi = rsi[rsi.length - 1];
  
  const atr = prices.length >= 30 ? (Math.max(...highs.slice(-14)) - Math.min(...lows.slice(-14))) / 14 : 0;
  
  // 1. Breakout & Retest
  const recentHigh = Math.max(...highs.slice(-30, -5));
  const recentLow = Math.min(...lows.slice(-30, -5));
  
  // 2. Mean Reversion
  const bands = calculateBollingerBands(prices, 20, 2);
  const curLower = bands.lower[bands.lower.length - 1] ?? 0;
  const curUpper = bands.upper[bands.upper.length - 1] ?? 0;

  // 3. Squeeze Setup (High OI, negative funding, upward tape)
  const isSqueeze = (extraMetrics?.fundingRate ?? 0) < -0.001 && (extraMetrics?.openInterestChange ?? 0) > 0.05 && tradeTape.delta > 0;
  
  // 4. Cascade Setup (Liquidation spike, exhaustion)
  const isCascade = (extraMetrics?.liquidityRemoved ?? 0) > 100000 && tradeTape.delta > 0 && curRsi < 30; // proxy for liquidations

  if (isSqueeze) {
    score = 85;
    direction = "long";
    activeTrigger = "squeeze";
  } else if (isCascade) {
    score = 85;
    direction = "long";
    activeTrigger = "cascade";
  } else if (currentPrice > recentHigh && curRsi > 50) {
    // Breakout logic
    score = 80;
    direction = "long";
    activeTrigger = "breakout";
  } else if (currentPrice < recentLow && curRsi < 50) {
    score = 80;
    direction = "short";
    activeTrigger = "breakdown";
  } else if (currentPrice <= curLower && curRsi < 35) {
    // Mean reversion
    score = 78;
    direction = "long";
    activeTrigger = "mean_reversion";
  } else if (currentPrice >= curUpper && curRsi > 65) {
    score = 78;
    direction = "short";
    activeTrigger = "mean_reversion";
  }

  const isGated = score >= threshold;
  return {
    score,
    direction: isGated ? direction : "neutral",
    isGated,
    metadata: {
      activeTrigger,
      rsi: curRsi,
      atr,
      triggerReason: activeTrigger,
    },
  };
}
