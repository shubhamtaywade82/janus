import { getDb } from "../api/queries/connection";
import { tradingAccounts, accountLedger } from "../db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  const accounts = await db.select().from(tradingAccounts);
  console.log("=== ALL TRADING ACCOUNTS ===");
  console.log(JSON.stringify(accounts, null, 2));

  console.log("\n=== LEDGER COUNT PER ACCOUNT ===");
  for (const acc of accounts) {
    const ledgerRows = await db.select().from(accountLedger).where(eq(accountLedger.accountId, acc.id));
    console.log(`Account ID ${acc.id} (${acc.mode} - ${acc.currency}): ${ledgerRows.length} ledger entries`);
  }
}

main().catch(console.error);
