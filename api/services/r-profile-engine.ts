// ─── Adaptive R-Profile Engine ──────────────────────────────────────────────
// Empirically derives realistic TP R-multiples (TP1/TP2/TP3) per symbol and
// per holding-horizon bucket (intraday vs swing) directly from that symbol's
// own historical price action — refreshed periodically. Replaces the idea of
// hardcoding "ETH supports 3R, SOL supports 5R" with a runtime measurement:
// for a stop distance derived from the symbol's own typical range, how far
// does price actually tend to run (in R) before that stop would be hit?

import { fetchKlines, SUPPORTED_PAIRS, type BinanceKline } from "./binance";

export type RBucket = "intraday" | "swing";

export interface RProfile {
  tp1R: number;
  tp2R: number;
  tp3R: number;
  slPct: number;        // representative stop distance this profile was derived against
  sampleSize: number;
  computedAt: number;
}

interface SymbolRProfiles {
  intraday: RProfile;
  swing: RProfile;
}

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 6 * HOUR_MS;
const LOOKBACK_CANDLES = 720; // ~30 days of 1h candles
const INTRADAY_FORWARD_BARS = 24; // ~1 day forward horizon
const SWING_FORWARD_BARS = 120;   // ~5 days forward horizon
const MAX_R_CAP = 12;

const MIN_SL_PCT = 0.003;
const MAX_SL_PCT = 0.08;

const DEFAULT_PROFILE: RProfile = {
  tp1R: 1.5,
  tp2R: 2.4,
  tp3R: 3.75,
  slPct: 0.015,
  sampleSize: 0,
  computedAt: 0,
};

const globalStore = globalThis as Record<string, unknown>;
const storeKey = "__rProfileStore__";
if (!globalStore[storeKey]) {
  globalStore[storeKey] = new Map<string, SymbolRProfiles>();
}
const rProfileStore = globalStore[storeKey] as Map<string, SymbolRProfiles>;

/** Maps a position's strategy type to the holding-horizon bucket used for profiling. */
export function rBucketForStrategy(strategyType: string | null | undefined): RBucket {
  return strategyType === "swing" ? "swing" : "intraday";
}

/** Returns the empirically-derived R profile for a symbol/bucket, or null if not yet computed. */
export function getRProfile(binanceSymbol: string, bucket: RBucket): RProfile | null {
  const profiles = rProfileStore.get(binanceSymbol);
  if (!profiles) return null;
  const profile = profiles[bucket];
  return profile.sampleSize > 0 ? profile : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(p * (sortedValues.length - 1))));
  return sortedValues[idx];
}

/**
 * For each historical bar, simulate entering long/short with a stop at `slPct`
 * and measure the max favorable excursion (in R) reached before that stop
 * would have been hit within `forwardBars`. The resulting distribution
 * answers: "how far does this symbol actually tend to run before reversing
 * by 1R?" — which is exactly what realistic TP R-multiples should be based on.
 */
function deriveAchievedR(candles: { high: number; low: number; close: number }[], slPct: number, forwardBars: number): number[] {
  const achieved: number[] = [];

  for (let i = 0; i + forwardBars < candles.length; i++) {
    const entry = candles[i].close;
    const stopDist = entry * slPct;

    for (const direction of [1, -1] as const) {
      let maxFavorable = 0;
      for (let j = i + 1; j <= i + forwardBars; j++) {
        const bar = candles[j];
        const adverseExtreme = direction === 1 ? bar.low : bar.high;
        const favorableExtreme = direction === 1 ? bar.high : bar.low;
        const adverseMove = direction === 1 ? entry - adverseExtreme : adverseExtreme - entry;

        if (adverseMove >= stopDist) break; // stopped out — lock in what was captured before this
        const favorableMove = direction === 1 ? favorableExtreme - entry : entry - favorableExtreme;
        maxFavorable = Math.max(maxFavorable, favorableMove);
      }
      achieved.push(Math.min(MAX_R_CAP, maxFavorable / stopDist));
    }
  }

  return achieved;
}

function buildProfile(candles: { high: number; low: number; close: number }[], slPct: number, forwardBars: number): RProfile {
  const achieved = deriveAchievedR(candles, slPct, forwardBars).sort((a, b) => a - b);
  if (achieved.length < 30) {
    return { ...DEFAULT_PROFILE, sampleSize: 0 };
  }

  // TP1 = level reached ~60% of the time, TP2 ~40%, TP3 ~20% (percentile from the top)
  let tp1R = percentile(achieved, 0.40);
  let tp2R = percentile(achieved, 0.60);
  let tp3R = percentile(achieved, 0.80);

  tp1R = clamp(tp1R, 1.2, 3.0);
  tp2R = clamp(Math.max(tp2R, tp1R * 1.3), 1.8, 6.0);
  tp3R = clamp(Math.max(tp3R, tp2R * 1.3), 2.5, 10.0);

  return { tp1R, tp2R, tp3R, slPct, sampleSize: achieved.length, computedAt: Date.now() };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toCandles(klines: BinanceKline[]): { high: number; low: number; close: number }[] {
  return klines.map((k) => ({ high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close) }));
}

/** Derives a representative stop distance from the symbol's own typical 1h range — mirrors the ATR-based SL mode. */
function representativeSlPct(candles: { high: number; low: number; close: number }[]): number {
  const ranges = candles.map((c) => (c.high - c.low) / c.close).filter((r) => Number.isFinite(r) && r > 0);
  const typicalRangePct = median(ranges);
  return clamp(typicalRangePct * 1.2, MIN_SL_PCT, MAX_SL_PCT);
}

export async function refreshRProfile(binanceSymbol: string): Promise<void> {
  const klines = await fetchKlines(binanceSymbol, "1h", LOOKBACK_CANDLES);
  if (klines.length < SWING_FORWARD_BARS + 30) return;

  const candles = toCandles(klines);
  const slPct = representativeSlPct(candles);

  rProfileStore.set(binanceSymbol, {
    intraday: buildProfile(candles, slPct, INTRADAY_FORWARD_BARS),
    swing: buildProfile(candles, slPct, SWING_FORWARD_BARS),
  });
}

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

async function refreshAll(): Promise<void> {
  for (const pair of SUPPORTED_PAIRS) {
    try {
      await refreshRProfile(pair.binance);
    } catch (err) {
      console.error(`[r-profile] Failed to refresh ${pair.binance}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Starts the periodic empirical R-profile refresh loop (every 6h, plus an initial run). */
export function startRProfileRefresh(): void {
  if (refreshIntervalId) return;
  refreshAll().catch((err) => console.error("[r-profile] Initial refresh failed:", err));
  refreshIntervalId = setInterval(() => {
    refreshAll().catch((err) => console.error("[r-profile] Refresh failed:", err));
  }, REFRESH_INTERVAL_MS);
}

export function stopRProfileRefresh(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}
