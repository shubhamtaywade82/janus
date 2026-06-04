import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  fundingRateHistory,
  liquidationEvents,
  marketData,
  openInterestData,
  recentTicks,
  signals,
} from "@db/schema";
import { desc, eq, and, sql, gte } from "drizzle-orm";
import { EventEmitter } from "events";
import { observable } from "@trpc/server/observable";
import {
  analyzeConfluence,
  aggregateOrderBookMetrics,
  aggregateTradeTape,
} from "../services/confluence";
import { fetchKlines, fetchOpenInterest, SUPPORTED_PAIRS } from "../services/binance";
import { subscribeToSymbol } from "../services/streaming";
import { marketStateManager } from "../services/market-state";
import { STRATEGY_CONFIGS, type StrategyType } from "../services/strategy-config";
import {
  evaluateGridStrategy,
  evaluateMomentumReversal,
  evaluateBBReversion,
  evaluateMLSizing,
  evaluateScalpingMicro
} from "../services/strategies";
import {
  detectRegimeForSymbol,
  latestRegimeCache,
} from "../services/regime-detector";
import { globalAutoExecutor } from "../services/auto-executor";
import {
  computeKnnSupertrend,
  knnSnapshotCache,
  type KnnSupertrendSnapshot,
} from "../services/knn-supertrend";

// ─── Types for the Comprehensive Analysis Engine ───

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

export interface AnalysisResult {
  symbol: string;
  exchange: string;
  timestamp: string;
  market_state: {
    regime: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
  };
  multi_timeframe: Record<
    string,
    {
      trend: "BULLISH" | "BEARISH" | "NEUTRAL";
      structure: "UPTREND" | "DOWNTREND" | "RANGING";
      bos: boolean;
      choch: boolean;
      ema_trend: "BULLISH" | "BEARISH" | "NEUTRAL";
      momentum: "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH" | "EXHAUSTING" | "RECOVERY";
    }
  >;
  market_structure: {
    overall_bias: "BULLISH" | "BEARISH" | "NEUTRAL";
    swing_highs: number[];
    swing_lows: number[];
    latest_bos?: {
      direction: "BULLISH" | "BEARISH";
      level: number;
    };
    latest_choch?: {
      direction: "BULLISH" | "BEARISH";
      level: number;
      timeframe: string;
    };
    structure_score: {
      bullish: number;
      bearish: number;
    };
  };
  liquidity: {
    buy_side: number[];
    sell_side: number[];
    last_sweep?: {
      side: "BUY_SIDE" | "SELL_SIDE";
      level: number;
      confirmed: boolean;
    };
    liquidity_event?: {
      type: string;
      strength: string;
    };
    probability_of_reversal: number;
  };
  order_blocks: {
    bullish: OrderBlock[];
    bearish: OrderBlock[];
    nearest_ob?: {
      type: "BULLISH" | "BEARISH";
      distance_percent: number;
    };
  };
  fvg: {
    bullish: FVG[];
    bearish: FVG[];
    nearest_fvg?: {
      type: "BULLISH" | "BEARISH";
    };
  };
  volume: {
    relative_volume: number;
    accumulation: boolean;
    distribution: boolean;
    climax_volume: boolean;
    volume_score: {
      bullish: number;
      bearish: number;
    };
  };
  open_interest: {
    current: string;
    change_24h: {
      percent: number;
    };
    interpretation: "NEW_LONGS" | "NEW_SHORTS" | "SHORT_COVERING" | "LONG_LIQUIDATION" | "UNKNOWN";
    conviction: "HIGH" | "MEDIUM" | "LOW";
  };
  funding: {
    current: string;
    sentiment: "LONG_HEAVY" | "SHORT_HEAVY" | "NEUTRAL";
    squeeze_risk: "LONG_SQUEEZE" | "SHORT_SQUEEZE" | "NONE";
  };
  cvd: {
    trend: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | "CONTINUATION" | "NEUTRAL";
    signal_strength: "STRONG" | "MODERATE" | "WEAK";
  };
  orderbook: {
    imbalance: {
      bid_volume: string;
      ask_volume: string;
    };
    ratio: number;
    dominant_side: "BUYERS" | "SELLERS" | "NEUTRAL";
    absorption: boolean;
    spoofing: boolean;
  };
  volume_profile: {
    poc: number;
    vah: number;
    val: number;
    current_position: "ABOVE_POC" | "BELOW_POC" | "AT_POC";
    implication: "BULLISH" | "BEARISH" | "NEUTRAL";
  };
  signals: {
    reversal: {
      detected: boolean;
      confidence: number;
    };
    continuation: {
      detected: boolean;
      confidence: number;
    };
    squeeze?: {
      type: "LONG_SQUEEZE" | "SHORT_SQUEEZE";
      confidence: number;
    };
    accumulation: {
      detected: boolean;
      confidence: number;
    };
  };
  trade_setup?: {
    setup_type: "COUNTER_TREND_LONG" | "COUNTER_TREND_SHORT" | "CONTINUATION_LONG" | "CONTINUATION_SHORT" | "NO_TRADE";
    entry_zone: {
      low: number;
      high: number;
    };
    stop_loss: number;
    targets: number[];
    risk_reward: number;
    confidence: number;
    invalidation: string;
  };
  summary: {
    verdict: string;
    market_phase: "ACCUMULATION" | "DISTRIBUTION" | "TRENDING" | "RANGING";
    recommended_action: "WAIT_FOR_CONFIRMATION" | "TAKE_POSITION" | "NO_TRADE";
    confidence: number;
  };
}

// ─── Signal update event bus ───
export const signalEvents = new EventEmitter();
signalEvents.setMaxListeners(50);

type AnalysisTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

interface AnalysisCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

interface TimeframeStructure {
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  structure: "UPTREND" | "DOWNTREND" | "RANGING";
  bos: boolean;
  choch: boolean;
  ema_trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  momentum: AnalysisResult["multi_timeframe"][string]["momentum"];
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  latestBos?: { direction: "BULLISH" | "BEARISH"; level: number; timeframe: string; timestamp: number };
  latestChoch?: { direction: "BULLISH" | "BEARISH"; level: number; timeframe: string; timestamp: number };
}

type ConfluenceExtraMetrics = NonNullable<Parameters<typeof analyzeConfluence>[5]>;

const ANALYSIS_TIMEFRAMES: AnalysisTimeframe[] = ["1d", "4h", "1h", "15m", "5m", "1m"];
const TIMEFRAME_MS: Record<AnalysisTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};
const TIMEFRAME_LIMITS: Record<AnalysisTimeframe, number> = {
  "1m": 500,
  "5m": 500,
  "15m": 500,
  "1h": 500,
  "4h": 500,
  "1d": 365,
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Input helper: checks cache / local DB, falls back to REST ───
async function getConfluenceInput(binanceSymbol: string) {
  const state = marketStateManager.get(binanceSymbol);

  // 1. Order Book Metrics
  let obMetrics;
  if (state && state.orderBook) {
    obMetrics = {
      spread: state.metrics.spread,
      spreadPercent: state.metrics.spreadPercent,
      bidDepth: state.metrics.bidDepth,
      askDepth: state.metrics.askDepth,
      imbalance: state.metrics.imbalance,
      midPrice: state.metrics.midPrice,
    };
  } else {
    obMetrics = { spread: 0, spreadPercent: 0.05, bidDepth: 0, askDepth: 0, imbalance: 0, midPrice: 0 };
  }

  // 2. Trade Tape Metrics
  let tapeMetrics;
  if (state && state.tradeWindow.size() > 0) {
    const trades = state.tradeWindow.values();
    tapeMetrics = aggregateTradeTape(
      trades.map((t) => ({
        price: String(t.price),
        qty: String(t.quantity),
        isBuyerMaker: t.side === "SELL",
      }))
    );
  } else {
    tapeMetrics = { buyVolume: 0, sellVolume: 0, delta: 0, makerRatio: 0.5, avgTradeSize: 0, tradeCount: 0 };
  }

  // 3. Kline prices and volumes
  const db = getDb();
  const dbKlines = await db
    .select()
    .from(marketData)
    .where(
      and(
        eq(marketData.symbol, binanceSymbol),
        eq(marketData.timeframe, "1m")
      )
    )
    .orderBy(desc(marketData.timestamp))
    .limit(150)
    .catch(() => []);

  let prices: number[];
  let volumes: number[];
  let highs: number[];
  let lows: number[];

  if (dbKlines.length >= 50) {
    const sorted = [...dbKlines].reverse();
    prices = sorted.map((k) => parseFloat(k.close));
    volumes = sorted.map((k) => parseFloat(k.volume));
    highs = sorted.map((k) => parseFloat(k.high));
    lows = sorted.map((k) => parseFloat(k.low));
  } else {
    try {
      const klines = await fetchKlines(binanceSymbol, "1m", 150);
      prices = klines.map((k) => parseFloat(k.close));
      volumes = klines.map((k) => parseFloat(k.volume));
      highs = klines.map((k) => parseFloat(k.high));
      lows = klines.map((k) => parseFloat(k.low));
    } catch (err: unknown) {
      console.warn(`[signal-router] Failed to fetch klines for ${binanceSymbol} via REST:`, getErrorMessage(err));
      prices = [];
      volumes = [];
      highs = [];
      lows = [];
    }
  }

  // 4. Extra Metrics
  const extraMetrics = state ? {
    sweepScore: state.metrics.sweepScore,
    absorptionScore: state.metrics.absorptionScore,
    volatilityRegime: state.metrics.volatilityRegime,
    bidAskImbalance: state.metrics.bidAskImbalance,
    liquidityRemoved: state.metrics.liquidityRemoved,
    liquidityAdded: state.metrics.liquidityAdded,
  } : undefined;

  return { obMetrics, tapeMetrics, prices, volumes, highs, lows, extraMetrics };
}

// ─── Per-symbol strategy + timing state ───
const symbolStrategyMap = new Map<string, StrategyType>();
const symbolLastAnalyzedAt = new Map<string, number>();

let autoAnalysisTimer: ReturnType<typeof setTimeout> | null = null;
let activeStrategyType: StrategyType = "intraday";
let autoRegimeDetect = true;
let lastRegimeDetectAt = 0;
const REGIME_DETECT_INTERVAL_MS = 60_000;
const MIN_LOOP_MS = 2_000;

// ─── Helper utilities for the Engine ───

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaArray: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emaArray.push(values[i] * k + emaArray[i - 1] * (1 - k));
  }
  return emaArray;
}

function calculateRSI(prices: number[], period = 14): number {
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${round(value / 1_000, 2)}k`;
  return `${round(value, 2)}`;
}

function toAnalysisCandle(row: {
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number | null;
}): AnalysisCandle {
  return {
    timestamp: row.timestamp.getTime(),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
    quoteVolume: parseFloat(row.quoteVolume),
    trades: row.tradeCount ?? 0,
  };
}

function resampleCandles(candles: AnalysisCandle[], timeframe: AnalysisTimeframe, limit: number): AnalysisCandle[] {
  const intervalMs = TIMEFRAME_MS[timeframe];
  if (intervalMs <= TIMEFRAME_MS["1m"] || candles.length === 0) return [];

  const groups = new Map<number, AnalysisCandle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / intervalMs) * intervalMs;
    const group = groups.get(bucket);
    if (group) group.push(candle);
    else groups.set(bucket, [candle]);
  }

  return Array.from(groups.entries())
    .map(([bucket, group]) => {
      const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp);
      return {
        timestamp: bucket,
        open: sorted[0].open,
        high: Math.max(...sorted.map((c) => c.high)),
        low: Math.min(...sorted.map((c) => c.low)),
        close: sorted[sorted.length - 1].close,
        volume: sorted.reduce((sum, c) => sum + c.volume, 0),
        quoteVolume: sorted.reduce((sum, c) => sum + c.quoteVolume, 0),
        trades: sorted.reduce((sum, c) => sum + c.trades, 0),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit);
}

async function loadCandlesFromDb(symbol: string, timeframe: AnalysisTimeframe, limit: number): Promise<AnalysisCandle[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(marketData)
    .where(and(eq(marketData.symbol, symbol), eq(marketData.timeframe, timeframe)))
    .orderBy(desc(marketData.timestamp))
    .limit(limit)
    .catch(() => []);

  return rows.reverse().map(toAnalysisCandle);
}

async function getCandlesForTimeframe(symbol: string, timeframe: AnalysisTimeframe): Promise<AnalysisCandle[]> {
  const limit = TIMEFRAME_LIMITS[timeframe];
  const cached = await loadCandlesFromDb(symbol, timeframe, limit);
  if (cached.length >= Math.min(50, limit)) return cached;

  try {
    const fetched = await fetchKlines(symbol, timeframe, limit);
    const candles = fetched.map((k) => ({
      timestamp: k.openTime,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
      quoteVolume: parseFloat(k.quoteVolume || "0"),
      trades: k.trades || 0,
    }));

    const db = getDb();
    for (const k of fetched.slice(-10)) {
      await db.insert(marketData).values({
        symbol,
        timeframe,
        timestamp: new Date(k.openTime),
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        quoteVolume: k.quoteVolume || "0",
        tradeCount: k.trades || 0,
      }).onConflictDoUpdate({
        target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
        set: {
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
          quoteVolume: k.quoteVolume || "0",
          tradeCount: k.trades || 0,
        },
      }).catch(() => {});
    }

    if (candles.length > 0) return candles;
  } catch (err: unknown) {
    console.warn(`[signal-router] Failed to fetch ${timeframe} klines for ${symbol}:`, getErrorMessage(err));
  }

  if (timeframe !== "1m") {
    const oneMinNeeded = Math.min(Math.ceil(limit * (TIMEFRAME_MS[timeframe] / TIMEFRAME_MS["1m"])), 100_000);
    const oneMin = await loadCandlesFromDb(symbol, "1m", oneMinNeeded);
    const resampled = resampleCandles(oneMin, timeframe, limit);
    if (resampled.length > 0) return resampled;
  }

  return cached;
}

function findSwings(candles: AnalysisCandle[], windowSize = 3): { highs: SwingPoint[]; lows: SwingPoint[] } {
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

function deriveTrend(swHighs: SwingPoint[], swLows: SwingPoint[]): TimeframeStructure["trend"] {
  if (swHighs.length < 2 || swLows.length < 2) return "NEUTRAL";
  const lastHigh = swHighs[swHighs.length - 1].price;
  const prevHigh = swHighs[swHighs.length - 2].price;
  const lastLow = swLows[swLows.length - 1].price;
  const prevLow = swLows[swLows.length - 2].price;
  if (lastHigh > prevHigh && lastLow > prevLow) return "BULLISH";
  if (lastHigh < prevHigh && lastLow < prevLow) return "BEARISH";
  return "NEUTRAL";
}

function analyzeTimeframeStructure(candles: AnalysisCandle[], timeframe: AnalysisTimeframe): TimeframeStructure {
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
    const direction = trend === "BEARISH" ? "BULLISH" : "BULLISH";
    if (trend === "BEARISH") latestChoch = { direction, level: lastHigh.price, timeframe, timestamp: last.timestamp };
    else latestBos = { direction, level: lastHigh.price, timeframe, timestamp: last.timestamp };
  }
  if (lastLow && last.close < lastLow.price) {
    const direction = trend === "BULLISH" ? "BEARISH" : "BEARISH";
    if (trend === "BULLISH") latestChoch = { direction, level: lastLow.price, timeframe, timestamp: last.timestamp };
    else latestBos = { direction, level: lastLow.price, timeframe, timestamp: last.timestamp };
  }

  return {
    trend,
    structure,
    bos: !!latestBos,
    choch: !!latestChoch,
    ema_trend: emaTrend,
    momentum,
    swingHighs,
    swingLows,
    latestBos,
    latestChoch,
  };
}

function detectOrderBlocks(candles: AnalysisCandle[], structure: TimeframeStructure, currentPrice: number): { bullish: OrderBlock[]; bearish: OrderBlock[] } {
  const bullish: OrderBlock[] = [];
  const bearish: OrderBlock[] = [];
  if (candles.length < 10 || !structure.latestBos) return { bullish, bearish };

  const breakIdx = Math.max(1, candles.findIndex((c) => c.timestamp === structure.latestBos?.timestamp));
  const start = breakIdx > 0 ? breakIdx - 1 : candles.length - 2;
  for (let i = start; i >= Math.max(0, start - 10); i--) {
    const candle = candles[i];
    if (structure.latestBos.direction === "BULLISH" && candle.close < candle.open) {
      const status: OrderBlock["status"] =
        currentPrice < candle.low ? "INVALIDATED" :
        currentPrice <= candle.high && currentPrice >= candle.low ? "MITIGATED" : "ACTIVE";
      bullish.push({ high: candle.high, low: candle.low, type: "BULLISH", timestamp: candle.timestamp, status });
      break;
    }
    if (structure.latestBos.direction === "BEARISH" && candle.close > candle.open) {
      const status: OrderBlock["status"] =
        currentPrice > candle.high ? "INVALIDATED" :
        currentPrice <= candle.high && currentPrice >= candle.low ? "MITIGATED" : "ACTIVE";
      bearish.push({ high: candle.high, low: candle.low, type: "BEARISH", timestamp: candle.timestamp, status });
      break;
    }
  }
  return { bullish, bearish };
}

function detectFVGs(candles: AnalysisCandle[]): { bullish: FVG[]; bearish: FVG[] } {
  const bullish: FVG[] = [];
  const bearish: FVG[] = [];
  if (candles.length < 3) return { bullish, bearish };

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];
    const later = candles.slice(i + 2);
    if (next.low > prev.high) {
      const low = prev.high;
      const high = next.low;
      bullish.push({
        low,
        high,
        type: "BULLISH",
        timestamp: candles[i].timestamp,
        filled: later.some((c) => c.low <= low),
      });
    }
    if (next.high < prev.low) {
      const low = next.high;
      const high = prev.low;
      bearish.push({
        low,
        high,
        type: "BEARISH",
        timestamp: candles[i].timestamp,
        filled: later.some((c) => c.high >= high),
      });
    }
  }
  return { bullish, bearish };
}

function nearestOrderBlock(obs: OrderBlock[], currentPrice: number): AnalysisResult["order_blocks"]["nearest_ob"] {
  const active = obs.filter((ob) => ob.status !== "INVALIDATED");
  if (!currentPrice || active.length === 0) return undefined;
  const nearest = active.reduce((best, next) => {
    const bestMid = (best.high + best.low) / 2;
    const nextMid = (next.high + next.low) / 2;
    return Math.abs(nextMid - currentPrice) < Math.abs(bestMid - currentPrice) ? next : best;
  });
  const mid = (nearest.high + nearest.low) / 2;
  return { type: nearest.type, distance_percent: round(Math.abs(mid - currentPrice) / currentPrice * 100, 2) };
}

function nearestFvg(fvgs: FVG[], currentPrice: number): AnalysisResult["fvg"]["nearest_fvg"] {
  const active = fvgs.filter((f) => !f.filled);
  if (!currentPrice || active.length === 0) return undefined;
  const nearest = active.reduce((best, next) => {
    const bestMid = (best.high + best.low) / 2;
    const nextMid = (next.high + next.low) / 2;
    return Math.abs(nextMid - currentPrice) < Math.abs(bestMid - currentPrice) ? next : best;
  });
  return { type: nearest.type };
}

function buildVolumeProfile(candles: AnalysisCandle[], currentPrice: number): AnalysisResult["volume_profile"] {
  if (candles.length === 0 || currentPrice <= 0) {
    return { poc: 0, vah: 0, val: 0, current_position: "AT_POC", implication: "NEUTRAL" };
  }

  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { poc: currentPrice, vah: currentPrice, val: currentPrice, current_position: "AT_POC", implication: "NEUTRAL" };
  }

  const binCount = Math.min(100, Math.max(20, candles.length));
  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    low: min + i * step,
    high: min + (i + 1) * step,
    volume: 0,
  }));

  for (const candle of candles) {
    const range = Math.max(candle.high - candle.low, step);
    for (const bin of bins) {
      const overlap = Math.min(bin.high, candle.high) - Math.max(bin.low, candle.low);
      if (overlap > 0) bin.volume += candle.volume * (overlap / range);
    }
  }

  const pocIdx = bins.reduce((bestIdx, bin, idx) => bin.volume > bins[bestIdx].volume ? idx : bestIdx, 0);
  const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
  const targetVolume = totalVolume * 0.7;
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let accumulated = bins[pocIdx].volume;

  while (accumulated < targetVolume && (lowIdx > 0 || highIdx < bins.length - 1)) {
    const below = bins[lowIdx - 1]?.volume ?? -1;
    const above = bins[highIdx + 1]?.volume ?? -1;
    if (above >= below && highIdx < bins.length - 1) {
      highIdx++;
      accumulated += bins[highIdx].volume;
    } else if (lowIdx > 0) {
      lowIdx--;
      accumulated += bins[lowIdx].volume;
    } else {
      break;
    }
  }

  const poc = (bins[pocIdx].low + bins[pocIdx].high) / 2;
  const vah = bins[highIdx].high;
  const val = bins[lowIdx].low;
  const currentPosition =
    Math.abs(currentPrice - poc) / poc < 0.003 ? "AT_POC" :
    currentPrice > poc ? "ABOVE_POC" : "BELOW_POC";
  const implication = currentPosition === "ABOVE_POC" ? "BULLISH" :
    currentPosition === "BELOW_POC" ? "BEARISH" : "NEUTRAL";

  return {
    poc: round(poc, 6),
    vah: round(vah, 6),
    val: round(val, 6),
    current_position: currentPosition,
    implication,
  };
}

function analyzeVolumeFromCandles(candles: AnalysisCandle[]): AnalysisResult["volume"] {
  if (candles.length < 20) {
    return {
      relative_volume: 1,
      accumulation: false,
      distribution: false,
      climax_volume: false,
      volume_score: { bullish: 5, bearish: 5 },
    };
  }

  const last = candles[candles.length - 1];
  const recent = candles.slice(-20);
  const avgVolume = recent.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / Math.max(1, recent.length - 1);
  const relativeVolume = avgVolume > 0 ? last.volume / avgVolume : 1;
  const last5 = candles.slice(-5);
  const priceDown = last5[last5.length - 1].close < last5[0].close;
  const priceUp = last5[last5.length - 1].close > last5[0].close;
  const volumeExpanding = last5.every((c, i) => i === 0 || c.volume >= last5[i - 1].volume * 0.9);
  const closesNearHighs = last5.filter((c) => c.high > c.low && (c.close - c.low) / (c.high - c.low) > 0.6).length >= 3;
  const closesNearLows = last5.filter((c) => c.high > c.low && (c.high - c.close) / (c.high - c.low) > 0.6).length >= 3;
  const accumulation = priceDown && volumeExpanding && closesNearHighs;
  const distribution = priceUp && volumeExpanding && closesNearLows;
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const climax = relativeVolume > 3 && range > 0 && body / range > 0.6;

  let bullish = 5;
  let bearish = 5;
  if (accumulation) { bullish += 3; bearish -= 1; }
  if (distribution) { bearish += 3; bullish -= 1; }
  if (relativeVolume > 2 && last.close > last.open) bullish += 1;
  if (relativeVolume > 2 && last.close < last.open) bearish += 1;
  if (climax && last.close < last.open) bullish += 1;
  if (climax && last.close > last.open) bearish += 1;

  return {
    relative_volume: round(relativeVolume, 2),
    accumulation,
    distribution,
    climax_volume: climax,
    volume_score: { bullish: clamp(Math.round(bullish), 0, 10), bearish: clamp(Math.round(bearish), 0, 10) },
  };
}

async function analyzeOpenInterest(symbol: string, currentPrice: number, previousPrice: number): Promise<AnalysisResult["open_interest"]> {
  const state = marketStateManager.get(symbol);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const db = getDb();
  const rows = await db
    .select()
    .from(openInterestData)
    .where(and(eq(openInterestData.symbol, symbol), gte(openInterestData.timestamp, since)))
    .orderBy(desc(openInterestData.timestamp))
    .limit(2880)
    .catch(() => []);

  let samples = rows.reverse().map((row) => ({
    openInterest: parseFloat(row.openInterest),
    timestamp: row.timestamp.getTime(),
  }));
  const memorySamples = state?.openInterestWindow.values() ?? [];
  if (memorySamples.length > samples.length) samples = memorySamples;

  if (samples.length === 0) {
    try {
      const oi = await fetchOpenInterest(symbol);
      const value = parseFloat(oi.openInterest);
      if (Number.isFinite(value) && value > 0) {
        marketStateManager.updateOpenInterest(symbol, { openInterest: value, timestamp: oi.time || Date.now() });
        samples = [{ openInterest: value, timestamp: oi.time || Date.now() }];
      }
    } catch {
      // REST is optional for this query; return UNKNOWN when unavailable.
    }
  }

  const current = samples[samples.length - 1]?.openInterest ?? state?.latestOpenInterest?.openInterest ?? 0;
  const previous = samples[0]?.openInterest ?? current;
  const oiChangePct = previous > 0 ? (current - previous) / previous * 100 : 0;
  const priceChangePct = previousPrice > 0 ? (currentPrice - previousPrice) / previousPrice * 100 : 0;

  let interpretation: AnalysisResult["open_interest"]["interpretation"] = "UNKNOWN";
  if (priceChangePct > 0.1 && oiChangePct > 0.5) interpretation = "NEW_LONGS";
  else if (priceChangePct < -0.1 && oiChangePct > 0.5) interpretation = "NEW_SHORTS";
  else if (priceChangePct > 0.1 && oiChangePct < -0.5) interpretation = "SHORT_COVERING";
  else if (priceChangePct < -0.1 && oiChangePct < -0.5) interpretation = "LONG_LIQUIDATION";

  const conviction: AnalysisResult["open_interest"]["conviction"] =
    Math.abs(oiChangePct) >= 5 ? "HIGH" :
    Math.abs(oiChangePct) >= 2 ? "MEDIUM" : "LOW";

  return {
    current: formatCompact(current),
    change_24h: { percent: round(oiChangePct, 2) },
    interpretation,
    conviction,
  };
}

async function analyzeFunding(symbol: string): Promise<AnalysisResult["funding"]> {
  const state = marketStateManager.get(symbol);
  let rate = state?.latestFunding?.fundingRate;

  if (rate === undefined) {
    const db = getDb();
    const [latest] = await db
      .select()
      .from(fundingRateHistory)
      .where(eq(fundingRateHistory.symbol, symbol))
      .orderBy(desc(fundingRateHistory.timestamp))
      .limit(1)
      .catch(() => []);
    if (latest) rate = parseFloat(latest.fundingRate);
  }

  rate = rate ?? 0;
  const sentiment = rate > 0.0001 ? "LONG_HEAVY" : rate < -0.0001 ? "SHORT_HEAVY" : "NEUTRAL";
  const squeezeRisk = rate > 0.001 ? "LONG_SQUEEZE" : rate < -0.001 ? "SHORT_SQUEEZE" : "NONE";
  return {
    current: `${(rate * 100).toFixed(4)}%`,
    sentiment,
    squeeze_risk: squeezeRisk,
  };
}

async function getLiquidationStats(symbol: string): Promise<{ longQty: number; shortQty: number; longNotional: number; shortNotional: number; count: number }> {
  const sinceMs = Date.now() - 15 * 60_000;
  const state = marketStateManager.get(symbol);
  const memory = state?.liquidationWindow.values().filter((liq) => liq.timestamp >= sinceMs) ?? [];
  if (memory.length > 0) {
    return memory.reduce((acc, liq) => {
      const notional = liq.price * liq.quantity;
      if (liq.side === "SELL") {
        acc.longQty += liq.quantity;
        acc.longNotional += notional;
      } else {
        acc.shortQty += liq.quantity;
        acc.shortNotional += notional;
      }
      acc.count++;
      return acc;
    }, { longQty: 0, shortQty: 0, longNotional: 0, shortNotional: 0, count: 0 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(liquidationEvents)
    .where(and(eq(liquidationEvents.symbol, symbol), gte(liquidationEvents.tradeTime, new Date(sinceMs))))
    .orderBy(desc(liquidationEvents.tradeTime))
    .limit(500)
    .catch(() => []);

  return rows.reduce((acc, row) => {
    const quantity = parseFloat(row.quantity);
    const price = parseFloat(row.price);
    const notional = quantity * price;
    if (row.side === "SELL") {
      acc.longQty += quantity;
      acc.longNotional += notional;
    } else {
      acc.shortQty += quantity;
      acc.shortNotional += notional;
    }
    acc.count++;
    return acc;
  }, { longQty: 0, shortQty: 0, longNotional: 0, shortNotional: 0, count: 0 });
}

async function analyzeCvd(symbol: string, candles: AnalysisCandle[]): Promise<AnalysisResult["cvd"]> {
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

function findLastLiquiditySweep(candles: AnalysisCandle[], buySide: number[], sellSide: number[]): AnalysisResult["liquidity"]["last_sweep"] {
  if (candles.length < 5) return undefined;
  for (const candle of candles.slice(-5).reverse()) {
    const sweptBuy = buySide.find((level) => candle.high > level && candle.close < level);
    if (sweptBuy) return { side: "BUY_SIDE", level: sweptBuy, confirmed: candle.volume > 0 };
    const sweptSell = sellSide.find((level) => candle.low < level && candle.close > level);
    if (sweptSell) return { side: "SELL_SIDE", level: sweptSell, confirmed: candle.volume > 0 };
  }
  return undefined;
}

function scoreSignalsForAnalysis(params: {
  overallBias: AnalysisResult["market_structure"]["overall_bias"];
  mtf: AnalysisResult["multi_timeframe"];
  liquidity: AnalysisResult["liquidity"];
  nearestOB: AnalysisResult["order_blocks"]["nearest_ob"];
  nearestFVG: AnalysisResult["fvg"]["nearest_fvg"];
  volume: AnalysisResult["volume"];
  openInterest: AnalysisResult["open_interest"];
  funding: AnalysisResult["funding"];
  cvd: AnalysisResult["cvd"];
  orderbook: AnalysisResult["orderbook"];
  liquidations: Awaited<ReturnType<typeof getLiquidationStats>>;
}): AnalysisResult["signals"] {
  let reversalConfidence = params.liquidity.probability_of_reversal * 0.35;
  if (params.cvd.trend === "BULLISH_DIVERGENCE" || params.cvd.trend === "BEARISH_DIVERGENCE") reversalConfidence += 30;
  if (params.nearestOB && params.nearestOB.distance_percent < 1) reversalConfidence += 15;
  if (params.nearestFVG) reversalConfidence += 8;
  if (params.volume.climax_volume) reversalConfidence += 8;
  if (params.liquidations.longNotional > params.liquidations.shortNotional * 1.5 || params.liquidations.shortNotional > params.liquidations.longNotional * 1.5) reversalConfidence += 8;

  // Gate continuation scoring: neutral bias means no directional conviction
  const alignedTfs = params.overallBias !== "NEUTRAL"
    ? Object.values(params.mtf).filter((tf) => tf.trend === params.overallBias).length
    : 0;
  let continuationConfidence = alignedTfs * 12;
  if (params.cvd.trend === "CONTINUATION") continuationConfidence += 18;
  if (params.volume.relative_volume > 1.5) continuationConfidence += 10;
  if (
    (params.overallBias === "BULLISH" && params.orderbook.dominant_side === "BUYERS") ||
    (params.overallBias === "BEARISH" && params.orderbook.dominant_side === "SELLERS")
  ) continuationConfidence += 10;
  if (
    (params.overallBias === "BULLISH" && ["NEW_LONGS", "SHORT_COVERING"].includes(params.openInterest.interpretation)) ||
    (params.overallBias === "BEARISH" && ["NEW_SHORTS", "LONG_LIQUIDATION"].includes(params.openInterest.interpretation))
  ) continuationConfidence += 10;

  const squeezeType = params.funding.squeeze_risk;
  const squeezeConfidence = squeezeType === "NONE" ? 0 :
    50 + (params.openInterest.conviction === "HIGH" ? 25 : params.openInterest.conviction === "MEDIUM" ? 12 : 0);

  const accumulationConfidence = params.volume.accumulation ? 65 :
    params.cvd.trend === "BULLISH_DIVERGENCE" && params.liquidity.last_sweep?.side === "SELL_SIDE" ? 72 : 0;

  return {
    reversal: { detected: reversalConfidence >= 55, confidence: clamp(Math.round(reversalConfidence)) },
    continuation: { detected: continuationConfidence >= 55, confidence: clamp(Math.round(continuationConfidence)) },
    squeeze: squeezeType !== "NONE" ? { type: squeezeType, confidence: clamp(Math.round(squeezeConfidence)) } : undefined,
    accumulation: { detected: accumulationConfidence >= 55, confidence: clamp(Math.round(accumulationConfidence)) },
  };
}

function buildTradeSetup(params: {
  currentPrice: number;
  overallBias: AnalysisResult["market_structure"]["overall_bias"];
  signals: AnalysisResult["signals"];
  swingHighs: number[];
  swingLows: number[];
}): AnalysisResult["trade_setup"] {
  const { currentPrice, overallBias, signals, swingHighs, swingLows } = params;
  if (currentPrice <= 0) return undefined;

  const useReversal = signals.reversal.detected && signals.reversal.confidence >= signals.continuation.confidence;
  const useContinuation = signals.continuation.detected;
  if (!useReversal && !useContinuation) return undefined;

  const longSetup = useReversal ? overallBias === "BEARISH" : overallBias === "BULLISH";
  const setupType: NonNullable<AnalysisResult["trade_setup"]>["setup_type"] = useReversal
    ? longSetup ? "COUNTER_TREND_LONG" : "COUNTER_TREND_SHORT"
    : longSetup ? "CONTINUATION_LONG" : "CONTINUATION_SHORT";

  const lowsBelow = swingLows.filter((level) => level < currentPrice).sort((a, b) => b - a);
  const highsAbove = swingHighs.filter((level) => level > currentPrice).sort((a, b) => a - b);
  const stopLoss = longSetup
    ? (lowsBelow[0] ?? currentPrice * 0.985)
    : (highsAbove[0] ?? currentPrice * 1.015);
  const targets = longSetup
    ? (highsAbove.length > 0 ? highsAbove.slice(0, 3) : [currentPrice * 1.015, currentPrice * 1.03])
    : (lowsBelow.length > 0 ? lowsBelow.slice(0, 3) : [currentPrice * 0.985, currentPrice * 0.97]);

  const risk = Math.abs(currentPrice - stopLoss);
  const reward = Math.abs((targets[0] ?? currentPrice) - currentPrice);
  const confidence = useReversal ? signals.reversal.confidence : signals.continuation.confidence;

  return {
    setup_type: setupType,
    entry_zone: {
      low: round(currentPrice * 0.9975, 6),
      high: round(currentPrice * 1.0025, 6),
    },
    stop_loss: round(stopLoss, 6),
    targets: targets.map((target) => round(target, 6)),
    risk_reward: risk > 0 ? round(reward / risk, 2) : 0,
    confidence,
    invalidation: longSetup ? `close_below_${round(stopLoss, 6)}` : `close_above_${round(stopLoss, 6)}`,
  };
}

// ─── Signal evaluator — routes to correct strategy evaluator for a symbol ───
function evaluateSymbolSignal(
  coindcxSymbol: string,
  strategy: StrategyType,
  currentPrice: number,
  prices: number[],
  volumes: number[],
  highs: number[],
  lows: number[],
  obMetrics: ReturnType<typeof aggregateOrderBookMetrics>,
  tapeMetrics: ReturnType<typeof aggregateTradeTape>,
  extraMetrics?: ConfluenceExtraMetrics
): typeof signals.$inferInsert {
  const config = STRATEGY_CONFIGS[strategy];

  if (strategy === "grid") {
    const res = evaluateGridStrategy(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: String(res.score), intraScore: "50.00", swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "momentum_reversal") {
    const res = evaluateMomentumReversal(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: String(res.score), swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "bb_reversion") {
    const res = evaluateBBReversion(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: "50.00", swingScore: String(res.score), compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "ml_sizing") {
    const res = evaluateMLSizing(currentPrice, prices, highs, lows, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: String(res.score), swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "scalping_micro") {
    const res = evaluateScalpingMicro(currentPrice, obMetrics, tapeMetrics, config.threshold);
    return { symbol: coindcxSymbol, microScore: String(res.score), intraScore: "50.00", swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }

  const analysis = analyzeConfluence(
    coindcxSymbol,
    obMetrics,
    tapeMetrics,
    prices,
    volumes,
    extraMetrics,
    config.weights,
    config.threshold
  );

  return {
    symbol: coindcxSymbol,
    microScore: String(analysis.microScore),
    intraScore: String(analysis.intraScore),
    swingScore: String(analysis.swingScore),
    compositeScore: String(analysis.compositeScore),
    threshold: String(analysis.threshold),
    isGated: analysis.isGated,
    direction: analysis.direction,
    metadata: { ...analysis.indicators, strategy },
  };
}

async function runAutoAnalysis() {
  const now = Date.now();

  if (autoRegimeDetect && now - lastRegimeDetectAt >= REGIME_DETECT_INTERVAL_MS) {
    lastRegimeDetectAt = now;
    const regimeResults = await Promise.allSettled(
      SUPPORTED_PAIRS.map((pair) => detectRegimeForSymbol(pair.binance))
    );

    regimeResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const pair = SUPPORTED_PAIRS[i];
        const prev = symbolStrategyMap.get(pair.binance);
        const next = result.value.strategy;
        latestRegimeCache.set(pair.binance, result.value);
        symbolStrategyMap.set(pair.binance, next);

        if (prev && prev !== next) {
          console.log(`[regime] ${pair.binance}: ${prev} → ${next} (${result.value.regime})`);
          signalEvents.emit("strategy-switch", {
            symbol: pair.binance,
            from: prev,
            to: next,
            regime: result.value.regime,
            reason: result.value.reason,
          });
        } else if (!prev) {
          console.log(`[regime] ${pair.binance}: initial strategy = ${next} (${result.value.regime})`);
        }
      }
    });
  }

  const batchSignals: typeof signals.$inferSelect[] = [];
  try {
    const db = getDb();

    for (const pair of SUPPORTED_PAIRS) {
      const strategy = autoRegimeDetect
        ? (symbolStrategyMap.get(pair.binance) ?? activeStrategyType)
        : activeStrategyType;

      const config = STRATEGY_CONFIGS[strategy];

      const lastAt = symbolLastAnalyzedAt.get(pair.binance) ?? 0;
      if (now - lastAt < config.signalIntervalMs) continue;
      symbolLastAnalyzedAt.set(pair.binance, now);

      try {
        const { obMetrics, tapeMetrics, prices, volumes, highs, lows, extraMetrics } = await getConfluenceInput(pair.binance);
        const currentPrice = prices[prices.length - 1] || 0;

        let knnSnapshot: KnnSupertrendSnapshot | null = null;
        if (prices.length >= 30 && highs.length >= 30 && lows.length >= 30) {
          try {
            knnSnapshot = computeKnnSupertrend(pair.binance, "1m", prices, highs, lows, volumes);
          } catch (knnErr) {
            console.warn(`[knn] compute failed for ${pair.binance}:`, knnErr);
          }
        }

        const signalData = evaluateSymbolSignal(
          pair.coindcx, strategy, currentPrice,
          prices, volumes, highs, lows,
          obMetrics, tapeMetrics, extraMetrics
        );

        if (knnSnapshot) {
          signalData.metadata = {
            ...(signalData.metadata as Record<string, unknown> ?? {}),
            knn: {
              bias: knnSnapshot.knn.bias,
              confidence: knnSnapshot.knn.confidence,
              agreement: knnSnapshot.knn.agreement,
              neighbors: knnSnapshot.knn.neighbors,
              stDirection: knnSnapshot.supertrend.direction,
              stLevel: knnSnapshot.supertrend.level,
              stFlip: knnSnapshot.supertrend.flip,
              regime: knnSnapshot.regime,
              entryAllowed: knnSnapshot.entryAllowed,
              setupQuality: knnSnapshot.setupQuality,
              rejectionSignal: knnSnapshot.rejection.signal,
              rejectionType: knnSnapshot.rejection.type,
              wickToBody: knnSnapshot.rejection.wickToBody,
              volumeScore: knnSnapshot.rejection.volumeScore,
              note: knnSnapshot.note,
            },
          };
        }

        const inserted = await db.insert(signals).values(signalData).returning().catch(() => []);
        if (inserted[0]) {
          batchSignals.push(inserted[0]);
          if (knnSnapshot) signalEvents.emit("knn-snapshot", { symbol: pair.binance, snapshot: knnSnapshot });
        }
      } catch (err) {
        console.error(`[signal-router] Analysis failed for ${pair.binance}:`, err);
      }
    }

    if (batchSignals.length > 0) {
      signalEvents.emit("update");
      globalAutoExecutor.onSignalBatch(batchSignals).catch((err) =>
        console.error("[auto-executor] Batch error:", err)
      );
    }
  } catch (err) {
    console.error("[signal-router] Loop error:", err);
  }

  autoAnalysisTimer = setTimeout(runAutoAnalysis, MIN_LOOP_MS);
}

async function bootstrapHistoricalKlines() {
  console.log("[signal-router] Bootstrapping historical klines for supported pairs...");
  const db = getDb();
  for (const pair of SUPPORTED_PAIRS) {
    try {
      const existing = await db
        .select({ id: marketData.id })
        .from(marketData)
        .where(
          and(
            eq(marketData.symbol, pair.binance),
            eq(marketData.timeframe, "1m")
          )
        )
        .limit(50)
        .catch(() => []);

      if (existing.length < 50) {
        console.log(`[signal-router] Fetching historical klines for ${pair.binance} via REST to bootstrap DB...`);
        const klines = await fetchKlines(pair.binance, "1m", 150);
        for (const k of klines) {
          await db.insert(marketData).values({
            symbol: pair.binance,
            timeframe: "1m",
            timestamp: new Date(k.openTime || k.closeTime || Date.now()),
            open: String(k.open),
            high: String(k.high),
            low: String(k.low),
            close: String(k.close),
            volume: String(k.volume),
            quoteVolume: String(k.quoteVolume || "0"),
            tradeCount: k.trades || 0,
          }).onConflictDoUpdate({
            target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
            set: {
              open: String(k.open),
              high: String(k.high),
              low: String(k.low),
              close: String(k.close),
              volume: String(k.volume),
              quoteVolume: String(k.quoteVolume || "0"),
              tradeCount: k.trades || 0,
            }
          }).catch(() => {});
        }
      }
    } catch (err: unknown) {
      console.warn(`[signal-router] Failed to bootstrap klines for ${pair.binance}:`, getErrorMessage(err));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log("[signal-router] Historical klines bootstrapping completed.");
}

export function startAutoAnalysis(strategyType: StrategyType = "intraday", autoSwitch?: boolean) {
  if (autoSwitch !== undefined) autoRegimeDetect = autoSwitch;

  if (autoAnalysisTimer) {
    if (activeStrategyType === strategyType && autoSwitch === undefined) return;
    clearTimeout(autoAnalysisTimer);
    autoAnalysisTimer = null;
  }

  activeStrategyType = strategyType;

  bootstrapHistoricalKlines().catch((err) => {
    console.error("[signal-router] Bootstrapping failed:", err);
  });

  for (const pair of SUPPORTED_PAIRS) {
    subscribeToSymbol(pair.binance);
  }

  const mode = autoRegimeDetect ? "per-symbol-regime" : "fixed";
  console.log(`[signal-router] Starting auto-analysis mode=${mode} fallback=${strategyType} loop=${MIN_LOOP_MS}ms`);
  runAutoAnalysis();
}

export const signalRouter = createRouter({
  // ─── Get latest signals ───
  latest: publicQuery
    .input(
      z.object({
        symbol: z.string().optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      if (input.symbol) {
        return db
          .select()
          .from(signals)
          .where(eq(signals.symbol, input.symbol))
          .orderBy(desc(signals.createdAt))
          .limit(1);
      }
      const result = await db.execute(sql`
        SELECT DISTINCT ON (symbol) *
        FROM signals
        ORDER BY symbol, created_at DESC
      `);

      type LatestSignalRow = {
        id: number;
        symbol: string;
        micro_score: string;
        intra_score: string;
        swing_score: string;
        composite_score: string;
        threshold: string;
        is_gated: boolean;
        direction: "long" | "short" | "neutral";
        metadata: unknown;
        created_at: Date;
      };

      return Array.from(result as Iterable<LatestSignalRow>).map((r) => ({
        id: r.id,
        symbol: r.symbol,
        microScore: r.micro_score,
        intraScore: r.intra_score,
        swingScore: r.swing_score,
        compositeScore: r.composite_score,
        threshold: r.threshold,
        isGated: r.is_gated,
        direction: r.direction,
        metadata: r.metadata,
        createdAt: r.created_at,
      })) as typeof signals.$inferSelect[];
    }),

  // ─── Get gated signals only ───
  gated: publicQuery
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(signals)
        .where(eq(signals.isGated, true))
        .orderBy(desc(signals.createdAt))
        .limit(input.limit);
    }),

  // ─── Institutional Level Structured Query ───
  comprehensiveAnalysis: publicQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
      })
    )
    .query(async ({ input }): Promise<AnalysisResult> => {
      const binanceSymbol = input.symbol.toUpperCase();
      const state = marketStateManager.get(binanceSymbol);
      const nowStr = new Date().toISOString();

      const candleEntries = await Promise.all(
        ANALYSIS_TIMEFRAMES.map(async (tf) => [tf, await getCandlesForTimeframe(binanceSymbol, tf)] as const)
      );
      const candlesByTf = new Map<AnalysisTimeframe, AnalysisCandle[]>(candleEntries);
      const oneMinCandles = candlesByTf.get("1m") ?? [];
      const h1Candles = candlesByTf.get("1h") ?? [];
      const primaryCandles = oneMinCandles.length >= 20 ? oneMinCandles : (h1Candles.length >= 20 ? h1Candles : (candlesByTf.get("5m") ?? []));
      const currentPrice = state?.ltp || primaryCandles[primaryCandles.length - 1]?.close || 0;
      // For OI interpretation: compare price against 24h ago, not oldest candle in buffer
      const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
      const h1Candle24h = h1Candles.length > 0
        ? h1Candles.reduce((best, c) => Math.abs(c.timestamp - oneDayAgoMs) < Math.abs(best.timestamp - oneDayAgoMs) ? c : best)
        : null;
      const previousPrice = h1Candle24h?.close || primaryCandles[0]?.close || currentPrice;

      const structureByTf = new Map<AnalysisTimeframe, TimeframeStructure>();
      const mtf: AnalysisResult["multi_timeframe"] = {};
      for (const tf of ANALYSIS_TIMEFRAMES) {
        const tfStructure = analyzeTimeframeStructure(candlesByTf.get(tf) ?? [], tf);
        structureByTf.set(tf, tfStructure);
        mtf[tf] = {
          trend: tfStructure.trend,
          structure: tfStructure.structure,
          bos: tfStructure.bos,
          choch: tfStructure.choch,
          ema_trend: tfStructure.ema_trend,
          momentum: tfStructure.momentum,
        };
      }

      const tfWeights: Record<AnalysisTimeframe, number> = { "1d": 5, "4h": 4, "1h": 3, "15m": 2, "5m": 1, "1m": 0.5 };
      let bullishScore = 0;
      let bearishScore = 0;
      for (const [tf, tfStructure] of structureByTf) {
        if (tfStructure.trend === "BULLISH") bullishScore += tfWeights[tf];
        if (tfStructure.trend === "BEARISH") bearishScore += tfWeights[tf];
        if (tfStructure.ema_trend === "BULLISH") bullishScore += tfWeights[tf] * 0.35;
        if (tfStructure.ema_trend === "BEARISH") bearishScore += tfWeights[tf] * 0.35;
      }

      const overallBias: AnalysisResult["market_structure"]["overall_bias"] =
        bullishScore > bearishScore ? "BULLISH" :
        bearishScore > bullishScore ? "BEARISH" : "NEUTRAL";
      const structureTotal = bullishScore + bearishScore;
      const confidence = structureTotal > 0 ? Math.round(Math.max(bullishScore, bearishScore) / structureTotal * 100) : 50;
      const structScore = {
        bullish: Math.round(bullishScore),
        bearish: Math.round(bearishScore),
      };

      const allSwingHighs = Array.from(structureByTf.values()).flatMap((tf) => tf.swingHighs);
      const allSwingLows = Array.from(structureByTf.values()).flatMap((tf) => tf.swingLows);
      const swingHighPrices = Array.from(new Set(allSwingHighs.map((h) => round(h.price, 6)))).sort((a, b) => a - b);
      const swingLowPrices = Array.from(new Set(allSwingLows.map((l) => round(l.price, 6)))).sort((a, b) => b - a);
      const buySideL = swingHighPrices.filter((level) => level > currentPrice).slice(0, 8);
      const sellSideL = swingLowPrices.filter((level) => level < currentPrice).slice(0, 8);
      const lastSweep = findLastLiquiditySweep(primaryCandles, buySideL, sellSideL);
      const latestBos = Array.from(structureByTf.values()).flatMap((tf) => tf.latestBos ? [tf.latestBos] : []).sort((a, b) => b.timestamp - a.timestamp)[0];
      const latestChoch = Array.from(structureByTf.values()).flatMap((tf) => tf.latestChoch ? [tf.latestChoch] : []).sort((a, b) => b.timestamp - a.timestamp)[0];

      const allBullishObs: OrderBlock[] = [];
      const allBearishObs: OrderBlock[] = [];
      for (const tf of ["4h", "1h", "15m", "5m"] as AnalysisTimeframe[]) {
        const detected = detectOrderBlocks(candlesByTf.get(tf) ?? [], structureByTf.get(tf)!, currentPrice);
        allBullishObs.push(...detected.bullish);
        allBearishObs.push(...detected.bearish);
      }
      const activeObs = [...allBullishObs, ...allBearishObs].filter((ob) => ob.status !== "INVALIDATED");
      const nearestOB = nearestOrderBlock(activeObs, currentPrice);

      const h1Fvgs = detectFVGs(h1Candles.length >= 20 ? h1Candles : primaryCandles);
      const fvgsBull = h1Fvgs.bullish.filter((f) => !f.filled).slice(-10);
      const fvgsBear = h1Fvgs.bearish.filter((f) => !f.filled).slice(-10);
      const nearestFVG = nearestFvg([...fvgsBull, ...fvgsBear], currentPrice);

      const volume = analyzeVolumeFromCandles((candlesByTf.get("15m") ?? []).length >= 20 ? candlesByTf.get("15m")! : primaryCandles);
      const cvd = await analyzeCvd(binanceSymbol, primaryCandles);
      const openInterest = await analyzeOpenInterest(binanceSymbol, currentPrice, previousPrice);
      const funding = await analyzeFunding(binanceSymbol);
      const liquidations = await getLiquidationStats(binanceSymbol);

      const obMetrics = state?.orderBook ? {
        bidDepth: state.orderBook.bids.slice(0, 50).reduce((sum, [, qty]) => sum + qty, 0),
        askDepth: state.orderBook.asks.slice(0, 50).reduce((sum, [, qty]) => sum + qty, 0),
      } : (await getConfluenceInput(binanceSymbol)).obMetrics;
      const bidVolVal = obMetrics.bidDepth;
      const askVolVal = obMetrics.askDepth;
      const obRatio = askVolVal > 0 ? bidVolVal / askVolVal : 1.0;
      const obDominant = obRatio > 1.2 ? "BUYERS" as const : obRatio < 0.83 ? "SELLERS" as const : "NEUTRAL" as const;
      const orderbook: AnalysisResult["orderbook"] = {
        imbalance: {
          bid_volume: formatCompact(bidVolVal),
          ask_volume: formatCompact(askVolVal),
        },
        ratio: round(obRatio, 2),
        dominant_side: obDominant,
        absorption: state ? state.metrics.absorptionScore > 75 : false,
        spoofing: state ? state.metrics.liquidityRemoved > state.metrics.liquidityAdded * 2 && state.metrics.liquidityRemoved > 0 : false,
      };

      const reversalBase = lastSweep
        ? 58 + (lastSweep.confirmed ? 12 : 0) + (cvd.trend.includes("DIVERGENCE") ? 15 : 0)
        : state ? Math.round(state.metrics.absorptionScore * 0.8) : 0;
      const liquidity: AnalysisResult["liquidity"] = {
        buy_side: buySideL,
        sell_side: sellSideL,
        last_sweep: lastSweep,
        liquidity_event: lastSweep ? {
          type: "LIQUIDITY_GRAB",
          strength: reversalBase >= 75 ? "HIGH" : reversalBase >= 55 ? "MEDIUM" : "LOW",
        } : undefined,
        probability_of_reversal: clamp(Math.round(reversalBase)),
      };

      const volumeProfile = buildVolumeProfile(h1Candles.length >= 20 ? h1Candles : primaryCandles, currentPrice);
      const signalsActive = scoreSignalsForAnalysis({
        overallBias,
        mtf,
        liquidity,
        nearestOB,
        nearestFVG,
        volume,
        openInterest,
        funding,
        cvd,
        orderbook,
        liquidations,
      });

      const setup = buildTradeSetup({
        currentPrice,
        overallBias,
        signals: signalsActive,
        swingHighs: swingHighPrices,
        swingLows: swingLowPrices,
      });

      const recommendedAction: AnalysisResult["summary"]["recommended_action"] =
        setup && setup.confidence >= 65 ? "TAKE_POSITION" :
        signalsActive.reversal.detected || signalsActive.continuation.detected ? "WAIT_FOR_CONFIRMATION" :
        "NO_TRADE";
      const phase: AnalysisResult["summary"]["market_phase"] =
        signalsActive.accumulation.detected ? "ACCUMULATION" :
        volume.distribution ? "DISTRIBUTION" :
        signalsActive.continuation.detected ? "TRENDING" : "RANGING";
      const verdict = `${binanceSymbol} bias is ${overallBias} (${confidence}% structure confidence). OI: ${openInterest.interpretation}, funding: ${funding.sentiment}, CVD: ${cvd.trend}. Action: ${recommendedAction}.`;

      return {
        symbol: binanceSymbol,
        exchange: "BINANCE_FUTURES",
        timestamp: nowStr,
        market_state: { regime: overallBias, confidence },
        multi_timeframe: mtf,
        market_structure: {
          overall_bias: overallBias,
          swing_highs: swingHighPrices.slice(-8),
          swing_lows: swingLowPrices.slice(-8),
          latest_bos: latestBos ? { direction: latestBos.direction, level: latestBos.level } : undefined,
          latest_choch: latestChoch ? { direction: latestChoch.direction, level: latestChoch.level, timeframe: latestChoch.timeframe } : undefined,
          structure_score: structScore,
        },
        liquidity,
        order_blocks: {
          bullish: allBullishObs.slice(-10),
          bearish: allBearishObs.slice(-10),
          nearest_ob: nearestOB,
        },
        fvg: {
          bullish: fvgsBull,
          bearish: fvgsBear,
          nearest_fvg: nearestFVG,
        },
        volume,
        open_interest: openInterest,
        funding,
        cvd,
        orderbook,
        volume_profile: volumeProfile,
        signals: signalsActive,
        trade_setup: setup,
        summary: {
          verdict,
          market_phase: phase,
          recommended_action: recommendedAction,
          confidence: Math.round((signalsActive.reversal.confidence + signalsActive.continuation.confidence + confidence) / 3),
        },
      };
    }),

  evaluate: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        strategy: z.enum(["scalping", "intraday", "swing", "grid", "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro"]),
      })
    )
    .mutation(async ({ input }) => {
      const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(input.symbol);
      const currentPrice = prices[prices.length - 1] || 0;
      const coindcxSymbol = `B-${input.symbol.replace("USDT", "_USDT")}`;

      const signalData = evaluateSymbolSignal(
        coindcxSymbol,
        input.strategy,
        currentPrice,
        prices,
        volumes,
        [],
        [],
        obMetrics,
        tapeMetrics,
        extraMetrics
      );

      const db = getDb();
      const [inserted] = await db
        .insert(signals)
        .values({
          symbol: signalData.symbol,
          microScore: signalData.microScore,
          intraScore: signalData.intraScore,
          swingScore: signalData.swingScore,
          compositeScore: signalData.compositeScore,
          threshold: signalData.threshold,
          isGated: signalData.isGated,
          direction: signalData.direction,
          metadata: signalData.metadata,
        })
        .returning();

      signalEvents.emit("update");
      return inserted;
    }),

  forceRegimeEvaluation: publicQuery
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ input }) => {
      const regime = await detectRegimeForSymbol(input.symbol);
      if (regime) {
        symbolStrategyMap.set(input.symbol, regime.strategy);
        latestRegimeCache.set(input.symbol, regime);
        signalEvents.emit("strategy-switch", {
          symbol: input.symbol,
          strategy: regime.strategy,
          regime: regime.regime,
          reason: regime.reason,
          timestamp: Date.now(),
        });
      }
      return regime;
    }),

  getSymbolStrategy: publicQuery
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => {
      return {
        strategy: symbolStrategyMap.get(input.symbol) || activeStrategyType,
        autoRegime: autoRegimeDetect,
      };
    }),

  setManualStrategy: publicQuery
    .input(
      z.object({
        strategy: z.enum(["scalping", "intraday", "swing", "grid", "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro"]),
        autoRegime: z.boolean().default(false),
      })
    )
    .mutation(({ input }) => {
      activeStrategyType = input.strategy;
      autoRegimeDetect = input.autoRegime;
      signalEvents.emit("strategy-switch", {
        strategy: input.strategy,
        autoRegime: input.autoRegime,
        timestamp: Date.now(),
      });
      return { success: true, strategy: activeStrategyType, autoRegime: autoRegimeDetect };
    }),

  analyzeAll: publicQuery.query(async () => {
    const results = [];
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(pair.binance);
        const analysis = analyzeConfluence(pair.coindcx, obMetrics, tapeMetrics, prices, volumes, extraMetrics);

        const db = getDb();
        await db.insert(signals).values({
          symbol: pair.coindcx,
          microScore: String(analysis.microScore),
          intraScore: String(analysis.intraScore),
          swingScore: String(analysis.swingScore),
          compositeScore: String(analysis.compositeScore),
          threshold: String(analysis.threshold),
          isGated: analysis.isGated,
          direction: analysis.direction,
          metadata: analysis.indicators,
        }).catch(() => {});

        results.push(analysis);
      } catch {
        // Skip failed pairs
      }
    }
    return results;
  }),

  history: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        limit: z.number().default(100),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(signals)
        .where(eq(signals.symbol, input.symbol))
        .orderBy(desc(signals.createdAt))
        .limit(input.limit);
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const allSignals = await db.select().from(signals).orderBy(desc(signals.createdAt)).limit(500);
    
    const total = allSignals.length;
    const gated = allSignals.filter((s) => s.isGated).length;
    const longSignals = allSignals.filter((s) => s.direction === "long").length;
    const shortSignals = allSignals.filter((s) => s.direction === "short").length;
    const avgComposite = total > 0
      ? allSignals.reduce((sum, s) => sum + parseFloat(s.compositeScore), 0) / total
      : 0;

    return {
      total,
      gated,
      gatedPercent: total > 0 ? (gated / total) * 100 : 0,
      longSignals,
      shortSignals,
      avgComposite: avgComposite.toFixed(2),
      bySymbol: SUPPORTED_PAIRS.map((p) => ({
        symbol: p.coindcx,
        signals: allSignals.filter((s) => s.symbol === p.coindcx).length,
        lastSignal: allSignals.find((s) => s.symbol === p.coindcx),
      })),
    };
  }),

  stream: publicQuery.subscription(() => {
    return observable<{ updatedAt: number }>((emit) => {
      const onUpdate = () => emit.next({ updatedAt: Date.now() });
      signalEvents.on("update", onUpdate);
      return () => signalEvents.off("update", onUpdate);
    });
  }),

  regimeStatus: publicQuery
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(({ input }) => {
      if (input?.symbol) {
        const r = latestRegimeCache.get(input.symbol);
        return {
          symbol: input.symbol,
          regime: r?.regime ?? "intraday_trend",
          strategy: symbolStrategyMap.get(input.symbol) ?? activeStrategyType,
          reason: r?.reason ?? "no data yet",
          inputs: r?.inputs,
          timestamp: r?.timestamp ?? null,
        };
      }
      const all: Record<string, unknown> = {};
      for (const pair of SUPPORTED_PAIRS) {
        const r = latestRegimeCache.get(pair.binance);
        all[pair.binance] = {
          regime: r?.regime ?? "unknown",
          strategy: symbolStrategyMap.get(pair.binance) ?? activeStrategyType,
          reason: r?.reason ?? "",
          timestamp: r?.timestamp ?? null,
        };
      }
      return { symbols: all, fallbackStrategy: activeStrategyType, autoRegime: autoRegimeDetect };
    }),

  regimeStream: publicQuery.subscription(() => {
    return observable((emit) => {
      const onSwitch = (data: unknown) => emit.next(data);
      signalEvents.on("strategy-switch", onSwitch);
      return () => signalEvents.off("strategy-switch", onSwitch);
    });
  }),

  knnLatest: publicQuery
    .input(z.object({ symbol: z.string().optional() }))
    .query(({ input }) => {
      if (input.symbol) {
        const snap = knnSnapshotCache.get(input.symbol);
        return snap ? { [input.symbol]: snap } : {};
      }
      return Object.fromEntries(knnSnapshotCache.entries()) as Record<string, KnnSupertrendSnapshot>;
    }),

  knnStream: publicQuery.subscription(() => {
    return observable<{ symbol: string; snapshot: KnnSupertrendSnapshot }>((emit) => {
      const onSnapshot = (data: { symbol: string; snapshot: KnnSupertrendSnapshot }) => emit.next(data);
      signalEvents.on("knn-snapshot", onSnapshot);
      return () => signalEvents.off("knn-snapshot", onSnapshot);
    });
  }),
});
