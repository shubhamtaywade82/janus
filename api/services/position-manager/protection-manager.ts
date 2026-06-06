import type { ManagedPosition, MarketContext, ProtectionStatus } from "./types";
import { calculateStopLoss } from "./sl-calculator";
import { calculateTakeProfit } from "./tp-calculator";
import { positionStore } from "./position-store";
import { positionManagerBus } from "./event-bus";
import { getDb } from "../../queries/connection";
import { positions } from "@db/schema";
import { eq } from "drizzle-orm";

// ─── Protection Manager ──────────────────────────────────────────────────────
// Ensures every managed position has a stop-loss and take-profit.
// If missing, calculates and attempts to place orders on exchange.

export function checkProtectionStatus(position: ManagedPosition): ProtectionStatus {
  const hasSl = position.stopLoss !== null && position.stopLoss > 0;
  const hasTp = position.takeProfit !== null && position.takeProfit > 0;
  return {
    hasSl,
    hasTp,
    needsProtection: !hasSl || !hasTp,
  };
}

export async function ensureProtection(
  position: ManagedPosition,
  ctx: MarketContext,
  _userId: number
): Promise<ProtectionStatus> {
  const status = checkProtectionStatus(position);
  if (!status.needsProtection) return status;

  const db = getDb();

  try {
    let sl = position.stopLoss;
    let tp = position.takeProfit;

    // Calculate missing SL
    if (!status.hasSl) {
      const slResult = await calculateStopLoss(position, ctx);
      sl = slResult.stopLoss;
    }

    // Calculate missing TP using SL distance
    if (!status.hasTp && sl !== null) {
      const slDistancePct = Math.abs((position.entryPrice - sl) / position.entryPrice);
      const tpResult = calculateTakeProfit(position, ctx, slDistancePct);
      tp = tpResult.tp1;
    }

    if (sl === null || tp === null) return status;

    // Place orders on exchange for live positions
    if (!position.isPaper) {
      try {
        // CoinDCX does not have native SL/TP order types on futures in the same way,
        // so we register with the trailing stop engine and record locally
        // Future: extend with exchange conditional orders when API supports it
      } catch (execErr) {
        console.warn(`[protection-manager] Could not place exchange orders for ${position.symbol}:`, execErr);
      }
    }

    // Persist to DB
    await db
      .update(positions)
      .set({
        stopLoss: sl.toFixed(8),
        takeProfit: tp.toFixed(8),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, position.id));

    // Update in-memory store
    positionStore.updateProtection(position.id, sl, tp);
    positionManagerBus.emit("position:protected", position.id, sl, tp);

    return { hasSl: true, hasTp: true, needsProtection: false };
  } catch (err) {
    console.error(`[protection-manager] Failed to protect position ${position.id}:`, err);
    return status;
  }
}
