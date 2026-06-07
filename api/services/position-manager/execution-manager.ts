import type { ManagedPosition, AiRecommendation, PolicyResult } from "./types";
import { PositionAction as PA } from "./types";
import { positionStore } from "./position-store";
import { positionManagerBus } from "./event-bus";
import { createFuturesOrder, getFuturesInstrumentInfo } from "../coindcx";
import { syncTrailingStopLoss } from "../trailing-stop";
import { env } from "../../lib/env";
import { getDb } from "../../queries/connection";
import { positions, exchangeCredentials } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { decryptCreds } from "../../lib/crypto";
import { releasePaperMargin } from "../paper-wallet";
import { recordPositionTransaction, estimateFee } from "../position-manager/transaction-ledger";

// ─── Execution Manager ───────────────────────────────────────────────────────
// Maps approved PositionActions to actual exchange calls + DB updates.

async function fetchCredentials(userId: number) {
  const db = getDb();
  const [cred] = await db
    .select()
    .from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.isActive, true)))
    .limit(1);
  if (!cred) throw new Error(`No active credentials for user ${userId}`);
  return decryptCreds(cred);
}

export async function executeAction(
  position: ManagedPosition,
  recommendation: AiRecommendation,
  policy: PolicyResult,
  userId: number
): Promise<{ success: boolean; detail: string }> {
  const action = policy.action;
  const db = getDb();

  try {
    switch (action) {
      // ── Passive actions (no exchange call) ──────────────────────────────
      case PA.KEEP_OPEN:
        return { success: true, detail: "Position kept open — no action required" };

      // ── Move stop to breakeven ──────────────────────────────────────────
      case PA.MOVE_TO_BREAKEVEN: {
        const newSl =
          recommendation.newStopLoss ??
          (position.side === "LONG"
            ? position.entryPrice * 1.001
            : position.entryPrice * 0.999);

        await db
          .update(positions)
          .set({ stopLoss: newSl.toFixed(8), updatedAt: new Date() })
          .where(eq(positions.id, position.id));

        positionStore.updateProtection(position.id, newSl, position.takeProfit);
        syncTrailingStopLoss(position.id, newSl);
        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "SL_UPDATE",
          side: position.side === "LONG" ? "long" : "short",
          price: newSl,
          metadata: {
            oldSl: position.stopLoss,
            newSl,
            reason: "breakeven",
          },
        });
        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          `SL moved to breakeven: ${newSl.toFixed(4)}`);
        return { success: true, detail: `Stop moved to breakeven @ ${newSl.toFixed(4)}` };
      }

      // ── Trail stop loss ─────────────────────────────────────────────────
      case PA.TRAIL_SL: {
        if (!recommendation.newStopLoss) {
          return { success: false, detail: "TRAIL_SL: no new stop loss value provided" };
        }
        const newSl = recommendation.newStopLoss;
        await db
          .update(positions)
          .set({ stopLoss: newSl.toFixed(8), updatedAt: new Date() })
          .where(eq(positions.id, position.id));

        positionStore.updateProtection(position.id, newSl, position.takeProfit);
        syncTrailingStopLoss(position.id, newSl);
        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "SL_UPDATE",
          side: position.side === "LONG" ? "long" : "short",
          price: newSl,
          metadata: {
            oldSl: position.stopLoss,
            newSl,
            reason: "trail",
          },
        });
        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          `SL trailed to ${newSl.toFixed(4)}`);
        return { success: true, detail: `Stop trailed to ${newSl.toFixed(4)}` };
      }

      // ── Tighten / Extend take profit ────────────────────────────────────
      case PA.TIGHTEN_TP:
      case PA.EXTEND_TP: {
        if (!recommendation.newTakeProfit) {
          return { success: false, detail: `${action}: no new take profit value provided` };
        }
        const newTp = recommendation.newTakeProfit;
        await db
          .update(positions)
          .set({ takeProfit: newTp.toFixed(8), updatedAt: new Date() })
          .where(eq(positions.id, position.id));

        positionStore.updateProtection(position.id, position.stopLoss, newTp);
        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "TP_UPDATE",
          side: position.side === "LONG" ? "long" : "short",
          price: newTp,
          metadata: {
            oldTp: position.takeProfit,
            newTp,
            reason: action === PA.TIGHTEN_TP ? "tighten" : "extend",
          },
        });
        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          `TP ${action === PA.TIGHTEN_TP ? "tightened" : "extended"} to ${newTp.toFixed(4)}`);
        return { success: true, detail: `TP updated to ${newTp.toFixed(4)}` };
      }

      // ── Partial exit ────────────────────────────────────────────────────
      case PA.PARTIAL_EXIT:
      case PA.REDUCE_SIZE: {
        const exitPct = recommendation.exitSizePct ?? 0.5;
        let exitQty = position.quantity * exitPct;

        try {
          const instrInfo = await getFuturesInstrumentInfo(position.symbol);
          if (instrInfo) {
            const stepSize = parseFloat(instrInfo.step ?? instrInfo.quantity_step ?? "0");
            const targetPrecision = instrInfo.target_currency_precision ?? 4;
            if (stepSize > 0) {
              exitQty = Math.floor(exitQty / stepSize) * stepSize;
            } else {
              exitQty = parseFloat(exitQty.toFixed(targetPrecision));
            }
          }
        } catch (err) {
          console.warn(`[execution-manager] Failed to fetch instrument info for precision mapping:`, err);
        }

        if (!position.isPaper) {
          if (!env.placeOrders) {
            return { success: false, detail: "PARTIAL_EXIT skipped: PLACE_ORDERS=false" };
          }
          try {
            const creds = await fetchCredentials(userId);
            const coindcxSide = position.side === "LONG" ? "sell" : "buy";
            await createFuturesOrder(creds, {
              market: position.symbol,
              side: coindcxSide,
              order_type: "market",
              total_quantity: exitQty,
              leverage: position.leverage,
            });
          } catch (exchangeErr) {
            console.warn(`[execution-manager] Exchange partial exit failed for ${position.id}:`, exchangeErr);
            positionManagerBus.emit("position:action-executed", position.id, action, "failed",
              `Exchange error: ${String(exchangeErr)}`);
            return { success: false, detail: `Exchange order failed: ${String(exchangeErr)}` };
          }
        }

        // Update position size in DB (paper: always; live: only after successful exchange order)
        const newQty = position.quantity - exitQty;
        const newMargin = position.margin * (newQty / position.quantity);
        const marginReleased = position.margin - newMargin;
        const partialPnl = (position.side === "LONG" ? 1 : -1) * (position.markPrice - position.entryPrice) * exitQty;
        const prevRealized = position.realizedPnl || 0;
        const nextRealized = prevRealized + partialPnl;

        await db
          .update(positions)
          .set({
            size: newQty.toFixed(8),
            margin: newMargin.toFixed(8),
            realizedPnl: nextRealized.toFixed(8),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, position.id));

        if (position.isPaper) {
          await releasePaperMargin(userId, marginReleased, partialPnl, position.id);
        }

        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "PARTIAL_EXIT",
          side: position.side === "LONG" ? "long" : "short",
          quantityBefore: position.quantity,
          quantityAfter: newQty,
          quantityDelta: -exitQty,
          price: position.markPrice,
          avgEntryPrice: position.entryPrice,
          realizedPnl: partialPnl,
          fee: estimateFee(position.markPrice * exitQty),
          marginBefore: position.margin,
          marginAfter: newMargin,
          metadata: {
            exitPct,
            exitQty,
            marginReleased,
            prevRealized: position.realizedPnl,
            nextRealized,
            isPaper: position.isPaper,
          },
        });

        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          `Exited ${(exitPct * 100).toFixed(0)}% of position`);
        return { success: true, detail: `Partial exit: ${(exitPct * 100).toFixed(0)}% exited` };
      }

      // ── Full exit ───────────────────────────────────────────────────────
      case PA.FULL_EXIT: {
        if (!position.isPaper) {
          if (!env.placeOrders) {
            return { success: false, detail: "FULL_EXIT skipped: PLACE_ORDERS=false" };
          }
          try {
            const creds = await fetchCredentials(userId);
            const coindcxSide = position.side === "LONG" ? "sell" : "buy";
            await createFuturesOrder(creds, {
              market: position.symbol,
              side: coindcxSide,
              order_type: "market",
              total_quantity: position.quantity,
              leverage: position.leverage,
            });
          } catch (exchangeErr) {
            console.warn(`[execution-manager] Exchange full exit failed for ${position.id}:`, exchangeErr);
            positionManagerBus.emit("position:action-executed", position.id, action, "failed",
              `Exchange error: ${String(exchangeErr)}`);
            return { success: false, detail: `Exchange order failed: ${String(exchangeErr)}` };
          }
        }

        // Close in DB (paper: always; live: only after successful exchange order above)
        const realizedPnl = (position.side === "LONG" ? 1 : -1) * (position.markPrice - position.entryPrice) * position.quantity;
        await db
          .update(positions)
          .set({
            status: "closed",
            currentPrice: String(position.markPrice),
            realizedPnl: String(realizedPnl),
            unrealizedPnl: "0",
            exitReason: recommendation.reasoning,
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, position.id));

        if (position.isPaper) {
          await releasePaperMargin(userId, position.margin, realizedPnl, position.id);
        }

        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "FULL_EXIT",
          side: position.side === "LONG" ? "long" : "short",
          quantityBefore: position.quantity,
          quantityAfter: 0,
          quantityDelta: -position.quantity,
          price: position.markPrice,
          avgEntryPrice: position.entryPrice,
          realizedPnl,
          fee: estimateFee(position.markPrice * position.quantity),
          marginBefore: position.margin,
          marginAfter: 0,
          metadata: {
            reason: recommendation.reasoning,
            exitReason: recommendation.reasoning,
            isPaper: position.isPaper,
          },
        });

        positionStore.updateLifecycleState(position.id, "CLOSED");
        positionStore.remove(position.id);
        positionManagerBus.emit("position:closed", position.id, recommendation.reasoning);
        positionManagerBus.emit("position:action-executed", position.id, action, "ok", "Position fully exited");
        return { success: true, detail: "Position fully exited" };
      }

      // ── Scale in (add to position) ───────────────────────────────────
      case PA.SCALE_IN: {
        // Scale-in is logged only — actual execution goes through auto-executor
        // to respect all 8 gates. We emit an event for the executor to pick up.
        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          "Scale-in signal emitted to auto-executor");
        return { success: true, detail: "Scale-in event emitted" };
      }

      default:
        return { success: false, detail: `Unknown action: ${action}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    positionManagerBus.emit("position:action-executed", position.id, action, "failed", msg);
    return { success: false, detail: msg };
  }
}
