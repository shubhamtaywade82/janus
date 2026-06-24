import { getDb } from "../api/queries/connection.js";
import { positions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

async function main() {
  const db = getDb();
  const rows = await db.select().from(positions).where(eq(positions.status, 'open'));
  console.log("Drizzle rows:", JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch(console.error);
