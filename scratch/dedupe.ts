import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  console.log("Cleaning up duplicate candles in market_data...");
  
  // PostgreSQL query to delete duplicates in market_data
  const query = sql`
    DELETE FROM market_data a USING market_data b
    WHERE a.id < b.id
      AND a.symbol = b.symbol
      AND a.timeframe = b.timeframe
      AND a.timestamp = b.timestamp;
  `;
  
  const res = await db.execute(query);
  console.log("Cleanup finished!", res);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
