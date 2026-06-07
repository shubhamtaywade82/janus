import type { ManagedPosition, MarketContext, TPResult } from "./types";
import { getRProfile, rBucketForStrategy } from "../r-profile-engine";

// ─── Take Profit Calculator ──────────────────────────────────────────────────
// Multi-level TPs using risk/reward ratios anchored to SL distance.

export function calculateTakeProfit(
  position: ManagedPosition,
  ctx: MarketContext,
  slDistancePct: number
): TPResult {
  const price = position.markPrice || position.entryPrice;
  const isLong = position.side === "LONG";

  // Prefer R-multiples empirically derived from this symbol's own historical price
  // action (how far it actually tends to run before reversing by 1R), refreshed
  // periodically by the r-profile-engine. Falls back to a static volatility-based
  // ladder while a profile hasn't been computed yet (e.g. just after boot).
  const profile = getRProfile(position.binanceSymbol, rBucketForStrategy(position.strategyType));

  let r1: number, r2: number, r3: number;
  if (profile) {
    r1 = profile.tp1R;
    r2 = profile.tp2R;
    r3 = profile.tp3R;
    if (ctx.volatilityRegime === "EXTREME") {
      r1 *= 1.15;
      r2 *= 1.15;
      r3 *= 1.15;
    }
  } else {
    // R multiples: TP1=1.5R, TP2=2.5R, TP3=4R
    // Adjust R multiples based on volatility regime
    r1 = ctx.volatilityRegime === "HIGH" ? 1.8 :
         ctx.volatilityRegime === "EXTREME" ? 2.2 : 1.5;
    r2 = r1 * 1.6;
    r3 = r1 * 2.5;
  }

  const tp1Distance = slDistancePct * r1;
  const tp2Distance = slDistancePct * r2;
  const tp3Distance = slDistancePct * r3;

  let tp1: number, tp2: number, tp3: number;
  if (isLong) {
    tp1 = price * (1 + tp1Distance);
    tp2 = price * (1 + tp2Distance);
    tp3 = price * (1 + tp3Distance);
  } else {
    tp1 = price * (1 - tp1Distance);
    tp2 = price * (1 - tp2Distance);
    tp3 = price * (1 - tp3Distance);
  }

  // Use EMA levels as natural resistance/support for TP anchoring if near
  if (ctx.ema20 && ctx.ema50) {
    if (isLong) {
      // If ema50 is between price and tp2, snap tp1 to ema50
      if (ctx.ema50 > price && ctx.ema50 < tp2) {
        tp1 = Math.min(tp1, ctx.ema50 * 0.998);
      }
    } else {
      if (ctx.ema50 < price && ctx.ema50 > tp2) {
        tp1 = Math.max(tp1, ctx.ema50 * 1.002);
      }
    }
  }

  return { tp1, tp2, tp3, primaryTP: tp1 };
}
