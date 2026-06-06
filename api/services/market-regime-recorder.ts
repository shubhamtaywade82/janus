/**
 * Market Regime Recorder
 *
 * Samples regime state from latestRegimeCache and persists to PostgreSQL.
 * Enables shared context for Signal Engine, Brain, Reflection, and Backtester.
 */

import { getDb } from "../queries/connection";
import { marketRegimes } from "@db/schema";
import { latestRegimeCache, type RegimeResult } from "./regime-detector";
import { marketStateManager } from "./market-state";
import { SUPPORTED_PAIRS } from "./binance";

export interface MarketRegimeSnapshot {
  symbol: string;
  regime: string;
  direction: string;
  volatility: string;
  liquidity: string;
  funding: string;
  marketStructure: string;
  confidence: number;
}

function mapRegimeToDirection(regime: RegimeResult): string {
  // Derive direction from regime type and EMA relationships
  if (regime.regime.includes("trend")) {
    const ema20 = regime.inputs.ema20_1h;
    const ema50 = regime.inputs.ema50_1h;
    return ema20 > ema50 ? "bullish" : ema20 < ema50 ? "bearish" : "neutral";
  }
  if (regime.regime === "reversal") {
    return regime.inputs.rsi1h > 70 ? "bearish" : regime.inputs.rsi1h < 30 ? "bullish" : "neutral";
  }
  return "neutral";
}

function mapRegimeToVolatility(regime: RegimeResult): string {
  const atr = regime.inputs.atrPct1h;
  if (atr > 2.0) return "high";
  if (atr > 1.0) return "normal";
  return "low";
}

function mapRegimeToMarketStructure(regime: RegimeResult): string {
  if (regime.regime.includes("trend")) return "continuation";
  if (regime.regime === "reversal") return "reversal";
  if (regime.regime === "ranging_tight" || regime.regime === "ranging") return "accumulation";
  return "range";
}

export async function recordMarketRegimes(): Promise<void> {
  const db = getDb();

  for (const pair of SUPPORTED_PAIRS) {
    const regime = latestRegimeCache.get(pair.binance);
    if (!regime) continue;

    const state = marketStateManager.get(pair.binance);
    const direction = mapRegimeToDirection(regime);
    const volatility = mapRegimeToVolatility(regime);
    const marketStructure = mapRegimeToMarketStructure(regime);

    // Derive liquidity state from order book imbalance
    let liquidity = "balanced";
    if (state?.metrics?.imbalance !== undefined) {
      const imb = state.metrics.imbalance;
      liquidity = imb > 0.6 ? "buy_side_targeted" : imb < 0.4 ? "sell_side_targeted" : "balanced";
    }

    // Derive funding state (placeholder — real funding data would come from funding rate history)
    const funding = "neutral";

    // Confidence based on ADX: higher ADX = higher confidence in trend/range classification
    const adx = regime.inputs.adx1h;
    const confidence = Math.min(0.99, Math.max(0.5, adx / 50));

    await db.insert(marketRegimes).values({
      symbol: pair.binance,
      regime: regime.regime,
      direction,
      volatility,
      liquidity,
      funding,
      marketStructure,
      confidence: confidence.toFixed(4),
    });
  }

  console.log(`[MarketRegimeRecorder] Recorded ${SUPPORTED_PAIRS.length} regime snapshots`);
}

// Start periodic recording (every 5 minutes)
let recorderInterval: NodeJS.Timeout | null = null;

export function startMarketRegimeRecorder(): void {
  if (recorderInterval) return;

  console.log("[MarketRegimeRecorder] Starting periodic recording (every 5 min)...");

  // Record immediately on start
  recordMarketRegimes().catch((err) => {
    console.error("[MarketRegimeRecorder] Initial recording failed:", err.message);
  });

  recorderInterval = setInterval(() => {
    recordMarketRegimes().catch((err) => {
      console.error("[MarketRegimeRecorder] Periodic recording failed:", err.message);
    });
  }, 5 * 60 * 1000); // 5 minutes
}

export function stopMarketRegimeRecorder(): void {
  if (recorderInterval) {
    clearInterval(recorderInterval);
    recorderInterval = null;
    console.log("[MarketRegimeRecorder] Stopped.");
  }
}
