import type { ManagedPosition, AiRecommendation, PolicyResult } from "./types";
import { PositionAction as PA } from "./types";

const TAKER_FEE = 0.0005;
import { positionStore } from "./position-store";
import { positionManagerBus } from "./event-bus";
import { createFuturesOrder, getFuturesInstrumentInfo } from "../coindcx";
import { syncTrailingStopLoss } from "../trailing-stop";
import { env } from "../../lib/env";
import { getDb } from "../../queries/connection";
import { positions, exchangeCredentials, autoExecutorConfig } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { decryptCreds } from "../../lib/crypto";
import {
  lockPaperPositionMargin,
  releasePaperPositionMargin,
  walletToUsdt,
  resolvePaperPositionMargin,
  usdtMarginToStored,
  computeMarginUsdt,
} from "../paper-currency";
import { getPaperWallet } from "../paper-wallet";
import { recordPositionTransaction, estimateFee } from "../position-manager/transaction-ledger";

async function paperMarginSnapshot(position: ManagedPosition) {
  const currency = (position.marginCurrency as "USDT" | "INR") ?? "INR";
  return {
    currency,
    ...(await resolvePaperPositionMargin({
      marginStored: position.margin,
      marginCurrency: currency,
      size: position.quantity,
      entryPrice: position.entryPrice,
      leverage: position.leverage,
    })),
  };
}

/**
 * Returns true only if the proposed SL is strictly better than current.
 * LONG: proposed must be > current
 * SHORT: proposed must be < current
 */
export function isSlImprovement(
  side: "LONG" | "SHORT",
  currentSl: number | null,
  proposedSl: number
): boolean {
  if (currentSl === null) return true;
  if (side === "LONG") return proposedSl > currentSl;
  return proposedSl < currentSl;
}

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

async function roundQty(symbol: string, qty: number): Promise<number> {
  try {
    const instrInfo = await getFuturesInstrumentInfo(symbol);
    if (!instrInfo) return qty;
    const stepSize = parseFloat(instrInfo.step ?? instrInfo.quantity_step ?? "0");
    const targetPrecision = instrInfo.target_currency_precision ?? 4;
    if (stepSize > 0) return Math.floor(qty / stepSize) * stepSize;
    return parseFloat(qty.toFixed(targetPrecision));
  } catch {
    return qty;
  }
}

export async function executeAction(
  position: ManagedPosition,
  recommendation: AiRecommendation,
  policy: PolicyResult,
  userId: number
): Promise<{ success: boolean; detail: string }> {
  const action = policy.action;
  const db = getDb();

  // Live AI execution enabled — bot decisions execute automatically.
  // The monitor-mode guard still prevents execution when env.isMonitorMode is true.
  // Previous live-only monitor guard removed per user requirement for complete automation.
  if (env.isMonitorMode && action !== PA.KEEP_OPEN) {
    positionManagerBus.emit(
      "position:action-executed",
      position.id,
      action,
      "ok",
      `[monitor] would execute ${action}: ${recommendation.reasoning ?? ""}`
    );
    return { success: true, detail: `[monitor] ${action} observed — no execution in live_monitor mode` };
  }

  try {
    switch (action) {
      // ── Passive actions (no exchange call) ──────────────────────────────
      case PA.KEEP_OPEN:
        return { success: true, detail: "Position kept open — no action required" };

      // ── Move stop to breakeven ──────────────────────────────────────────
      case PA.MOVE_TO_BREAKEVEN: {
        if (position.breakevenApplied) {
          return { success: false, detail: "Breakeven already applied" };
        }

        const newSl =
          recommendation.newStopLoss ??
          (position.side === "LONG"
            ? position.entryPrice * (1 + TAKER_FEE * 2)
            : position.entryPrice * (1 - TAKER_FEE * 2));

        if (!isSlImprovement(position.side, position.stopLoss, newSl)) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `MOVE_TO_BREAKEVEN rejected: ${newSl.toFixed(4)} is worse than current ${position.stopLoss?.toFixed(4)}`
          );
          return { success: false, detail: `Breakeven rejected: would lower SL` };
        }

        const markPrice = position.markPrice;
        if (position.side === "LONG" && newSl >= markPrice) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `MOVE_TO_BREAKEVEN rejected: proposed SL ${newSl.toFixed(4)} is >= current mark ${markPrice.toFixed(4)}`
          );
          return { success: false, detail: `Breakeven rejected: SL would cross current mark price` };
        }
        if (position.side === "SHORT" && newSl <= markPrice) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `MOVE_TO_BREAKEVEN rejected: proposed SL ${newSl.toFixed(4)} is <= current mark ${markPrice.toFixed(4)}`
          );
          return { success: false, detail: `Breakeven rejected: SL would cross current mark price` };
        }

        await db
          .update(positions)
          .set({
            stopLoss: newSl.toFixed(8),
            updatedAt: new Date(),
            breakevenApplied: true,
          })
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
        positionManagerBus.emit(
          "position:action-executed",
          position.id,
          action,
          "ok",
          `SL moved to breakeven: ${newSl.toFixed(4)}`
        );
        return { success: true, detail: `Stop moved to breakeven @ ${newSl.toFixed(4)}` };
      }

      // ── Trail stop loss ─────────────────────────────────────────────────
      case PA.TRAIL_SL: {
        if (!recommendation.newStopLoss) {
          return { success: false, detail: "TRAIL_SL: no new stop loss value provided" };
        }
        const newSl = recommendation.newStopLoss;

        if (!isSlImprovement(position.side, position.stopLoss, newSl)) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `TRAIL_SL rejected: ${newSl.toFixed(4)} is worse than current ${position.stopLoss?.toFixed(4)}`
          );
          return { success: false, detail: `Trail rejected: would reverse SL` };
        }

        const markPrice = position.markPrice;
        if (position.side === "LONG" && newSl >= markPrice) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `TRAIL_SL rejected: proposed SL ${newSl.toFixed(4)} is >= current mark ${markPrice.toFixed(4)}`
          );
          return { success: false, detail: `Trail rejected: SL would cross current mark price` };
        }
        if (position.side === "SHORT" && newSl <= markPrice) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "failed",
            `TRAIL_SL rejected: proposed SL ${newSl.toFixed(4)} is <= current mark ${markPrice.toFixed(4)}`
          );
          return { success: false, detail: `Trail rejected: SL would cross current mark price` };
        }

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
        positionManagerBus.emit(
          "position:action-executed",
          position.id,
          action,
          "ok",
          `SL trailed to ${newSl.toFixed(4)}`
        );
        return { success: true, detail: `Stop trailed to ${newSl.toFixed(4)}` };
      }

      // ── Tighten / Extend take profit ────────────────────────────────────
      case PA.TIGHTEN_TP:
      case PA.EXTEND_TP: {
        if (!recommendation.newTakeProfit) {
          return { success: false, detail: `${action}: no new take profit value provided` };
        }
        const newTp = recommendation.newTakeProfit;

        if (action === PA.TIGHTEN_TP && position.takeProfit !== null) {
          const isLong = position.side === "LONG";
          const actuallyTightens = isLong
            ? newTp < position.takeProfit   // LONG: tighten = lower TP (closer to mark)
            : newTp > position.takeProfit;  // SHORT: tighten = higher TP (closer to mark)
          if (!actuallyTightens) {
            positionManagerBus.emit(
              "position:action-executed", position.id, action, "failed",
              `TIGHTEN_TP rejected: ${newTp.toFixed(4)} does not tighten vs current ${position.takeProfit.toFixed(4)}`
            );
            return { success: false, detail: `TIGHTEN_TP rejected: wrong direction for ${position.side}` };
          }
        }

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

        if (exitQty <= 0) {
          return { success: false, detail: "PARTIAL_EXIT skipped: exit quantity rounds to zero" };
        }

        if (!position.isPaper) {
          if (!env.placeOrders) {
            return { success: false, detail: "PARTIAL_EXIT skipped: PLACE_ORDERS=false" };
          }
          try {
            const creds = await fetchCredentials(userId);
            const coindcxSide = position.side === "LONG" ? "sell" : "buy";
            const coindcxSymbol = position.symbol.startsWith("B-")
              ? position.symbol
              : `B-${position.symbol.replace("USDT", "_USDT")}`;
            await createFuturesOrder(creds, {
              market: coindcxSymbol,
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
        const partialPnl = (position.side === "LONG" ? 1 : -1) * (position.markPrice - position.entryPrice) * exitQty;
        const prevRealized = position.realizedPnl || 0;
        const nextRealized = prevRealized + partialPnl;

        let newMarginWallet = 0;
        let marginReleasedUsdt = 0;
        if (position.isPaper) {
          const { currency, marginUsdt } = await paperMarginSnapshot(position);
          marginReleasedUsdt = marginUsdt * (exitQty / position.quantity);
          const newMarginUsdt = marginUsdt - marginReleasedUsdt;
          newMarginWallet = await usdtMarginToStored(newMarginUsdt, currency);
          await releasePaperPositionMargin(
            userId,
            marginReleasedUsdt,
            partialPnl,
            position.id,
            currency
          );
        } else {
          newMarginWallet = position.margin * (newQty / position.quantity);
        }

        await db
          .update(positions)
          .set({
            size: newQty.toFixed(8),
            margin: newMarginWallet.toFixed(8),
            realizedPnl: nextRealized.toFixed(8),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, position.id));

        positionStore.updateQuantity(position.id, newQty, newMarginWallet, undefined, nextRealized);
        if (newQty <= 0) {
          positionStore.updateLifecycleState(position.id, "CLOSED");
          positionStore.remove(position.id);
          positionManagerBus.emit("position:closed", position.id, recommendation.reasoning);
        } else {
          positionStore.updateLifecycleState(position.id, "MANAGED");
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
          marginAfter: newMarginWallet,
          metadata: {
            exitPct,
            exitQty,
            marginReleasedUsdt,
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
            const coindcxSymbol = position.symbol.startsWith("B-")
              ? position.symbol
              : `B-${position.symbol.replace("USDT", "_USDT")}`;
            await createFuturesOrder(creds, {
              market: coindcxSymbol,
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
          const { currency, marginUsdt } = await paperMarginSnapshot(position);
          await releasePaperPositionMargin(
            userId,
            marginUsdt,
            realizedPnl,
            position.id,
            currency
          );
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
        if (!position.isPaper) {
          positionManagerBus.emit("position:action-executed", position.id, action, "ok",
            "Scale-in signal emitted to auto-executor");
          return { success: true, detail: "Scale-in event emitted to auto-executor" };
        }

        const dbCfg = getDb();
        const [cfg] = await dbCfg
          .select({
            capitalAllocationPct: autoExecutorConfig.capitalAllocationPct,
            paperStartingBalance: autoExecutorConfig.paperStartingBalance,
            paperCurrency: autoExecutorConfig.paperCurrency,
          })
          .from(autoExecutorConfig)
          .where(eq(autoExecutorConfig.userId, userId))
          .limit(1);
        const paperCurrency = (cfg?.paperCurrency as "USDT" | "INR") ?? "INR";
        const allocPct = parseFloat(cfg?.capitalAllocationPct ?? "0.250");
        const scalePct = recommendation.exitSizePct ?? 0.5;
        const startingBalance = parseFloat(cfg?.paperStartingBalance ?? "100000");
        const pw = await getPaperWallet(userId, startingBalance, paperCurrency);
        const equityUsdt = await walletToUsdt(pw.equity, paperCurrency);
        const addNotionalUsdt = equityUsdt * allocPct * scalePct;
        let addQty = addNotionalUsdt / position.markPrice;
        addQty = await roundQty(position.symbol, addQty);

        if (addQty <= 0) {
          return { success: false, detail: "SCALE_IN skipped: add size rounds to zero" };
        }

        const addMarginUsdt = computeMarginUsdt(addQty, position.markPrice, position.leverage);
        const { currency, marginUsdt, marginWallet } = await paperMarginSnapshot(position);
        const newMarginUsdt = marginUsdt + addMarginUsdt;
        const newMarginWallet = await usdtMarginToStored(newMarginUsdt, currency);
        const newQty = position.quantity + addQty;
        const newEntry =
          (position.entryPrice * position.quantity + position.markPrice * addQty) / newQty;

        await lockPaperPositionMargin(userId, addMarginUsdt, position.id, currency, "position");

        await db
          .update(positions)
          .set({
            size: newQty.toFixed(8),
            margin: newMarginWallet.toFixed(8),
            entryPrice: newEntry.toFixed(8),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, position.id));

        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "SCALE_IN",
          side: position.side === "LONG" ? "long" : "short",
          quantityBefore: position.quantity,
          quantityAfter: newQty,
          quantityDelta: addQty,
          price: position.markPrice,
          avgEntryPrice: newEntry,
          realizedPnl: 0,
          fee: estimateFee(position.markPrice * addQty),
          marginBefore: marginWallet,
          marginAfter: newMarginWallet,
          metadata: {
            addNotionalUsdt,
            addQty,
            scalePct,
            isPaper: true,
          },
        });

        positionStore.updateQuantity(position.id, newQty, newMarginWallet, newEntry);
        positionManagerBus.emit("position:action-executed", position.id, action, "ok",
          `Scaled in ${addQty.toFixed(4)} @ ${position.markPrice.toFixed(4)}`);
        return { success: true, detail: `Scale-in: added ${addQty.toFixed(4)} units` };
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
