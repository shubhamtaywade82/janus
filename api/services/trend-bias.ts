import { getDb } from "../queries/connection";
import { marketData } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { fetchKlines } from "./binance";
import { SUPPORTED_SYMBOLS } from "../../contracts/constants";

// ─── Trend Bias Service ──────────────────────────────────────────────────────
// Fetches daily klines from Binance, stores them in market_data (timeframe="1d"),
// computes true multi-day SMAs (50-day, 200-day), and produces a trend bias per symbol.
//
// This fixes the fundamental issue where the "swing" confluence score was using
// 1-minute closes for its SMA(50) and EMA(200), which are actually 50-minute and
// 200-minute averages (~3 hours). True swing trading requires multi-day trend data.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyTrendBias {
  symbol: string;               // Binance format, e.g. "BTCUSDT"
  timestamp: Date;              // when this bias was computed
  sma50: number | null;         // 50-day simple moving average
  sma200: number | null;        // 200-day simple moving average
  priceVsSma50Pct: number | null; // (price - sma50) / sma50 * 100
  priceVsSma200Pct: number | null; // (price - sma200) / sma200 * 100
  bias: "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";
  confidence: number;           // 0–1
  factors: string[];
  lastClose: number | null;
  lastVolume: number | null;
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────
// Survives short disconnects; refreshed periodically from DB.

const biasCache = new Map<string, DailyTrendBias>();

// ─── SMA Helpers ───────────────────────────────────────────────────────────

function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function computeBias(
  lastClose: number,
  sma50: number | null,
  sma200: number | null
): { bias: DailyTrendBias["bias"]; confidence: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // Price vs SMA50 (weight 30)
  if (sma50 !== null) {
    if (lastClose > sma50 * 1.05) {
      score += 30;
      factors.push("Price > SMA50+5%");
    } else if (lastClose > sma50) {
      score += 15;
      factors.push("Price > SMA50");
    } else if (lastClose < sma50 * 0.95) {
      score -= 30;
      factors.push("Price < SMA50-5%");
    } else if (lastClose < sma50) {
      score -= 15;
      factors.push("Price < SMA50");
    }
  }

  // Price vs SMA200 (weight 40)
  if (sma200 !== null) {
    if (lastClose > sma200 * 1.10) {
      score += 40;
      factors.push("Price > SMA200+10%");
    } else if (lastClose > sma200) {
      score += 20;
      factors.push("Price > SMA200");
    } else if (lastClose < sma200 * 0.90) {
      score -= 40;
      factors.push("Price < SMA200-10%");
    } else if (lastClose < sma200) {
      score -= 20;
      factors.push("Price < SMA200");
    }
  }

  // Golden / Death cross (weight 30)
  if (sma50 !== null && sma200 !== null) {
    if (sma50 > sma200 * 1.02) {
      score += 30;
      factors.push("Golden cross: SMA50 > SMA200+2%");
    } else if (sma50 > sma200) {
      score += 15;
      factors.push("SMA50 > SMA200");
    } else if (sma50 < sma200 * 0.98) {
      score -= 30;
      factors.push("Death cross: SMA50 < SMA200-2%");
    } else if (sma50 < sma200) {
      score -= 15;
      factors.push("SMA50 < SMA200");
    }
  }

  // Clamp score to [-100, +100]
  score = Math.max(-100, Math.min(100, score));

  const bias: DailyTrendBias["bias"] =
    score >= 60 ? "STRONG_BULLISH" :
    score >= 25 ? "BULLISH" :
    score <= -60 ? "STRONG_BEARISH" :
    score <= -25 ? "BEARISH" :
    "NEUTRAL";

  const confidence = Math.abs(score) / 100;

  return { bias, confidence, factors };
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

export async function fetchDailyKlinesFromDb(symbol: string, limit: number = 250): Promise<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(marketData)
    .where(
      and(
        eq(marketData.symbol, symbol),
        eq(marketData.timeframe, "1d")
      )
    )
    .orderBy(marketData.timestamp)
    .limit(limit)
    .catch(() => []);

  return rows.map((r) => ({
    timestamp: r.timestamp,
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseFloat(r.volume),
  }));
}

export async function persistDailyKlines(
  symbol: string,
  klines: { openTime: number; open: string; high: string; low: string; close: string; volume: string; closeTime: number; quoteVolume: string; trades: number }[]
): Promise<void> {
  if (klines.length === 0) return;
  const db = getDb();

  // Batch insert with conflict skip (best-effort; duplicates are ignored)
  const values = klines.map((k) => ({
    symbol,
    timeframe: "1d" as const,
    timestamp: new Date(k.openTime),
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    quoteVolume: k.quoteVolume,
    tradeCount: k.trades,
    createdAt: new Date(),
  }));

  try {
    await db.insert(marketData).values(values).onConflictDoNothing();
  } catch (err) {
    console.warn(`[trend-bias] Failed to persist daily klines for ${symbol}:`, (err as Error).message);
  }
}

// ─── Main Trend Computation ──────────────────────────────────────────────────

export async function computeDailyTrend(symbol: string): Promise<DailyTrendBias> {
  const cached = biasCache.get(symbol);
  if (cached && Date.now() - cached.timestamp.getTime() < 60 * 60 * 1000) {
    return cached;
  }

  let rows = await fetchDailyKlinesFromDb(symbol, 250);

  // Backfill from Binance if DB has fewer than 200 days
  if (rows.length < 200) {
    try {
      const klines = await fetchKlines(symbol, "1d", 300);
      if (klines.length > 0) {
        await persistDailyKlines(symbol, klines);
        rows = await fetchDailyKlinesFromDb(symbol, 250);
      }
    } catch (err) {
      console.warn(`[trend-bias] Binance fetch failed for ${symbol}:`, (err as Error).message);
    }
  }

  const closes = rows.map((r) => r.close);
  const volumes = rows.map((r) => r.volume);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const lastVolume = volumes.length > 0 ? volumes[volumes.length - 1] : null;

  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);

  const priceVsSma50Pct = lastClose && sma50 ? ((lastClose - sma50) / sma50) * 100 : null;
  const priceVsSma200Pct = lastClose && sma200 ? ((lastClose - sma200) / sma200) * 100 : null;

  const { bias, confidence, factors } =
    lastClose !== null
      ? computeBias(lastClose, sma50, sma200)
      : { bias: "NEUTRAL" as const, confidence: 0, factors: ["No data available"] };

  const result: DailyTrendBias = {
    symbol,
    timestamp: new Date(),
    sma50,
    sma200,
    priceVsSma50Pct,
    priceVsSma200Pct,
    bias,
    confidence,
    factors,
    lastClose,
    lastVolume,
  };

  biasCache.set(symbol, result);
  return result;
}

export async function getDailyTrend(symbol: string): Promise<DailyTrendBias | null> {
  const cached = biasCache.get(symbol);
  if (cached) return cached;

  try {
    return await computeDailyTrend(symbol);
  } catch (err) {
    console.warn(`[trend-bias] Failed to compute trend for ${symbol}:`, (err as Error).message);
    return null;
  }
}

export function getCachedDailyTrend(symbol: string): DailyTrendBias | null {
  return biasCache.get(symbol) ?? null;
}

// ─── Bulk Refresh ────────────────────────────────────────────────────────────

export async function refreshAllDailyTrends(): Promise<void> {
  for (const sym of SUPPORTED_SYMBOLS) {
    try {
      await computeDailyTrend(sym);
      await new Promise((r) => setTimeout(r, 200)); // polite rate limit
    } catch (err) {
      console.warn(`[trend-bias] Refresh failed for ${sym}:`, (err as Error).message);
    }
  }
}

// ─── Background Scheduler ───────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyTrendScheduler(intervalMs = 60 * 60 * 1000): void {
  if (schedulerTimer) return;

  // Immediate first run
  refreshAllDailyTrends().catch((err) =>
    console.error("[trend-bias] Initial refresh failed:", err)
  );

  schedulerTimer = setInterval(() => {
    refreshAllDailyTrends().catch((err) =>
      console.error("[trend-bias] Scheduled refresh failed:", err)
    );
  }, intervalMs);

  console.log(`[trend-bias] Daily trend scheduler started (interval=${intervalMs}ms)`);
}

export function stopDailyTrendScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[trend-bias] Daily trend scheduler stopped");
  }
}

// ─── Helpers for Other Services ──────────────────────────────────────────────

/**
 * Returns a numeric trend score suitable for the confluence engine's swing scoring.
 * Range: 0–100 (50 = neutral, 100 = strong bullish, 0 = strong bearish).
 */
export function dailyTrendScore(bias: DailyTrendBias): number {
  const base = 50;
  const multiplier = bias.confidence * 50;
  if (bias.bias === "STRONG_BULLISH") return base + multiplier;
  if (bias.bias === "BULLISH") return base + multiplier * 0.6;
  if (bias.bias === "NEUTRAL") return base;
  if (bias.bias === "BEARISH") return base - multiplier * 0.6;
  if (bias.bias === "STRONG_BEARISH") return base - multiplier;
  return base;
}
