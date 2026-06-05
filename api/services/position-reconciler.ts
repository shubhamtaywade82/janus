/**
 * Boot-time position reconciliation.
 *
 * Fetches live exchange positions from CoinDCX and compares them against DB
 * rows with status="open". Any DB row that has no matching live position on
 * the exchange is presumed closed (crash, manual close, liquidation) and is
 * marked status="closed" with closedAt=now().
 *
 * This prevents the auto-executor's duplicate-position gate from blocking new
 * entries after a server restart when the position was already closed on the
 * exchange while the server was down.
 *
 * Only runs when PLACE_ORDERS=true (paper-mode servers have no live positions).
 */

import { getDb } from "../queries/connection";
import { positions, exchangeCredentials } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { getFuturesPositions } from "./coindcx";
import { decryptCreds } from "../lib/crypto";
import { env } from "../lib/env";

export async function reconcilePositionsOnBoot(): Promise<void> {
  if (!env.placeOrders) {
    console.log("[reconciler] PLACE_ORDERS=false — skipping live reconciliation");
    return;
  }

  const db = getDb();

  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.isActive, true)))
    .limit(1);

  if (!creds[0]) {
    console.log("[reconciler] No credentials — skipping reconciliation");
    return;
  }

  let livePositions: any[];
  try {
    livePositions = await getFuturesPositions(decryptCreds(creds[0]));
  } catch (err) {
    console.warn("[reconciler] Could not fetch live positions:", err);
    return;
  }

  // Build a set of exchange order IDs that are still open on the exchange
  const liveOrderIds = new Set<string>(
    livePositions
      .filter((p: any) => parseFloat(p.active_pos ?? p.quantity ?? "0") !== 0)
      .map((p: any) => String(p.id ?? p.order_id ?? ""))
      .filter(Boolean)
  );

  const dbOpen = await db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, 1), eq(positions.status, "open"), eq(positions.isPaper, false)));

  let staleCount = 0;
  for (const pos of dbOpen) {
    // Positions with no exchangeOrderId cannot be verified — skip them
    if (!pos.exchangeOrderId) continue;

    if (!liveOrderIds.has(pos.exchangeOrderId)) {
      await db
        .update(positions)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(positions.id, pos.id));
      staleCount++;
      console.log(
        `[reconciler] Marked stale DB position closed: id=${pos.id} ` +
        `symbol=${pos.symbol} exchangeOrderId=${pos.exchangeOrderId}`
      );
    }
  }

  console.log(
    `[reconciler] Reconciliation complete — ${dbOpen.length} DB open, ` +
    `${livePositions.length} live, ${staleCount} stale closed`
  );
}
