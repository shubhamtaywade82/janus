import { getDb } from "../api/queries/connection";
import { positions, orders } from "../db/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  // 1. Get the latest 5 positions
  console.log("=== LATEST 5 POSITIONS ===");
  const latestPos = await db.select().from(positions).orderBy(desc(positions.id)).limit(5);
  console.log(JSON.stringify(latestPos, null, 2));

  // 2. Get the latest 5 orders
  console.log("\n=== LATEST 5 ORDERS ===");
  const latestOrd = await db.select().from(orders).orderBy(desc(orders.id)).limit(5);
  console.log(JSON.stringify(latestOrd, null, 2));
}

main().catch(console.error);
