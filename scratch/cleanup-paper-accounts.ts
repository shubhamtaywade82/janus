import { getDb } from "../api/queries/connection";
import { tradingAccounts, accountLedger, accountSnapshots } from "../db/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const db = getDb();

  console.log("Starting consolidation of duplicate trading accounts...");

  await db.transaction(async (tx) => {
    // 1. Update ledger entries pointing to accounts 2, 3, 4 to point to account 1
    console.log("Updating account_ledger entries...");
    await tx
      .update(accountLedger)
      .set({ accountId: 1 })
      .where(inArray(accountLedger.accountId, [2, 3, 4]));

    // 2. Update snapshots pointing to accounts 2, 3, 4 to point to account 1
    console.log("Updating account_snapshots...");
    await tx
      .update(accountSnapshots)
      .set({ accountId: 1 })
      .where(inArray(accountSnapshots.accountId, [2, 3, 4]));

    // 3. Update Account ID 1 fields to copy the state of Account ID 2 (what's currently shown on the UI)
    console.log("Updating Account ID 1 values to match Account ID 2...");
    const [acc2] = await tx
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, 2))
      .limit(1);

    if (acc2) {
      await tx
        .update(tradingAccounts)
        .set({
          walletBalance: acc2.walletBalance,
          availableBalance: acc2.availableBalance,
          lockedMargin: acc2.lockedMargin,
          realizedPnl: acc2.realizedPnl,
          unrealizedPnl: acc2.unrealizedPnl,
          equity: acc2.equity,
          usedMargin: acc2.usedMargin,
          freeMargin: acc2.freeMargin,
          peakEquity: acc2.peakEquity,
          drawdown: acc2.drawdown,
          totalFeesPaid: acc2.totalFeesPaid,
          tradeCount: acc2.tradeCount,
          winCount: acc2.winCount,
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, 1));
    }

    // 4. Delete duplicate accounts 2, 3, and 4
    console.log("Deleting duplicate accounts...");
    await tx
      .delete(tradingAccounts)
      .where(inArray(tradingAccounts.id, [2, 3, 4]));

    console.log("Consolidation transaction complete.");
  });
}

main().catch(console.error);
