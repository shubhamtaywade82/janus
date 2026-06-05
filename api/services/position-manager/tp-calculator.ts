import type { ManagedPosition, MarketContext, TPResult } from "./types";

// ─── Take Profit Calculator ──────────────────────────────────────────────────
// Multi-level TPs using risk/reward ratios anchored to SL distance.

export function calculateTakeProfit(
  position: ManagedPosition,
  ctx: MarketContext,
  slDistancePct: number
): TPResult {
  const price = position.markPrice || position.entryPrice;
  const isLong = position.side === "LONG";

  // R multiples: TP1=1.5R, TP2=2.5R, TP3=4R
  // Adjust R multiples based on volatility regime
  const r1 = ctx.volatilityRegime === "HIGH" ? 1.8 :
             ctx.volatilityRegime === "EXTREME" ? 2.2 : 1.5;
  const r2 = r1 * 1.6;
  const r3 = r1 * 2.5;

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
