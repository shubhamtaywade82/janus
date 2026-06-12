import { getDb } from "../api/queries/connection";
import { positions } from "../db/schema";
import { eq, like } from "drizzle-orm";

async function main() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: positions.id,
        symbol: positions.symbol,
        side: positions.side,
        entryPrice: positions.entryPrice,
        size: positions.size,
        status: positions.status,
        isPaper: positions.isPaper,
        entryReason: positions.entryReason,
        exitReason: positions.exitReason,
        createdAt: positions.createdAt,
      })
      .from(positions)
      .where(like(positions.entryReason, "%Orphan%"))
      .limit(10);
    
    console.log("ORPHAN POSITIONS (first 10):");
    console.log(JSON.stringify(rows, null, 2));

    const totalCount = await db
      .select({ count: positions.id })
      .from(positions);
    
    const paperCount = totalCount.filter(p => p.isPaper === true).length;
    const liveCount = totalCount.filter(p => p.isPaper === false).length;
    console.log(`Total count: ${totalCount.length}, Paper count: ${paperCount}, Live count: ${liveCount}`);

    process.exit(0);
  } catch (e) {
    console.error("Error running query:", e);
    process.exit(1);
  }
}

main();
