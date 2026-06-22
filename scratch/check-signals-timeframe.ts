import { getDb } from "../api/queries/connection";
import { signals } from "../db/schema";
import { and, gte, lte } from "drizzle-orm";

async function main() {
  const db = getDb();
  
  // 16:10 to 16:15 UTC is 2026-06-22T16:10:00.000Z to 2026-06-22T16:15:00.000Z
  const startTime = new Date("2026-06-22T16:00:00.000Z");
  const endTime = new Date("2026-06-22T16:20:00.000Z");
  
  console.log(`=== SIGNALS BETWEEN ${startTime.toISOString()} AND ${endTime.toISOString()} ===`);
  const list = await db.select().from(signals).where(
    and(
      gte(signals.createdAt, startTime),
      lte(signals.createdAt, endTime)
    )
  );
  console.log(JSON.stringify(list, null, 2));
}

main().catch(console.error);
