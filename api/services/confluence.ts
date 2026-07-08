/**
 * Confluence Scoring Engine
 * Multi-timeframe signal generation with 75-point threshold gating
 * 
 * Architecture:
 * - Microstructure (20%): Order book depth, spread, trade tape delta, maker-taker ratio
 * - Intraday (45%): Momentum, volatility bands, VWAP
 * - Swing (35%): Macro trend, support/resistance, market regime
 * 
 * Total Score = 0.20*S_micro + 0.45*S_intra + 0.35*S_swing
 * Gate: Execute only if Score >= 75
 */

// ─── Types ───
import { getCachedDailyTrend, dailyTrendScore } from "./trend-bias";
import type { MarketFeatures } from "./market-features";
export interface ConfluenceScore {
  symbol: string;
  microScore: number;   // 0-100
  intraScore: number;   // 0-100
  swingScore: number;   // 0-100
  compositeScore: number; // weighted sum
  threshold: number;    // default 75
  isGated: boolean;     // true if composite >= threshold
  direction: "long" | "short" | "neutral";
  indicators: {
    spread: number;
    spreadPercent?: number;
    imbalance: number;
    vwap: number;
    rsi: number;
    ema20: number;
    ema50: number;
    trendStrength: number;
    sweepScore?: number;
    absorptionScore?: number;
    volatilityRegime?: string;
    bidAskImbalance?: number;
    liquidityRemoved?: number;
    liquidityAdded?: number;
  };
  timestamp: number;
}

export interface OrderBookMetrics {
  spread: number;
  spreadPercent: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number; // positive = more bids, negative = more asks
  midPrice: number;
}

export interface TradeTapeMetrics {
  buyVolume: number;
  sellVolume: number;
  delta: number; // buy - sell
  makerRatio: number;
  avgTradeSize: number;
  tradeCount: number;
}

// ─── Constants ───
const WEIGHTS = {
  micro: 0.20,
  intra: 0.45,
  swing: 0.35,
};

const DEFAULT_THRESHOLD = 75;

// ─── Microstructure Scoring (20%) ───
export function calculateMicroScore(
  orderBook: OrderBookMetrics,
  tradeTape: TradeTapeMetrics
): number {
  let score = 50; // baseline

  // Spread analysis (0-20 points)
  if (orderBook.spreadPercent < 0.01) score += 10;
  else if (orderBook.spreadPercent < 0.05) score += 5;
  else score -= 5;

  // Order book imbalance (0-40 points)
  // Strong imbalance indicates directional pressure
  const imbalanceScore = Math.min(Math.abs(orderBook.imbalance) * 20, 30);
  score += imbalanceScore;
  if (orderBook.imbalance > 0.2) score += 5; // bid-heavy = bullish
  else if (orderBook.imbalance < -0.2) score -= 5; // ask-heavy = bearish

  // Trade tape delta (0-30 points)
  if (tradeTape.delta > 0 && tradeTape.buyVolume > 0) {
    score += Math.min(tradeTape.delta / tradeTape.buyVolume * 20, 20);
  } else if (tradeTape.sellVolume > 0) {
    score -= Math.min(Math.abs(tradeTape.delta) / tradeTape.sellVolume * 20, 20);
  }

  // Maker ratio analysis (0-10 points)
  if (tradeTape.makerRatio > 0.6) score += 5; // high maker = informed flow

  return Math.max(0, Math.min(100, score));
}

// ─── Intraday Scoring (45%) ───
export function calculateIntraScore(
  prices: number[],
  volumes: number[],
  features?: { rsi?: { value: number }; ema?: { ema20: number; ema50: number; crossover: string } }
): number {
  if (prices.length < 20) return 50;

  let score = 50;

  // RSI (pre-computed from feature engine when available, inline fallback)
  const rsiVal = features?.rsi?.value ?? calculateRSI(prices, 14);
  const rsiScore = rsiVal > 70 ? -15 : rsiVal < 30 ? 15 : rsiVal > 50 ? 5 : -5;
  score += rsiScore;

  // EMA crossover (pre-computed from feature engine when available, inline fallback)
  if (features?.ema) {
    if (features.ema.crossover === "BULLISH") score += 15;
    else if (features.ema.crossover === "BEARISH") score -= 15;
    else if (features.ema.ema20 > features.ema.ema50) score += 10;
    else score -= 10;
  } else {
    const ema20 = calculateEMA(prices, 20);
    const ema50 = calculateEMA(prices, 50);
    if (ema20.length > 0 && ema50.length > 0) {
      const currentEma20 = ema20[ema20.length - 1];
      const currentEma50 = ema50[ema50.length - 1];
      if (currentEma20 > currentEma50) score += 10;
      else score -= 10;

      const prevEma20 = ema20[ema20.length - 2] || currentEma20;
      const prevEma50 = ema50[ema50.length - 2] || currentEma50;
      if (prevEma20 <= prevEma50 && currentEma20 > currentEma50) score += 15;
      if (prevEma20 >= prevEma50 && currentEma20 < currentEma50) score -= 15;
    }
  }

  // Volume-weighted momentum
  if (volumes.length >= 10) {
    const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prevVol = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const volRatio = prevVol > 0 ? recentVol / prevVol : 1;
    if (volRatio > 1.5) score += 10; // volume surge
    else if (volRatio < 0.5) score -= 5; // low volume
  }

  // Price momentum (10-period ROC)
  if (prices.length >= 10) {
    const roc = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10] * 100;
    if (roc > 2) score += 10;
    else if (roc > 0) score += 5;
    else if (roc > -2) score -= 5;
    else score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Swing Scoring with Daily Trend Bias (35%) ───
export function calculateSwingScore(
  prices: number[],
  dailyTrendScore?: number,
  features?: { adx?: { value: number }; ema?: { ema50: number; ema200: number } }
): number {
  if (dailyTrendScore !== undefined) {
    let score = dailyTrendScore;

    const recentHigh = Math.max(...prices.slice(-50));
    const recentLow = Math.min(...prices.slice(-50));
    const range = recentHigh - recentLow;
    const currentPrice = prices[prices.length - 1];
    if (range > 0) {
      const positionInRange = (currentPrice - recentLow) / range;
      if (positionInRange > 0.8) score -= 10;
      else if (positionInRange < 0.2) score += 10;
    }

    const adxVal = features?.adx?.value ?? calculateADXApproximation(prices, 14);
    if (adxVal > 25) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // ─── Fallback: legacy 1-minute "swing" scoring ───
  if (prices.length < 50) return 50;

  let score = 50;

  const currentPrice = prices[prices.length - 1];

  // Long-term trend (pre-computed EMA when available)
  if (features?.ema) {
    if (features.ema.ema50 > features.ema.ema200) score += 15;
    else score -= 15;
  } else {
    const ema50 = calculateEMA(prices, 50);
    const ema200 = calculateEMA(prices, Math.min(200, prices.length));
    if (ema50.length > 0 && ema200.length > 0) {
      if (ema50[ema50.length - 1] > ema200[ema200.length - 1]) score += 15;
      else score -= 15;
    }
  }

  const sma50 = calculateSMA(prices, 50);
  if (sma50.length > 0) {
    if (currentPrice > sma50[sma50.length - 1] * 1.05) score += 10;
    else if (currentPrice > sma50[sma50.length - 1]) score += 5;
    else if (currentPrice < sma50[sma50.length - 1] * 0.95) score -= 10;
    else score -= 5;
  }

  const recentHigh = Math.max(...prices.slice(-50));
  const recentLow = Math.min(...prices.slice(-50));
  const range = recentHigh - recentLow;
  if (range > 0) {
    const positionInRange = (currentPrice - recentLow) / range;
    if (positionInRange > 0.8) score -= 10;
    else if (positionInRange < 0.2) score += 10;
  }

  const adxVal = features?.adx?.value ?? calculateADXApproximation(prices, 14);
  if (adxVal > 25) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Direction must reflect the weighted consensus of all three sub-scores, not
 * just intra — intra alone is only 45% of the composite, so picking direction
 * from it in isolation can flip the trade against a dominant micro+swing lean.
 */
function deriveWeightedDirection(
  microScore: number,
  intraScore: number,
  swingScore: number,
  weights: typeof WEIGHTS
): "long" | "short" | "neutral" {
  const weightedSignal =
    weights.micro * (microScore - 50) +
    weights.intra * (intraScore - 50) +
    weights.swing * (swingScore - 50);

  if (weightedSignal > 0) return "long";
  if (weightedSignal < 0) return "short";
  return "neutral";
}

// ─── Composite Score ───
export function calculateCompositeScore(
  microScore: number,
  intraScore: number,
  swingScore: number,
  weights = WEIGHTS,
  threshold = DEFAULT_THRESHOLD
): { composite: number; direction: "long" | "short" | "neutral" } {
  const composite =
    weights.micro * microScore +
    weights.intra * intraScore +
    weights.swing * swingScore;

  let direction: "long" | "short" | "neutral" = "neutral";
  if (composite >= threshold) {
    direction = deriveWeightedDirection(microScore, intraScore, swingScore, weights);
  }

  return { composite: Math.round(composite * 100) / 100, direction };
}

// ─── Kronos-Aware Composite Score ───
import { getKronosSignal } from "./kronos-client";

export async function calculateKronosAugmentedScore(
  symbol: string,
  microScore: number,
  intraScore: number,
  swingScore: number,
  weights = WEIGHTS,
  threshold = DEFAULT_THRESHOLD
): Promise<{ composite: number; direction: "long" | "short" | "neutral"; kronosBoost: number; kronosSignal?: any }> {
  // Base confluence score
  const baseComposite = weights.micro * microScore + weights.intra * intraScore + weights.swing * swingScore;

  // Fetch Kronos signal
  const kronos = await getKronosSignal(symbol, "1m", 4);
  let kronosBoost = 0;
  let direction: "long" | "short" | "neutral" = "neutral";

  if (kronos && kronos.confidence > 0.6) {
    const kronosDirection = kronos.directionSignal > 0.05 ? "long" : kronos.directionSignal < -0.05 ? "short" : "neutral";

    // Boost composite if Kronos agrees with the weighted technical direction
    const technicalDirection = deriveWeightedDirection(microScore, intraScore, swingScore, weights);

    if (kronosDirection === technicalDirection) {
      // Kronos agrees with technical signal — boost up to +15 points
      kronosBoost = Math.min(15, Math.abs(kronos.directionSignal) * 20 * kronos.confidence);
    } else if (kronosDirection !== "neutral" && kronosDirection !== technicalDirection) {
      // Kronos disagrees — penalize up to -10 points
      kronosBoost = -Math.min(10, Math.abs(kronos.directionSignal) * 15 * kronos.confidence);
    }

    // Volatility regime adjustment: reduce score in high predicted vol
    if (kronos.volatilityForecast > 0.08) {
      kronosBoost -= 5; // Penalty for chaotic conditions
    }
  }

  const composite = Math.max(0, Math.min(100, baseComposite + kronosBoost));

  if (composite >= threshold) {
    direction = deriveWeightedDirection(microScore, intraScore, swingScore, weights);
  }

  return { 
    composite: Math.round(composite * 100) / 100, 
    direction, 
    kronosBoost,
    kronosSignal: kronos
  };
}

// ─── Full Confluence Analysis ───
export function analyzeConfluence(
  symbol: string,
  orderBook: OrderBookMetrics,
  tradeTape: TradeTapeMetrics,
  prices: number[],
  volumes: number[],
  extraMetrics?: {
    sweepScore?: number;
    absorptionScore?: number;
    volatilityRegime?: string;
    bidAskImbalance?: number;
    liquidityRemoved?: number;
    liquidityAdded?: number;
    marketFeatures?: MarketFeatures;
  },
  strategyWeights?: { micro: number; intra: number; swing: number },
  strategyThreshold?: number
): ConfluenceScore {
  const features = extraMetrics?.marketFeatures;
  const microScore = calculateMicroScore(orderBook, tradeTape);
  const intraScore = calculateIntraScore(prices, volumes, features ? { rsi: { value: features.rsi.value }, ema: { ema20: features.ema.ema20, ema50: features.ema.ema50, crossover: features.ema.crossover } } : undefined);

  const dailyTrend = getCachedDailyTrend(symbol);
  const swingScore = calculateSwingScore(
    prices,
    dailyTrend ? dailyTrendScore(dailyTrend) : undefined,
    features ? { adx: { value: features.adx.value }, ema: { ema50: features.ema.ema50, ema200: features.ema.ema200 } } : undefined
  );

  const { composite, direction } = calculateCompositeScore(
    microScore,
    intraScore,
    swingScore,
    strategyWeights ?? WEIGHTS,
    strategyThreshold ?? DEFAULT_THRESHOLD
  );

  return {
    symbol,
    microScore: Math.round(microScore * 100) / 100,
    intraScore: Math.round(intraScore * 100) / 100,
    swingScore: Math.round(swingScore * 100) / 100,
    compositeScore: composite,
    threshold: strategyThreshold ?? DEFAULT_THRESHOLD,
    isGated: composite >= (strategyThreshold ?? DEFAULT_THRESHOLD),
    direction,
    indicators: {
      spread: orderBook.spread,
      spreadPercent: orderBook.spreadPercent,
      imbalance: orderBook.imbalance,
      vwap: calculateVWAP(prices, volumes),
      rsi: features?.rsi?.value ?? calculateRSI(prices, 14),
      ema20: features?.ema?.ema20 ?? calculateEMA(prices, 20).slice(-1)[0] ?? prices[prices.length - 1],
      ema50: features?.ema?.ema50 ?? calculateEMA(prices, 50).slice(-1)[0] ?? prices[prices.length - 1],
      trendStrength: features?.adx?.value ?? calculateADXApproximation(prices, 14),
      sweepScore: extraMetrics?.sweepScore,
      absorptionScore: extraMetrics?.absorptionScore,
      volatilityRegime: extraMetrics?.volatilityRegime ?? features?.volatility?.state,
      bidAskImbalance: extraMetrics?.bidAskImbalance,
      liquidityRemoved: extraMetrics?.liquidityRemoved,
      liquidityAdded: extraMetrics?.liquidityAdded,
    },
    timestamp: Date.now(),
  };
}

// ─── Technical Indicator Functions ───

function calculateSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  return result;
}

function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  const sma = calculateSMA(data, period);
  if (sma.length === 0) return result;

  result.push(sma[0]);
  let ema = sma[0];

  for (let i = 1; i < data.length - period + 1; i++) {
    ema = data[i + period - 1] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateVWAP(prices: number[], volumes: number[]): number {
  if (prices.length !== volumes.length || prices.length === 0) return prices[prices.length - 1] || 0;

  let typicalPV = 0;
  let totalV = 0;

  for (let i = 0; i < prices.length; i++) {
    typicalPV += prices[i] * volumes[i];
    totalV += volumes[i];
  }

  return totalV > 0 ? typicalPV / totalV : prices[prices.length - 1];
}

function calculateADXApproximation(prices: number[], period: number = 14): number {
  if (prices.length < period * 2) return 20;

  const highs = prices;
  const lows = prices.map((p, i) => (i > 0 ? Math.min(p, prices[i - 1]) : p));

  let plusDM = 0;
  let minusDM = 0;
  let trSum = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;

    trSum += Math.abs(highs[i] - lows[i]);
  }

  if (trSum === 0) return 0;

  const plusDI = (plusDM / trSum) * 100;
  const minusDI = (minusDM / trSum) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;

  return dx;
}

// ─── Real-time Data Aggregation ───
export function aggregateOrderBookMetrics(
  bids: [string, string][],
  asks: [string, string][]
): OrderBookMetrics {
  const bestBid = parseFloat(bids[0]?.[0] || "0");
  const bestAsk = parseFloat(asks[0]?.[0] || "0");
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  const bidDepth = bids.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
  const askDepth = asks.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
  const totalDepth = bidDepth + askDepth;
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

  return {
    spread,
    spreadPercent,
    bidDepth,
    askDepth,
    imbalance,
    midPrice,
  };
}

export function aggregateTradeTape(trades: { price: string; qty: string; isBuyerMaker: boolean }[]): TradeTapeMetrics {
  let buyVolume = 0;
  let sellVolume = 0;
  let makerCount = 0;
  let totalSize = 0;

  for (const trade of trades) {
    const qty = parseFloat(trade.qty);
    totalSize += qty;
    if (trade.isBuyerMaker) {
      sellVolume += qty; // buyer is maker = sell order filled
      makerCount++;
    } else {
      buyVolume += qty; // seller is maker = buy order filled
    }
  }

  return {
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
    makerRatio: trades.length > 0 ? makerCount / trades.length : 0,
    avgTradeSize: trades.length > 0 ? totalSize / trades.length : 0,
    tradeCount: trades.length,
  };
}
