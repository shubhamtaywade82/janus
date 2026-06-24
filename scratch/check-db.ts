import { getDb } from "../api/queries/connection";
import { positions, tradingAccounts, accountLedger } from "../db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  // 1. Get paper trading accounts
  console.log("=== TRADING ACCOUNTS ===");
  const accounts = await db.select().from(tradingAccounts).where(eq(tradingAccounts.mode, "paper"));
  console.log(JSON.stringify(accounts, null, 2));

  // 2. Get open paper positions
  console.log("\n=== OPEN PAPER POSITIONS ===");
  const openPos = await db.select().from(positions).where(and(eq(positions.isPaper, true), eq(positions.status, "open")));
  console.log(JSON.stringify(openPos, null, 2));

  // 3. Get ledger entries
  console.log("\n=== LEDGER ENTRIES (last 20) ===");
  const ledger = await db.select().from(accountLedger).orderBy(accountLedger.id).limit(20);
  console.log(JSON.stringify(ledger, null, 2));
}

main().catch(console.error);
