/**
 * Kronos AI Client
 * Wraps the Python inference microservice with caching, retry, and circuit-breaker logic.
 */

import { getDb } from "../queries/connection";
import { kronosSignals, marketData } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";
import { env } from "../lib/env";
import EventEmitter from "events";
import { fetchKlines } from "./binance";

const KRONOS_URL = env.kronosEndpoint;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — Kronos is a slow-moving signal
const INFERENCE_TIMEOUT_MS = 15_000;
const MIN_KLINES = 50;
const INSUFFICIENT_WARN_COOLDOWN_MS = 5 * 60 * 1000;

export interface KronosPrediction {
  symbol: string;
  directionSignal: number;   // -1.0 to +1.0
  volatilityForecast: number; // 0.0 to 1.0
  confidence: number;         // 0.0 to 1.0
  timestamp: Date;
}

export const kronosEvents = new EventEmitter();

const insufficientWarnAt = new Map<string, number>();

function normalizeSymbol(symbol: string): string {
  return symbol.replace(/^B-/, "").replace(/_/, "").toUpperCase();
}

function warnInsufficientKlines(symbol: string, interval: string, count: number): void {
  const key = `${symbol}:${interval}`;
  const lastWarn = insufficientWarnAt.get(key) ?? 0;
  if (Date.now() - lastWarn < INSUFFICIENT_WARN_COOLDOWN_MS) return;

  insufficientWarnAt.set(key, Date.now());
  console.warn(`[kronos] Insufficient klines for ${symbol} ${interval} (${count} < ${MIN_KLINES})`);
}

type OhlcvaRow = [number, number, number, number, number, number];

async function resolveOhlcvaInput(
  normalizedSymbol: string,
  interval: string
): Promise<OhlcvaRow[] | null> {
  const db = getDb();
  const dbKlines = await db
    .select()
    .from(marketData)
    .where(
      and(
        eq(marketData.symbol, normalizedSymbol),
        eq(marketData.timeframe, interval)
      )
    )
    .orderBy(desc(marketData.timestamp))
    .limit(100)
    .catch(() => []);

  if (dbKlines.length >= MIN_KLINES) {
    const sorted = [...dbKlines].reverse();
    return sorted.map((k) => [
      parseFloat(k.open),
      parseFloat(k.high),
      parseFloat(k.low),
      parseFloat(k.close),
      parseFloat(k.volume),
      parseFloat(k.quoteVolume),
    ]);
  }

  try {
    const restKlines = await fetchKlines(normalizedSymbol, interval, 100);
    if (restKlines.length < MIN_KLINES) {
      warnInsufficientKlines(normalizedSymbol, interval, restKlines.length);
      return null;
    }

    return restKlines.map((k) => [
      parseFloat(k.open),
      parseFloat(k.high),
      parseFloat(k.low),
      parseFloat(k.close),
      parseFloat(k.volume),
      parseFloat(k.quoteVolume || "0"),
    ]);
  } catch {
    warnInsufficientKlines(normalizedSymbol, interval, dbKlines.length);
    return null;
  }
}

/**
 * Fetch latest Kronos prediction for a symbol.
 * Uses DB cache first; falls back to live inference if stale or missing.
 */
export async function getKronosSignal(
  symbol: string,
  interval: string = "1m",
  horizon: number = 4
): Promise<KronosPrediction | null> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const db = getDb();

  // 1. Check DB cache
  const cached = await db
    .select()
    .from(kronosSignals)
    .where(
      and(
        eq(kronosSignals.symbol, normalizedSymbol),
        eq(kronosSignals.interval, interval)
      )
    )
    .orderBy(desc(kronosSignals.createdAt))
    .limit(1)
    .catch(() => []);

  if (cached.length > 0 && Date.now() - cached[0].createdAt.getTime() < CACHE_TTL_MS) {
    return {
      symbol: cached[0].symbol,
      directionSignal: parseFloat(cached[0].directionSignal),
      volatilityForecast: parseFloat(cached[0].volatilityForecast),
      confidence: parseFloat(cached[0].confidence),
      timestamp: cached[0].createdAt,
    };
  }

  // 2. Resolve klines from DB, falling back to Binance REST when bootstrapping
  const ohlcva = await resolveOhlcvaInput(normalizedSymbol, interval);
  if (!ohlcva) return null;

  // 3. Call Kronos inference service
  try {
    const res = await fetch(`${KRONOS_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: normalizedSymbol,
        interval,
        ohlcva,
        task: "return_forecast",
        horizon,
      }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Kronos HTTP ${res.status}`);
    }

    const data = await res.json() as {
      symbol: string;
      direction_signal: number;
      volatility_forecast: number;
      confidence: number;
      timestamp: string;
    };

    const parsedPred: KronosPrediction = {
      symbol: data.symbol,
      directionSignal: data.direction_signal,
      volatilityForecast: data.volatility_forecast,
      confidence: data.confidence,
      timestamp: new Date(data.timestamp),
    };

    // 4. Persist to DB
    await db.insert(kronosSignals).values({
      symbol: normalizedSymbol,
      interval,
      directionSignal: String(data.direction_signal),
      volatilityForecast: String(data.volatility_forecast),
      confidence: String(data.confidence),
      task: "return_forecast",
      horizon,
      metadata: { source: "live_inference", raw: data },
    });

    kronosEvents.emit("prediction", { symbol: normalizedSymbol, prediction: parsedPred });

    return parsedPred;

  } catch (err: any) {
    console.error(`[kronos] Inference failed for ${normalizedSymbol}:`, err.message);

    // Return stale cache as fallback rather than failing completely
    if (cached.length > 0) {
      console.log(`[kronos] Returning stale cached signal for ${normalizedSymbol}`);
      return {
        symbol: cached[0].symbol,
        directionSignal: parseFloat(cached[0].directionSignal),
        volatilityForecast: parseFloat(cached[0].volatilityForecast),
        confidence: parseFloat(cached[0].confidence),
        timestamp: cached[0].createdAt,
      };
    }
    return null;
  }
}

/**
 * Batch fetch for all supported pairs.
 */
export async function refreshKronosSignals(symbols: string[]): Promise<void> {
  for (const sym of symbols) {
    try {
      await getKronosSignal(sym, "1m", 4);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[kronos] Batch refresh failed for ${sym}:`, err);
    }
  }
}
