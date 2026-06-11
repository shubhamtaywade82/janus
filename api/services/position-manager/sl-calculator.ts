import type { ManagedPosition, MarketContext, SLResult } from "./types";
import { marketStateManager } from "../market-state";
import { detectSwings } from "../price-action";
import { getDb } from "../../queries/connection";
import { marketData } from "@db/schema";
import { eq, and, gte } from "drizzle-orm";
import { SYMBOL_MIN_SL_PCT, DEFAULT_MIN_SL_PCT, type SupportedSymbol } from "../../../contracts/constants";

// ─── Stop Loss Calculator ────────────────────────────────────────────────────
// Modes: ATR (default), SWING (structure-based), VWAP, PERCENTAGE

const MAX_SL_DISTANCE_PCT = 0.08;    // 8% maximum

async function fetchKlines(binanceSymbol: string, limit = 100) {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - limit * 60 * 1000);
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
      .limit(limit);
    return rows.map((r) => ({
      time: r.timestamp.getTime(),
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume),
    }));
  } catch {
    return [];
  }
}

export async function calculateStopLoss(
  position: ManagedPosition,
  ctx: MarketContext
): Promise<SLResult> {
  const price = position.markPrice || position.entryPrice;
  const isLong = position.side === "LONG";
  const minSlPct = SYMBOL_MIN_SL_PCT[position.binanceSymbol as SupportedSymbol] ?? DEFAULT_MIN_SL_PCT;

  // ── ATR mode (primary) ─────────────────────────────────────────────────
  if (ctx.atr14 && ctx.atrPct) {
    const multiplier = ctx.volatilityRegime === "HIGH" ? 1.5 :
                       ctx.volatilityRegime === "EXTREME" ? 2.0 : 1.2;
    const slDistance = ctx.atr14 * multiplier;
    const sl = isLong
      ? price - slDistance
      : price + slDistance;
    const distancePct = slDistance / price;
    if (distancePct >= minSlPct && distancePct <= MAX_SL_DISTANCE_PCT) {
      return { stopLoss: sl, mode: "ATR", distancePct };
    }
  }

  // ── SWING mode (structure-based) ───────────────────────────────────────
  try {
    const klines = await fetchKlines(position.binanceSymbol, 100);
    if (klines.length >= 20) {
      const swings = detectSwings(klines, 5);
      const swingPoints = swings.filter((s) =>
        isLong ? s.type === "low" : s.type === "high"
      );
      if (swingPoints.length > 0) {
        const recentSwing = swingPoints[swingPoints.length - 1];
        const sl = isLong
          ? recentSwing.price * 0.998  // 0.2% buffer below swing low
          : recentSwing.price * 1.002; // 0.2% buffer above swing high
        const distancePct = Math.abs(price - sl) / price;
        if (distancePct >= minSlPct && distancePct <= MAX_SL_DISTANCE_PCT) {
          return { stopLoss: sl, mode: "SWING", distancePct };
        }
      }
    }
  } catch {
    // Fall through to percentage mode
  }

  // ── VWAP mode (approximated via mid-price when available) ────────────
  const state = marketStateManager.getOrInitializeState(position.binanceSymbol);
  const midPrice = state?.metrics?.midPrice;
  if (midPrice && midPrice > 0) {
    const distanceToMid = Math.abs(price - midPrice) / price;
    if (distanceToMid >= minSlPct && distanceToMid <= MAX_SL_DISTANCE_PCT) {
      const sl = isLong
        ? Math.min(price - price * minSlPct, midPrice * 0.998)
        : Math.max(price + price * minSlPct, midPrice * 1.002);
      const distancePct = Math.abs(price - sl) / price;
      if (distancePct >= minSlPct && distancePct <= MAX_SL_DISTANCE_PCT) {
        return { stopLoss: sl, mode: "VWAP", distancePct };
      }
    }
  }

  // ── Percentage fallback ────────────────────────────────────────────────
  const pct = ctx.volatilityRegime === "HIGH" ? 0.025 :
              ctx.volatilityRegime === "EXTREME" ? 0.04 : 0.015;
  const sl = isLong ? price * (1 - pct) : price * (1 + pct);
  return { stopLoss: sl, mode: "PERCENTAGE", distancePct: pct };
}
