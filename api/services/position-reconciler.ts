/**
 * Position Reconciler
 *
 * Compares open positions in the DB against live CoinDCX exchange state and
 * corrects discrepancies. Runs:
 *   - Immediately on `start()` (boot-time reconciliation)
 *   - Every 5 minutes while the process is alive (continuous reconciliation)
 *
 * Cases handled:
 *   DB=open  + Exchange=closed  → mark DB row closed (crash / manual close / liquidation)
 *   DB=open  + Exchange=open    + size mismatch → update DB size to match exchange
 *   DB=closed + Exchange=open   → send ORPHAN ALERT (manual intervention required)
 *
 * Only runs when PLACE_ORDERS=true — paper-mode servers have no live positions.
 */

import { getDb } from "../queries/connection";
import { positions, exchangeCredentials, orders, tradingAccounts, accountLedger } from "@db/schema";
import { eq, and, lt, inArray } from "drizzle-orm";
import { getFuturesPositions } from "./coindcx";
import { decryptCreds } from "../lib/crypto";
import { broadcastTelegramAlert } from "./telegram";
import { env, coinDCXEnvCreds } from "../lib/env";
import Decimal from "decimal.js";
import { usdtToWallet } from "./paper-currency";

const RECONCILE_INTERVAL_MS = 5 * 60_000; // every 5 minutes

class PositionReconciler {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.intervalId) return; // already running

    // Run immediately, then on schedule
    this.reconcile().catch((err) =>
      console.error("[reconciler] Boot reconciliation failed:", err)
    );

    this.intervalId = setInterval(() => {
      this.reconcile().catch((err) =>
        console.error("[reconciler] Scheduled reconciliation failed:", err)
      );
    }, RECONCILE_INTERVAL_MS);

    console.log("[reconciler] Started (interval=5m)");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[reconciler] Stopped");
    }
  }

  async reconcile(): Promise<void> {
    // Position reconciliation runs regardless of PLACE_ORDERS so live positions
    // are always tracked locally for monitoring and portfolio display.
    const db = getDb();

    // Reconcile paper trading accounts (stale market orders and leaked locked margin)
    try {
      await this.reconcilePaperAccounts(db);
    } catch (err) {
      console.error("[reconciler] Paper account reconciliation failed:", err);
    }

    const dbCreds = await db
      .select()
      .from(exchangeCredentials)
      .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
      .limit(1)
      .catch(() => []);

    const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;
    if (!coindcxCreds) return;

    let livePositions: any[];
    try {
      livePositions = await getFuturesPositions(coindcxCreds);
    } catch (err) {
      console.warn("[reconciler] Could not fetch live positions:", err);
      return;
    }

    // Index live positions by exchangeOrderId and by pair (for orphan detection)
    const liveByOrderId = new Map<string, any>();
    const liveByPair = new Map<string, any>();
    for (const lp of livePositions) {
      const id = String(lp.id ?? lp.order_id ?? "");
      if (id) liveByOrderId.set(id, lp);
      const pair = lp.pair ?? lp.symbol ?? "";
      if (pair) liveByPair.set(pair, lp);
    }

    const dbOpen = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open"), eq(positions.isPaper, false)))
      .catch(() => []);

    let closedCount = 0;
    let updatedCount = 0;

    for (const pos of dbOpen) {
      if (!pos.exchangeOrderId) continue;

      const live = liveByOrderId.get(pos.exchangeOrderId);
      const liveQty = live ? parseFloat(live.active_pos ?? live.quantity ?? "0") : 0;

      if (!live || liveQty === 0) {
        // Exchange has no matching position — it was closed externally
        await db
          .update(positions)
          .set({
            status: "closed",
            exitReason: "Reconciled: closed externally on exchange (manual/liq)",
            closedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(positions.id, pos.id))
          .catch(() => {});
        closedCount++;
        console.log(
          `[reconciler] Closed stale DB position: id=${pos.id} symbol=${pos.symbol} ` +
          `exchangeOrderId=${pos.exchangeOrderId}`
        );
        await broadcastTelegramAlert(
          `⚠️ <b>Reconciled:</b> ${pos.symbol} pos #${pos.id} marked closed\n` +
          `(exchange has no active position — crash or manual close)`
        ).catch(() => {});
      } else {
        // Position still live — check for size mismatch
        const dbSize = parseFloat(String(pos.size));
        if (Math.abs(liveQty - dbSize) > 0.000_001) {
          await db
            .update(positions)
            .set({ size: String(liveQty), updatedAt: new Date() })
            .where(eq(positions.id, pos.id))
            .catch(() => {});
          updatedCount++;
          console.log(
            `[reconciler] Updated size for pos #${pos.id} ${pos.symbol}: ` +
            `${dbSize} → ${liveQty}`
          );
          await broadcastTelegramAlert(
            `⚠️ <b>Reconciled:</b> ${pos.symbol} pos #${pos.id} size updated\n` +
            `${dbSize.toFixed(6)} → ${liveQty.toFixed(6)}`
          ).catch(() => {});
        }
      }
    }

    // Orphan detection: exchange has a position that DB doesn't know about.
    // Only auto-import orphans if the bot is allowed to place orders (live trade mode).
    // In paper mode or monitor mode, we do not want to auto-import live positions
    // since we cannot execute orders to close them, which would cause an infinite
    // loop of DB imports and virtual closures.
    if (env.placeOrders) {
      const dbSymbols = new Set(dbOpen.map((p) => `B-${p.symbol.replace("USDT", "_USDT")}`));
      for (const [pair, lp] of liveByPair) {
        const qty = parseFloat(lp.active_pos ?? lp.quantity ?? "0");
        if (qty !== 0 && !dbSymbols.has(pair)) {
          const symbol = pair.replace("B-", "").replace("_", "");
          console.log(
            `[reconciler] AUTO-IMPORTING ORPHAN POSITION: ${pair} qty=${qty}`
          );
          
          // Use exchange data to create DB entry
          const side = parseFloat(lp.active_pos) > 0 ? "long" : "short";
          const markPrice = parseFloat(lp.mark_price || "0");
          const entryPrice = parseFloat(lp.entry_price || lp.avg_entry_price || "0") || markPrice;
          const leverage = parseInt(lp.leverage || "1");
          const calculatedMargin = (Math.abs(qty) * entryPrice) / leverage;
          const margin = parseFloat(lp.locked_margin || lp.locked_user_margin || lp.position_margin || "0") || calculatedMargin;

          if (entryPrice <= 0) {
            console.warn(`[reconciler] Skipping orphan import for ${pair}: zero entry price`);
            continue;
          }

          try {
            await db.insert(positions).values({
              userId: 1,
              symbol,
              side,
              entryPrice: String(entryPrice),
              currentPrice: String(markPrice || entryPrice),
              size: String(Math.abs(qty)),
              leverage,
              margin: String(margin),
              status: "open",
              isPaper: false,
              exchangeOrderId: String(lp.id || lp.order_id || ""),
              entryReason: "Auto-imported: Orphan live position detected during reconciliation",
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            await broadcastTelegramAlert(
              `✅ <b>Live Position Imported:</b> ${symbol} ${side.toUpperCase()}\n` +
              `Size: ${Math.abs(qty)}, Entry: ${entryPrice}\n` +
              ` Janus is now tracking and managing this position.`
            ).catch(() => {});
          } catch (err) {
            console.error(`[reconciler] Failed to import orphan position ${pair}:`, err);
          }
        }
      }
    }

    if (closedCount > 0 || updatedCount > 0) {
      console.log(
        `[reconciler] Done — ${dbOpen.length} DB open, ${livePositions.length} live, ` +
        `${closedCount} closed, ${updatedCount} size-corrected`
      );
    }
  }

  async reconcilePaperAccounts(db: any): Promise<void> {
    // A. Cancel/reject stale OPEN/PENDING MARKET orders that are older than 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const staleOrders = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, "OPEN"),
          eq(orders.orderType, "MARKET"),
          lt(orders.createdAt, twoMinutesAgo)
        )
      )
      .catch(() => []);

    if (staleOrders.length > 0) {
      const orderIds = staleOrders.map((o: any) => o.id);
      await db
        .update(orders)
        .set({
          status: "REJECTED",
          updatedAt: new Date()
        })
        .where(
          and(
            inArray(orders.id, orderIds),
            inArray(orders.status, ["OPEN", "PENDING"])
          )
        )
        .catch((err: any) => console.error("[reconciler] Failed to reject stale orders:", err));
      console.log(`[reconciler] Rejected ${staleOrders.length} stale open market orders.`);
    }

    // B. Reconcile paper trading accounts margins
    const paperAccounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.mode, "paper"))
      .catch(() => []);

    for (const account of paperAccounts) {
      // Find all open positions for this user/account
      const openPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, account.userId),
            eq(positions.isPaper, true),
            eq(positions.status, "open"),
            eq(positions.marginCurrency, account.currency)
          )
        )
        .catch(() => []);

      // Sum their margins
      let totalOpenMargin = new Decimal(0);
      for (const p of openPositions) {
        // Margin is stored in USDT in the positions table. Convert to account currency (e.g. INR)
        const marginUsdt = parseFloat(p.margin);
        const marginWallet = await usdtToWallet(marginUsdt, account.currency);
        totalOpenMargin = totalOpenMargin.add(marginWallet);
      }

      const currentLocked = new Decimal(account.lockedMargin);
      if (!currentLocked.equals(totalOpenMargin)) {
        const diff = currentLocked.sub(totalOpenMargin);
        console.log(
          `[reconciler] Margin discrepancy for Account ID ${account.id} (${account.currency})! ` +
          `Expected: ${totalOpenMargin.toFixed(8)}, Got: ${currentLocked.toFixed(8)}. Releasing: ${diff.toFixed(8)}`
        );

        const availableBefore = new Decimal(account.availableBalance);
        const availableAfter = availableBefore.add(diff);

        // Update the trading account
        await db
          .update(tradingAccounts)
          .set({
            lockedMargin: totalOpenMargin.toFixed(8),
            usedMargin: totalOpenMargin.toFixed(8),
            availableBalance: availableAfter.toFixed(8),
            freeMargin: Decimal.max(0, availableAfter).toFixed(8),
            updatedAt: new Date()
          })
          .where(eq(tradingAccounts.id, account.id))
          .catch((err: any) => console.error("[reconciler] Failed to update paper account margin:", err));

        // Write a ledger entry for the adjustment
        await db.insert(accountLedger).values({
          accountId: account.id,
          eventType: "release_margin",
          debit: "0.00000000",
          credit: diff.toFixed(8),
          balanceBefore: availableBefore.toFixed(8),
          balanceAfter: availableAfter.toFixed(8),
          referenceType: "adjustment",
          referenceId: 0,
          metadata: {
            note: "Reconciled leaked locked margin from stale orders",
            expectedLocked: totalOpenMargin.toNumber(),
            currentLocked: currentLocked.toNumber(),
            diff: diff.toNumber()
          }
        }).catch(() => {});
      }
    }
  }
}

export const positionReconciler = new PositionReconciler();

// Legacy export kept for backward compat — boot.ts already calls positionReconciler.start()
export async function reconcilePositionsOnBoot(): Promise<void> {
  return positionReconciler.reconcile();
}
