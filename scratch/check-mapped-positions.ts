import { tradingRouter } from "../api/routers/trading-router";
import { getDb } from "../api/queries/connection";
import { positions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { mapPaperPosition } from "../api/services/trading-service";

async function main() {
  const db = getDb();
  
  // Call mapPaperPosition for all open paper positions
  const openPos = await db.select().from(positions).where(and(eq(positions.isPaper, true), eq(positions.status, "open")));
  console.log("=== MAPPED PAPER POSITIONS ===");
  for (const p of openPos) {
    const mapped = mapPaperPosition(p, [], 100.28);
    console.log(`${mapped.symbol}: margin=${mapped.margin} marginCurrency=${mapped.marginCurrency} initialMargin=${mapped.initialMargin} roe=${mapped.roe} unrealizedPnl=${mapped.unrealizedPnl}`);
  }
}

main().catch(console.error);
