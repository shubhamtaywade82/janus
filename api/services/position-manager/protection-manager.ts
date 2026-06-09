import type { ManagedPosition, MarketContext, ProtectionStatus } from "./types";
import { calculateStopLoss } from "./sl-calculator";
import { calculateTakeProfit } from "./tp-calculator";
import { positionStore } from "./position-store";
import { positionManagerBus } from "./event-bus";
import { getDb } from "../../queries/connection";
import { positions, exchangeCredentials } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { getFuturesPositions } from "../coindcx";
import { decryptCreds } from "../../lib/crypto";

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
  userId: number
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
    if (!status.hasTp && sl !== null && position.entryPrice > 0) {
      const slDistancePct = Math.abs((position.entryPrice - sl) / position.entryPrice);
      const tpResult = calculateTakeProfit(position, ctx, slDistancePct);
      tp = tpResult.tp1;
    }

    if (sl === null || tp === null) return status;

    // Final safety check: ensure finite values for DB
    if (!Number.isFinite(sl) || !Number.isFinite(tp)) {
      console.warn(`[protection-manager] Non-finite SL/TP for ${position.id}: sl=${sl}, tp=${tp}`);
      return status;
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

    // Verify exchange state for LIVE positions.
    // CoinDCX futures does not expose an API to programmatically set SL/TP on a position,
    // so our protection is bot-managed (trailing-stop engine monitors every 2s).
    // We still read back the exchange position to detect manual overrides or discrepancies.
    if (!position.isPaper) {
      verifyExchangeProtection(position, sl, tp, userId).catch(() => {});
    }

    return { hasSl: true, hasTp: true, needsProtection: false };
  } catch (err) {
    console.error(`[protection-manager] Failed to protect position ${position.id}:`, err);
    return status;
  }
}

// ─── Exchange-state verification (best-effort, non-blocking) ─────────────────
// Reads back the live CoinDCX position and compares stop_loss_trigger /
// take_profit_trigger against what we just set. Emits a mismatch event when
// the exchange reports different values (e.g. manual override on exchange app).
async function verifyExchangeProtection(
  position: ManagedPosition,
  botSl: number,
  botTp: number,
  userId: number
): Promise<void> {
  try {
    const db = getDb();
    const [cred] = await db
      .select()
      .from(exchangeCredentials)
      .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.isActive, true)))
      .limit(1);
    if (!cred) return;

    const livePositions = await getFuturesPositions(decryptCreds(cred));
    const cdxPair = `B-${position.symbol.replace("USDT", "_USDT")}`;
    const lp = livePositions.find(
      (p: any) => (p.pair === cdxPair || p.symbol === position.symbol) && parseFloat(p.active_pos ?? "0") !== 0
    );
    if (!lp) return;

    const exSl = parseFloat(lp.stop_loss_trigger || "0") || null;
    const exTp = parseFloat(lp.take_profit_trigger || "0") || null;

    // Only flag a mismatch when exchange explicitly has different non-zero values
    const TOLERANCE = 0.001; // 0.1% tolerance for tick rounding
    const slMismatch = exSl !== null && Math.abs(exSl - botSl) / botSl > TOLERANCE;
    const tpMismatch = exTp !== null && Math.abs(exTp - botTp) / botTp > TOLERANCE;

    if (slMismatch || tpMismatch) {
      console.warn(
        `[protection-manager] Mismatch for ${position.symbol} #${position.id}: ` +
        `Bot SL=${botSl} ExSL=${exSl} | Bot TP=${botTp} ExTP=${exTp}`
      );
      positionManagerBus.emit("position:protection-mismatch", position.id, botSl, botTp, exSl, exTp);
    }
  } catch {
    // Verification is non-fatal — exchange read failure doesn't affect bot protection
  }
}
