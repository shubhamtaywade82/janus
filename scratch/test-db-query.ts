import { getDb } from "../api/queries/connection.ts";
import { positions } from "../db/schema.ts";
import { and, eq, desc } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const db = getDb();
  
  const closedLive = await db.select().from(positions).where(
    and(
      eq(positions.userId, 1),
      eq(positions.status, "closed"),
      eq(positions.isPaper, false)
    )
  ).orderBy(desc(positions.createdAt));
  
  console.log("Closed Live:", closedLive.length);
  
  const closedPaper = await db.select().from(positions).where(
    and(
      eq(positions.userId, 1),
      eq(positions.status, "closed"),
      eq(positions.isPaper, true)
    )
  ).orderBy(desc(positions.createdAt));
  
  console.log("Closed Paper:", closedPaper.length);
  if (closedPaper.length > 0) {
    console.log("Sample Paper:", closedPaper[0]);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
