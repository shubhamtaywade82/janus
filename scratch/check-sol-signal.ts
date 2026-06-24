import { getDb } from "../api/queries/connection";
import { positions, orders, signals } from "../db/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  console.log("=== SOLUSDT ORDERS ===");
  const solOrders = await db.select().from(orders).where(eq(orders.symbol, "SOLUSDT")).orderBy(desc(orders.id));
  console.log(JSON.stringify(solOrders, null, 2));

  console.log("\n=== SOLUSDT SIGNALS ===");
  const solSignals = await db.select().from(signals).where(eq(signals.symbol, "SOLUSDT")).orderBy(desc(signals.id)).limit(10);
  console.log(JSON.stringify(solSignals, null, 2));
  
  console.log("\n=== B-SOL_USDT SIGNALS ===");
  const bsolSignals = await db.select().from(signals).where(eq(signals.symbol, "B-SOL_USDT")).orderBy(desc(signals.id)).limit(10);
  console.log(JSON.stringify(bsolSignals, null, 2));
}

main().catch(console.error);
