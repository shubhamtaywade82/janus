import { getDb } from "../queries/connection";
import {
  fundingRateHistory,
  marketData,
  openInterestData,
  recentTicks,
  liquidationEvents,
} from "@db/schema";
import { desc, eq, and, gte } from "drizzle-orm";
import { marketStateManager } from "./market-state";

// ─── Types ───

export interface SwingPoint {
  price: number;
  timestamp: number;
  type: "high" | "low";
}

export interface FVG {
  low: number;
  high: number;
  type: "BULLISH" | "BEARISH";
  timestamp: number;
  filled: boolean;
}

export interface OrderBlock {
  high: number;
  low: number;
  type: "BULLISH" | "BEARISH";
  timestamp: number;
  status: "ACTIVE" | "MITIGATED" | "INVALIDATED";
}

export interface LiquidityPool {
  price: number;
  type: "BUY_SIDE" | "SELL_SIDE";
  strength: "HIGH" | "MEDIUM" | "LOW";
}

export type AnalysisTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface AnalysisCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

export interface TimeframeStructure {
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  structure: "UPTREND" | "DOWNTREND" | "RANGING";
  bos: boolean;
  choch: boolean;
  ema_trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  momentum: "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH" | "EXHAUSTING" | "RECOVERY";
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  latestBos?: { direction: "BULLISH" | "BEARISH"; level: number; timeframe: string; timestamp: number };
  latestChoch?: { direction: "BULLISH" | "BEARISH"; level: number; timeframe: string; timestamp: number };
}

// ─── Indicators & Math Utilities ───

export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaArray: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emaArray.push(values[i] * k + emaArray[i - 1] * (1 - k));
  }
  return emaArray;
}

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const gains = [];
  const losses = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000, 2)}M`;
  if (abs >= 1_000) return `${round(value / 1_000, 2)}k`;
  return `${round(value, 2)}`;
}

// ─── Market Structure Analysis ───

export function findSwings(candles: AnalysisCandle[], windowSize = 3): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const swHighs: SwingPoint[] = [];
  const swLows: SwingPoint[] = [];
  for (let i = windowSize; i < candles.length - windowSize; i++) {
    const candle = candles[i];
    const window = candles.slice(i - windowSize, i + windowSize + 1);
    const isHigh = candle.high === Math.max(...window.map((c) => c.high));
    const isLow = candle.low === Math.min(...window.map((c) => c.low));
    if (isHigh) swHighs.push({ price: candle.high, timestamp: candle.timestamp, type: "high" });
    if (isLow) swLows.push({ price: candle.low, timestamp: candle.timestamp, type: "low" });
  }
  return { highs: swHighs, lows: swLows };
}

export function deriveTrend(swHighs: SwingPoint[], swLows: SwingPoint[]): TimeframeStructure["trend"] {
  if (swHighs.length < 2 || swLows.length < 2) return "NEUTRAL";
  const lastHigh = swHighs[swHighs.length - 1].price;
  const prevHigh = swHighs[swHighs.length - 2].price;
  const lastLow = swLows[swLows.length - 1].price;
  const prevLow = swLows[swLows.length - 2].price;
  if (lastHigh > prevHigh && lastLow > prevLow) return "BULLISH";
  if (lastHigh < prevHigh && lastLow < prevLow) return "BEARISH";
  return "NEUTRAL";
}

export function analyzeTimeframeStructure(candles: AnalysisCandle[], timeframe: AnalysisTimeframe): TimeframeStructure {
  const neutral: TimeframeStructure = {
    trend: "NEUTRAL",
    structure: "RANGING",
    bos: false,
    choch: false,
    ema_trend: "NEUTRAL",
    momentum: "NEUTRAL",
    swingHighs: [],
    swingLows: [],
  };
  if (candles.length < 20) return neutral;

  const closes = candles.map((c) => c.close);
  const { highs: swingHighs, lows: swingLows } = findSwings(candles, 3);
  const trend = deriveTrend(swingHighs, swingLows);
  const structure = trend === "BULLISH" ? "UPTREND" : trend === "BEARISH" ? "DOWNTREND" : "RANGING";
  
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, Math.min(50, closes.length));
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const emaTrend = lastEma20 && lastEma50
    ? lastEma20 > lastEma50 ? "BULLISH" : "BEARISH"
    : "NEUTRAL";

  const rsi = calculateRSI(closes, 14);
  const momentum: TimeframeStructure["momentum"] =
    rsi > 70 ? (trend === "BULLISH" ? "STRONG_BULLISH" : "EXHAUSTING") :
    rsi > 55 ? (trend === "BEARISH" ? "RECOVERY" : "BULLISH") :
    rsi >= 45 ? "NEUTRAL" :
    rsi > 30 ? (trend === "BULLISH" ? "EXHAUSTING" : "BEARISH") :
    "STRONG_BEARISH";

  const last = candles[candles.length - 1];
  const lastHigh = swingHighs[swingHighs.length - 1];
  const lastLow = swingLows[swingLows.length - 1];
  let latestBos: TimeframeStructure["latestBos"];
  let latestChoch: TimeframeStructure["latestChoch"];

  if (lastHigh && last.close > lastHigh.price) {
    if (trend === "BEARISH") latestChoch = { direction: "BULLISH", level: lastHigh.price, timeframe, timestamp: last.timestamp };
    else latestBos = { direction: "BULLISH", level: lastHigh.price, timeframe, timestamp: last.timestamp };
  }
  if (lastLow && last.close < lastLow.price) {
    if (trend === "BULLISH") latestChoch = { direction: "BEARISH", level: lastLow.price, timeframe, timestamp: last.timestamp };
    else latestBos = { direction: "BEARISH", level: lastLow.price, timeframe, timestamp: last.timestamp };
  }

  return { trend, structure, bos: !!latestBos, choch: !!latestChoch, ema_trend: emaTrend, momentum, swingHighs, swingLows, latestBos, latestChoch };
}

// ─── SMC Logic (Order Blocks, FVG) ───

export function detectOrderBlocks(candles: AnalysisCandle[], structure: TimeframeStructure, currentPrice: number): { bullish: OrderBlock[]; bearish: OrderBlock[] } {
  const bullish: OrderBlock[] = [];
  const bearish: OrderBlock[] = [];
  if (candles.length < 10 || !structure.latestBos) return { bullish, bearish };

  const breakIdx = Math.max(1, candles.findIndex((c) => c.timestamp === structure.latestBos?.timestamp));
  const start = breakIdx > 0 ? breakIdx - 1 : candles.length - 2;
  for (let i = start; i >= Math.max(0, start - 10); i--) {
    const candle = candles[i];
    if (structure.latestBos.direction === "BULLISH" && candle.close < candle.open) {
      const status: OrderBlock["status"] = currentPrice < candle.low ? "INVALIDATED" : (currentPrice <= candle.high && currentPrice >= candle.low ? "MITIGATED" : "ACTIVE");
      bullish.push({ high: candle.high, low: candle.low, type: "BULLISH", timestamp: candle.timestamp, status });
      break;
    }
    if (structure.latestBos.direction === "BEARISH" && candle.close > candle.open) {
      const status: OrderBlock["status"] = currentPrice > candle.high ? "INVALIDATED" : (currentPrice <= candle.high && currentPrice >= candle.low ? "MITIGATED" : "ACTIVE");
      bearish.push({ high: candle.high, low: candle.low, type: "BEARISH", timestamp: candle.timestamp, status });
      break;
    }
  }
  return { bullish, bearish };
}

export function detectFVGs(candles: AnalysisCandle[]): { bullish: FVG[]; bearish: FVG[] } {
  const bullish: FVG[] = [];
  const bearish: FVG[] = [];
  if (candles.length < 3) return { bullish, bearish };

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];
    const later = candles.slice(i + 2);
    if (next.low > prev.high) {
      bullish.push({ low: prev.high, high: next.low, type: "BULLISH", timestamp: candles[i].timestamp, filled: later.some((c) => c.low <= prev.high) });
    }
    if (next.high < prev.low) {
      bearish.push({ low: next.high, high: prev.low, type: "BEARISH", timestamp: candles[i].timestamp, filled: later.some((c) => c.high >= prev.low) });
    }
  }
  return { bullish, bearish };
}

// ─── Volume Profile ───

export function buildVolumeProfile(candles: AnalysisCandle[], currentPrice: number) {
  if (candles.length === 0 || currentPrice <= 0) return { poc: 0, vah: 0, val: 0, current_position: "AT_POC", implication: "NEUTRAL" };

  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { poc: currentPrice, vah: currentPrice, val: currentPrice, current_position: "AT_POC", implication: "NEUTRAL" };

  const binCount = Math.min(100, Math.max(20, candles.length));
  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ low: min + i * step, high: min + (i + 1) * step, volume: 0 }));

  for (const candle of candles) {
    const range = Math.max(candle.high - candle.low, step);
    for (const bin of bins) {
      const overlap = Math.min(bin.high, candle.high) - Math.max(bin.low, candle.low);
      if (overlap > 0) bin.volume += candle.volume * (overlap / range);
    }
  }

  const pocIdx = bins.reduce((best, bin, idx) => bin.volume > bins[best].volume ? idx : best, 0);
  const targetVolume = bins.reduce((sum, bin) => sum + bin.volume, 0) * 0.7;
  let lowIdx = pocIdx, highIdx = pocIdx, accumulated = bins[pocIdx].volume;

  while (accumulated < targetVolume && (lowIdx > 0 || highIdx < bins.length - 1)) {
    const below = bins[lowIdx - 1]?.volume ?? -1, above = bins[highIdx + 1]?.volume ?? -1;
    if (above >= below && highIdx < bins.length - 1) { highIdx++; accumulated += bins[highIdx].volume; }
    else if (lowIdx > 0) { lowIdx--; accumulated += bins[lowIdx].volume; }
    else break;
  }

  const poc = (bins[pocIdx].low + bins[pocIdx].high) / 2;
  const currentPos = Math.abs(currentPrice - poc) / poc < 0.003 ? "AT_POC" : (currentPrice > poc ? "ABOVE_POC" : "BELOW_POC");
  return { poc: round(poc, 6), vah: round(bins[highIdx].high, 6), val: round(bins[lowIdx].low, 6), current_position: currentPos, implication: currentPos === "ABOVE_POC" ? "BULLISH" : (currentPos === "BELOW_POC" ? "BEARISH" : "NEUTRAL") };
}

// ─── Volume & Market Sentiment ───

export function analyzeVolumeFromCandles(candles: AnalysisCandle[]) {
  if (candles.length < 20) return { relative_volume: 1, accumulation: false, distribution: false, climax_volume: false, volume_score: { bullish: 5, bearish: 5 } };

  const last = candles[candles.length - 1];
  const avgVolume = candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
  const relativeVolume = avgVolume > 0 ? last.volume / avgVolume : 1;
  const last5 = candles.slice(-5);
  const priceDown = last5[4].close < last5[0].close, priceUp = last5[4].close > last5[0].close;
  const volumeExpanding = last5.every((c, i) => i === 0 || c.volume >= last5[i - 1].volume * 0.9);
  const accumulation = priceDown && volumeExpanding && last5.filter((c) => (c.close - c.low) / (c.high - c.low || 1) > 0.6).length >= 3;
  const distribution = priceUp && volumeExpanding && last5.filter((c) => (c.high - c.close) / (c.high - c.low || 1) > 0.6).length >= 3;
  const climax = relativeVolume > 3 && (Math.abs(last.close - last.open) / (last.high - last.low || 1)) > 0.6;

  let bullish = 5, bearish = 5;
  if (accumulation) { bullish += 3; bearish -= 1; }
  if (distribution) { bearish += 3; bullish -= 1; }
  return { relative_volume: round(relativeVolume, 2), accumulation, distribution, climax_volume: climax, volume_score: { bullish: clamp(bullish, 0, 10), bearish: clamp(bearish, 0, 10) } };
}

export async function analyzeOpenInterest(symbol: string, currentPrice: number, previousPrice: number) {
  const state = marketStateManager.get(symbol);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const db = getDb();
  const rows = await db.select().from(openInterestData).where(and(eq(openInterestData.symbol, symbol), gte(openInterestData.timestamp, since))).orderBy(desc(openInterestData.timestamp)).limit(2880).catch(() => []);

  let samples = rows.reverse().map((row) => ({ openInterest: parseFloat(row.openInterest), timestamp: row.timestamp.getTime() }));
  if (state && state.openInterestWindow.size() > samples.length) samples = state.openInterestWindow.values();

  const current = samples[samples.length - 1]?.openInterest ?? state?.latestOpenInterest?.openInterest ?? 0;
  const previous = samples[0]?.openInterest ?? current;
  const oiChange = previous > 0 ? (current - previous) / previous * 100 : 0;
  const priceChange = previousPrice > 0 ? (currentPrice - previousPrice) / previousPrice * 100 : 0;

  let interpretation: "NEW_LONGS" | "NEW_SHORTS" | "SHORT_COVERING" | "LONG_LIQUIDATION" | "UNKNOWN" = "UNKNOWN";
  if (priceChange > 0.1 && oiChange > 0.5) interpretation = "NEW_LONGS";
  else if (priceChange < -0.1 && oiChange > 0.5) interpretation = "NEW_SHORTS";
  else if (priceChange > 0.1 && oiChange < -0.5) interpretation = "SHORT_COVERING";
  else if (priceChange < -0.1 && oiChange < -0.5) interpretation = "LONG_LIQUIDATION";

  return { current: formatCompact(current), change_24h: { percent: round(oiChange, 2) }, interpretation, conviction: Math.abs(oiChange) >= 5 ? "HIGH" : (Math.abs(oiChange) >= 2 ? "MEDIUM" : "LOW") };
}

export async function analyzeFunding(symbol: string) {
  const state = marketStateManager.get(symbol);
  let rate = state?.latestFunding?.fundingRate;
  if (rate === undefined) {
    const [latest] = await getDb().select().from(fundingRateHistory).where(eq(fundingRateHistory.symbol, symbol)).orderBy(desc(fundingRateHistory.timestamp)).limit(1).catch(() => []);
    if (latest) rate = parseFloat(latest.fundingRate);
  }
  rate = rate ?? 0;
  return { current: `${(rate * 100).toFixed(4)}%`, sentiment: rate > 0.0001 ? "LONG_HEAVY" : (rate < -0.0001 ? "SHORT_HEAVY" : "NEUTRAL"), squeeze_risk: rate > 0.001 ? "LONG_SQUEEZE" : (rate < -0.001 ? "SHORT_SQUEEZE" : "NONE") };
}

export async function getLiquidationStats(symbol: string) {
  const sinceMs = Date.now() - 15 * 60_000;
  const state = marketStateManager.get(symbol);
  const memory = state?.liquidationWindow.values().filter((liq) => liq.timestamp >= sinceMs) ?? [];
  if (memory.length > 0) return memory.reduce((acc, l) => { const n = l.price * l.quantity; if (l.side === "SELL") { acc.longQty += l.quantity; acc.longNotional += n; } else { acc.shortQty += l.quantity; acc.shortNotional += n; } acc.count++; return acc; }, { longQty: 0, shortQty: 0, longNotional: 0, shortNotional: 0, count: 0 });

  const rows = await getDb().select().from(liquidationEvents).where(and(eq(liquidationEvents.symbol, symbol), gte(liquidationEvents.tradeTime, new Date(sinceMs)))).orderBy(desc(liquidationEvents.tradeTime)).limit(500).catch(() => []);
  return rows.reduce((acc, r) => { const q = parseFloat(r.quantity), p = parseFloat(r.price), n = q * p; if (r.side === "SELL") { acc.longQty += q; acc.longNotional += n; } else { acc.shortQty += q; acc.shortNotional += n; } acc.count++; return acc; }, { longQty: 0, shortQty: 0, longNotional: 0, shortNotional: 0, count: 0 });
}

export async function analyzeCvd(symbol: string, candles: AnalysisCandle[]): Promise<{ trend: string; signal_strength: string }> {
  const state = marketStateManager.get(symbol);
  let points = state?.cvdWindow.values().map((p) => ({
    price: p.price,
    cumulative: p.cumulative,
    timestamp: p.timestamp,
  })) ?? [];

  if (points.length < 20) {
    const db = getDb();
    const rows = await db
      .select()
      .from(recentTicks)
      .where(eq(recentTicks.symbol, symbol))
      .orderBy(desc(recentTicks.tradeTime))
      .limit(1000)
      .catch(() => []);
    let cumulative = 0;
    points = rows.reverse().map((row) => {
      const price = parseFloat(row.price);
      const qty = parseFloat(row.size);
      cumulative += row.side === "buy" ? price * qty : -price * qty;
      return { price, cumulative, timestamp: row.tradeTime.getTime() };
    });
  }

  if (points.length < 20 || candles.length < 20) {
    return { trend: "NEUTRAL", signal_strength: "WEAK" };
  }

  const recentPoints = points.slice(-20);
  const recentCandles = candles.slice(-20);
  const firstPriceLow = Math.min(...recentCandles.slice(0, 10).map((c) => c.low));
  const secondPriceLow = Math.min(...recentCandles.slice(10).map((c) => c.low));
  const firstPriceHigh = Math.max(...recentCandles.slice(0, 10).map((c) => c.high));
  const secondPriceHigh = Math.max(...recentCandles.slice(10).map((c) => c.high));
  const firstCvdLow = Math.min(...recentPoints.slice(0, 10).map((p) => p.cumulative));
  const secondCvdLow = Math.min(...recentPoints.slice(10).map((p) => p.cumulative));
  const firstCvdHigh = Math.max(...recentPoints.slice(0, 10).map((p) => p.cumulative));
  const secondCvdHigh = Math.max(...recentPoints.slice(10).map((p) => p.cumulative));

  if (secondPriceLow < firstPriceLow && secondCvdLow > firstCvdLow) {
    return { trend: "BULLISH_DIVERGENCE", signal_strength: "STRONG" };
  }
  if (secondPriceHigh > firstPriceHigh && secondCvdHigh < firstCvdHigh) {
    return { trend: "BEARISH_DIVERGENCE", signal_strength: "STRONG" };
  }

  const cvdChange = recentPoints[recentPoints.length - 1].cumulative - recentPoints[0].cumulative;
  const priceChange = recentCandles[recentCandles.length - 1].close - recentCandles[0].close;
  if ((cvdChange > 0 && priceChange > 0) || (cvdChange < 0 && priceChange < 0)) {
    return { trend: "CONTINUATION", signal_strength: Math.abs(cvdChange) > Math.abs(recentPoints[0].cumulative) * 0.1 ? "STRONG" : "MODERATE" };
  }

  return { trend: "NEUTRAL", signal_strength: "WEAK" };
}

export async function comprehensiveAnalysis(symbol: string): Promise<any> {
  const binanceSymbol = symbol.toUpperCase();
  const state = marketStateManager.get(binanceSymbol);
  
  const timeframes: AnalysisTimeframe[] = ["1d", "4h", "1h", "15m", "5m", "1m"];
  const candleEntries = await Promise.all(
    timeframes.map(async (tf) => [tf, await loadCandlesFromDb(binanceSymbol, tf, 500)] as const)
  );
  const candlesByTf = new Map<AnalysisTimeframe, AnalysisCandle[]>(candleEntries);
  const oneMinCandles = candlesByTf.get("1m") ?? [];
  const primaryCandles = oneMinCandles.length >= 20 ? oneMinCandles : (candlesByTf.get("5m") ?? []);
  const currentPrice = state?.ltp || primaryCandles[primaryCandles.length - 1]?.close || 0;

  const mtf: any = {};
  for (const tf of timeframes) {
    const struct = analyzeTimeframeStructure(candlesByTf.get(tf) ?? [], tf);
    mtf[tf] = { trend: struct.trend, structure: struct.structure, bos: struct.bos, choch: struct.choch, ema_trend: struct.ema_trend, momentum: struct.momentum };
  }

  const volume = analyzeVolumeFromCandles(candlesByTf.get("15m") ?? primaryCandles);
  const openInterest = await analyzeOpenInterest(binanceSymbol, currentPrice, primaryCandles[0]?.close || currentPrice);
  const funding = await analyzeFunding(binanceSymbol);
  const cvd = await analyzeCvd(binanceSymbol, primaryCandles);
  const liquidations = await getLiquidationStats(binanceSymbol);

  return {
    symbol: binanceSymbol,
    timestamp: new Date().toISOString(),
    multi_timeframe: mtf,
    volume,
    open_interest: openInterest,
    funding,
    cvd,
    liquidations,
    currentPrice
  };
}

async function loadCandlesFromDb(symbol: string, timeframe: AnalysisTimeframe, limit: number): Promise<AnalysisCandle[]> {
  const rows = await getDb().select().from(marketData).where(and(eq(marketData.symbol, symbol), eq(marketData.timeframe, timeframe))).orderBy(desc(marketData.timestamp)).limit(limit).catch(() => []);
  return rows.reverse().map(r => ({ timestamp: r.timestamp.getTime(), open: parseFloat(r.open), high: parseFloat(r.high), low: parseFloat(r.low), close: parseFloat(r.close), volume: parseFloat(r.volume), quoteVolume: parseFloat(r.quoteVolume), trades: r.tradeCount ?? 0 }));
}
