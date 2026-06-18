import { getDb } from "../api/queries/connection";
import { tradingAccounts, positions, orders, accountLedger } from "../db/schema";
import { eq, and, notInArray, gt, lt } from "drizzle-orm";
import Decimal from "decimal.js";
import { usdtToWallet } from "../api/services/paper-currency";

async function main() {
  const db = getDb();
  console.log("--- STARTING PAPER MARGIN AND ORDER RECONCILIATION ---");

  // 1. Cancel/reject stale OPEN/PENDING MARKET orders that are older than 2 minutes
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  console.log("Cancelling/rejecting stale market orders older than:", twoMinutesAgo.toISOString());
  
  const staleOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "OPEN"),
        eq(orders.orderType, "MARKET"),
        lt(orders.createdAt, twoMinutesAgo)
      )
    );

  console.log(`Found ${staleOrders.length} stale open market orders.`);

  if (staleOrders.length > 0) {
    const orderIds = staleOrders.map(o => o.id);
    await db
      .update(orders)
      .set({
        status: "REJECTED",
        updatedAt: new Date()
      })
      .where(notInArray(orders.status, ["FILLED", "REJECTED", "CANCELLED"]));
    console.log(`Updated status of all stale orders to REJECTED.`);
  }

  // 2. Reconcile paper trading accounts
  const paperAccounts = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.mode, "paper"));

  for (const account of paperAccounts) {
    console.log(`\nReconciling Account ID: ${account.id} | User: ${account.userId} | Currency: ${account.currency}`);
    
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
      );

    console.log(`Found ${openPositions.length} open positions.`);
    for (const p of openPositions) {
      console.log(`  - Pos #${p.id} | ${p.symbol} | Side: ${p.side} | Margin: ${p.margin} ${p.marginCurrency}`);
    }

    // Sum their margins
    let totalOpenMargin = new Decimal(0);
    for (const p of openPositions) {
      // Margin is stored in USDT in the positions table. Convert to account currency (e.g. INR)
      const marginUsdt = parseFloat(p.margin);
      const marginWallet = await usdtToWallet(marginUsdt, account.currency);
      totalOpenMargin = totalOpenMargin.add(marginWallet);
    }

    console.log(`Total expected locked margin: ${totalOpenMargin.toFixed(8)} ${account.currency}`);
    console.log(`Current locked margin in DB: ${account.lockedMargin} ${account.currency}`);

    const currentLocked = new Decimal(account.lockedMargin);
    if (!currentLocked.equals(totalOpenMargin)) {
      const diff = currentLocked.sub(totalOpenMargin);
      console.log(`Discrepancy detected! Leaked margin to release: ${diff.toFixed(8)} ${account.currency}`);

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
        .where(eq(tradingAccounts.id, account.id));

      console.log(`Account updated:`);
      console.log(`  - locked_margin: ${currentLocked.toFixed(8)} -> ${totalOpenMargin.toFixed(8)}`);
      console.log(`  - available_balance: ${availableBefore.toFixed(8)} -> ${availableAfter.toFixed(8)}`);

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
      });
      console.log("Written adjustment ledger entry.");
    } else {
      console.log("No discrepancy. Locked margin matches open positions.");
    }
  }

  console.log("\n--- RECONCILIATION COMPLETED ---");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
