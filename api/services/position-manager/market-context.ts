import { marketStateManager } from "../market-state";
import { latestTickerCache } from "../streaming";
import { getDb } from "../../queries/connection";
import { signals, marketData } from "@db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import type { MarketContext, MarketTrend, MarketStructure, VolatilityRegime, VolumeProfile, FundingBias } from "./types";
import { getKronosSignal } from "../kronos-client";
import { getDailyTrend } from "../trend-bias";

// ─── Market Context Builder ──────────────────────────────────────────────────
// Aggregates multi-timeframe data into a single MarketContext snapshot.

function calcEma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcAtr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function detectStructure(closes: number[]): MarketStructure {
  if (closes.length < 10) return "UNDEFINED";
  const recent = closes.slice(-10);
  const mid = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, mid);
  const secondHalf = recent.slice(mid);
  const firstHigh = Math.max(...firstHalf);
  const firstLow = Math.min(...firstHalf);
  const secondHigh = Math.max(...secondHalf);
  const secondLow = Math.min(...secondHalf);

  if (secondHigh > firstHigh && secondLow > firstLow) return "HH_HL";
  if (secondHigh < firstHigh && secondLow < firstLow) return "LH_LL";
  const range = firstHigh - firstLow;
  const midPrice = (firstHigh + firstLow) / 2;
  if (range / midPrice < 0.005) return "RANGING";
  return "UNDEFINED";
}

export async function buildMarketContext(binanceSymbol: string): Promise<MarketContext> {
  const state = marketStateManager.getOrInitializeState(binanceSymbol);
  const ticker = latestTickerCache.get(binanceSymbol);
  const lastPrice = ticker?.lastPrice ?? 0;
  const now = new Date();

  // ── Pull recent 1m klines from DB (last 250 candles) ──────────────────
  let closes: number[] = [];
  let highs: number[] = [];
  let lows: number[] = [];
  let volumes: number[] = [];

  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - 250 * 60 * 1000);
    const rows = await db
      .select()
      .from(marketData)
      .where(
        and(
          eq(marketData.symbol, binanceSymbol),
          eq(marketData.timeframe, "1m"),
          gte(marketData.timestamp, cutoff)
        )
      )
      .orderBy(marketData.timestamp)
      .limit(250);

    closes = rows.map((r) => parseFloat(r.close));
    highs = rows.map((r) => parseFloat(r.high));
    lows = rows.map((r) => parseFloat(r.low));
    volumes = rows.map((r) => parseFloat(r.volume));
  } catch {
    // Non-fatal: fall back to empty arrays
  }

  const rsi14 = calcRsi(closes);
  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const ema200 = calcEma(closes, 200);
  const atr14 = calcAtr(highs, lows, closes, 14);
  const atrPct = atr14 && lastPrice > 0 ? (atr14 / lastPrice) * 100 : null;

  // ── Pull latest confluence signal ──────────────────────────────────────
  let confluenceScore: number | null = null;
  let confluenceDirection: "long" | "short" | "neutral" = "neutral";
  try {
    const db = getDb();
    const [sig] = await db
      .select()
      .from(signals)
      .where(eq(signals.symbol, binanceSymbol))
      .orderBy(desc(signals.createdAt))
      .limit(1);
    if (sig) {
      confluenceScore = parseFloat(sig.compositeScore);
      confluenceDirection = sig.direction;
    }
  } catch {
    // Non-fatal
  }

  // ── Derived metrics from MarketStateManager ───────────────────────────
  const cvdAnalysis = marketStateManager.analyzeCvd(binanceSymbol);
  const cvdTrend: "bullish" | "bearish" | "neutral" =
    cvdAnalysis.trend === "BULLISH_DIVERGENCE" ? "bullish" :
    cvdAnalysis.trend === "BEARISH_DIVERGENCE" ? "bearish" : "neutral";

  const metrics = state
    ? {
        spreadPct: state.metrics.spread > 0 && lastPrice > 0
          ? (state.metrics.spread / lastPrice) * 100
          : null,
        bidAskImbalance: state.metrics.bidAskImbalance ?? null,
        volatilityRegime: state.metrics.volatilityRegime as VolatilityRegime,
        fundingRate: state.latestFunding?.fundingRate ?? null,
        cvdTrend,
      }
    : {
        spreadPct: null,
        bidAskImbalance: null,
        volatilityRegime: "NORMAL" as VolatilityRegime,
        fundingRate: null,
        cvdTrend,
      };

  // ── Trend ──────────────────────────────────────────────────────────────
  let trend: MarketTrend = "SIDEWAYS";
  if (ema50 && ema200) {
    if (lastPrice > ema50 && ema50 > ema200) trend = "BULLISH";
    else if (lastPrice < ema50 && ema50 < ema200) trend = "BEARISH";
  } else if (ema20 && ema50) {
    if (lastPrice > ema20 && ema20 > ema50) trend = "BULLISH";
    else if (lastPrice < ema20 && ema20 < ema50) trend = "BEARISH";
  }

  // ── Volume profile ─────────────────────────────────────────────────────
  let volumeProfile: VolumeProfile = "NORMAL";
  if (volumes.length >= 20) {
    const recentVol = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
    const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
    if (recentVol > avgVol * 1.5) volumeProfile = "HIGH";
    else if (recentVol < avgVol * 0.5) volumeProfile = "LOW";
  }

  // ── Funding bias ───────────────────────────────────────────────────────
  let fundingBias: FundingBias = "NEUTRAL";
  if (metrics.fundingRate !== null) {
    if (metrics.fundingRate > 0.0001) fundingBias = "POSITIVE";
    else if (metrics.fundingRate < -0.0001) fundingBias = "NEGATIVE";
  }

  // ── OI change (approximated from state) ───────────────────────────────
  let openInterestChange: number | null = null;
  if (state?.openInterestWindow) {
    const oiValues = state.openInterestWindow.values().map((t) => t.openInterest);
    if (oiValues.length >= 2) {
      const first = oiValues[0];
      const last = oiValues[oiValues.length - 1];
      if (first > 0) openInterestChange = ((last - first) / first) * 100;
    }
  }

  // ── Kronos AI Predictions ──────────────────────────────────────────────
  let kronosDirectionSignal: number | null = null;
  let kronosVolatilityForecast: number | null = null;
  let kronosConfidence: number | null = null;
  try {
    const kronos = await getKronosSignal(binanceSymbol, "1m", 4);
    if (kronos) {
      kronosDirectionSignal = kronos.directionSignal;
      kronosVolatilityForecast = kronos.volatilityForecast;
      kronosConfidence = kronos.confidence;
    }
  } catch {
    // Non-fatal
  }

  // ── Multi-Day Trend Bias (daily klines) ──────────────────────────────────
  let dailyTrend: MarketContext["dailyTrend"] = null;
  let dailyTrendConfidence: number | null = null;
  let sma50Daily: number | null = null;
  let sma200Daily: number | null = null;
  let priceVsSma50DailyPct: number | null = null;
  let priceVsSma200DailyPct: number | null = null;
  try {
    const trendBias = await getDailyTrend(binanceSymbol);
    if (trendBias) {
      dailyTrend = trendBias.bias;
      dailyTrendConfidence = trendBias.confidence;
      sma50Daily = trendBias.sma50;
      sma200Daily = trendBias.sma200;
      priceVsSma50DailyPct = trendBias.priceVsSma50Pct;
      priceVsSma200DailyPct = trendBias.priceVsSma200Pct;
    }
  } catch {
    // Non-fatal: daily trend is supplementary, not required
  }

  return {
    symbol: binanceSymbol,
    timestamp: now,
    trend,
    volatilityRegime: metrics.volatilityRegime,
    structure: detectStructure(closes),
    volumeProfile,
    fundingBias,
    rsi14,
    ema20,
    ema50,
    ema200,
    atr14,
    atrPct,
    spreadPct: metrics.spreadPct,
    bidAskImbalance: metrics.bidAskImbalance,
    cvdTrend: metrics.cvdTrend,
    fundingRate: metrics.fundingRate,
    openInterestChange,
    confluenceScore,
    confluenceDirection,
    lastPrice,
    kronosDirectionSignal,
    kronosVolatilityForecast,
    kronosConfidence,
    dailyTrend,
    dailyTrendConfidence,
    sma50Daily,
    sma200Daily,
    priceVsSma50DailyPct,
    priceVsSma200DailyPct,
  };
}
