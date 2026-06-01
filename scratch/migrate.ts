import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const db = getDb();
  console.log("Applying manual migrations sequentially...");

  // 1. Deduplicate first
  console.log("Executing deduplication...");
  await db.execute(sql`
    DELETE FROM market_data a USING market_data b
    WHERE a.id < b.id
      AND a.symbol = b.symbol
      AND a.timeframe = b.timeframe
      AND a.timestamp = b.timestamp;
  `);
  console.log("Deduplication complete.");

  // 2. Immediately apply the UNIQUE constraint
  console.log("Applying unique constraint...");
  try {
    await db.execute(sql`ALTER TABLE "market_data" ADD CONSTRAINT "uq_market_data" UNIQUE("symbol","timeframe","timestamp");`);
    console.log("Unique constraint applied successfully!");
  } catch (err: any) {
    const pgErr = err.cause || err;
    if (pgErr.code === "42P07" || pgErr.code === "42710" || pgErr.message?.includes("already exists")) {
      console.log("Unique constraint already exists.");
    } else {
      console.error("Failed to apply unique constraint:", err);
    }
  }

  // 3. Apply other statements
  const migrationPath = path.resolve(process.cwd(), "db/migrations/0002_fantastic_praxagora.sql");
  const fileContent = fs.readFileSync(migrationPath, "utf-8");
  const statements = fileContent.split("--> statement-breakpoint");

  for (let stmt of statements) {
    stmt = stmt.trim();
    if (!stmt) continue;

    // Skip transactions table creation and uq_market_data (already run or handled)
    if (stmt.includes('CREATE TABLE "transactions"') || stmt.includes('ALTER TABLE "transactions"') || stmt.includes('uq_market_data')) {
      continue;
    }

    console.log(`Executing statement: ${stmt.slice(0, 80)}...`);
    try {
      await db.execute(sql.raw(stmt));
      console.log("SUCCESS");
    } catch (err: any) {
      const pgErr = err.cause || err;
      if (pgErr.code === "42P07" || pgErr.code === "42710" || pgErr.message?.includes("already exists")) {
        console.log("SUCCESS (already existed)");
      } else {
        console.warn("WARNING/ERROR:", err);
      }
    }
  }

  console.log("Manual migrations complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
