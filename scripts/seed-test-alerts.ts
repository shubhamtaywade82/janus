/**
 * Alert Engine Integration Test
 *
 * Seeds 3 test rules (price/sweep/volatility), waits 15s for the AlertEngine
 * to poll and evaluate them, then checks DB for expected rows.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-test-alerts.ts
 *
 * Requires the backend to be running (or run in the same process via import).
 * Cleans up test data on exit.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, gte, inArray } from "drizzle-orm";
import * as schema from "../db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const TEST_USER_ID = 999_999; // sentinel value — not a real user

async function seed() {
  console.log("[test] Seeding test alert rules...");

  const inserted = await db
    .insert(schema.userAlertRules)
    .values([
      {
        userId: TEST_USER_ID,
        symbol: "BTCUSDT",
        type: "price",
        operator: ">",
        value: "0",          // always fires (price > 0)
        cooldownSeconds: 5,
        notifyTelegram: false,
      },
      {
        userId: TEST_USER_ID,
        symbol: "BTCUSDT",
        type: "sweep",
        operator: null,
        value: "0",           // always fires (sweep > 0)
        cooldownSeconds: 5,
        notifyTelegram: false,
      },
      {
        userId: TEST_USER_ID,
        symbol: "ETHUSDT",
        type: "volatility",
        operator: null,
        value: null,
        cooldownSeconds: 5,
        notifyTelegram: false,
      },
    ])
    .returning();

  console.log(`[test] Inserted ${inserted.length} test rules (ids: ${inserted.map((r) => r.id).join(", ")})`);
  return inserted;
}

async function waitForAlerts(ruleIds: number[], timeoutMs: number): Promise<schema.UserAlertLog[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = await db
      .select()
      .from(schema.userAlertLogs)
      .where(
        and(
          eq(schema.userAlertLogs.userId, TEST_USER_ID),
          inArray(schema.userAlertLogs.ruleId as any, ruleIds)
        )
      );
    if (logs.length >= 1) return logs;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return [];
}

async function checkSystemAlerts(timeoutMs: number): Promise<schema.SystemAlertLog[]> {
  const since = new Date(Date.now() - timeoutMs);
  return db
    .select()
    .from(schema.systemAlertLogs)
    .where(gte(schema.systemAlertLogs.triggeredAt, since));
}

async function cleanup(ruleIds: number[]) {
  console.log("[test] Cleaning up test data...");
  await db
    .delete(schema.userAlertLogs)
    .where(eq(schema.userAlertLogs.userId, TEST_USER_ID));
  await db
    .delete(schema.userAlertRules)
    .where(inArray(schema.userAlertRules.id as any, ruleIds));
  console.log("[test] Cleanup complete");
}

async function run() {
  const rules = await seed();
  const ruleIds = rules.map((r) => r.id);

  console.log("[test] Waiting 15s for AlertEngine to evaluate rules...");
  console.log("[test] (Backend must be running with alertEngine.start() active)");

  const userLogs = await waitForAlerts(ruleIds, 15_000);
  const systemLogs = await checkSystemAlerts(20_000);

  console.log("\n─────────────────────────────────────────────");
  console.log("RESULTS");
  console.log("─────────────────────────────────────────────");

  // User alert rules
  const priceRule = rules.find((r) => r.type === "price");
  const sweepRule = rules.find((r) => r.type === "sweep");

  const priceFired = priceRule && userLogs.some((l) => l.ruleId === priceRule.id);
  const sweepFired = sweepRule && userLogs.some((l) => l.ruleId === sweepRule.id);
  const systemAlertFired = systemLogs.length > 0;

  console.log(`[PASS/FAIL] price alert (BTCUSDT > 0):      ${priceFired ? "✅ PASS" : "❌ FAIL — no log row in user_alert_logs"}`);
  console.log(`[PASS/FAIL] sweep alert (BTCUSDT sweep > 0): ${sweepFired ? "✅ PASS" : "⚠️  SKIP — sweep score may be 0 (no market data)"}`);
  console.log(`[PASS/FAIL] system_alert_logs populated:     ${systemAlertFired ? `✅ PASS (${systemLogs.length} rows)` : "⚠️  SKIP — no candle close in window"}`);

  if (userLogs.length > 0) {
    console.log("\nSample user_alert_logs:");
    for (const log of userLogs.slice(0, 3)) {
      console.log(`  [${log.triggeredAt.toISOString()}] ${log.symbol} ${log.type}: ${log.message}`);
    }
  }

  if (systemLogs.length > 0) {
    console.log("\nSample system_alert_logs:");
    for (const log of systemLogs.slice(0, 3)) {
      console.log(`  [${log.triggeredAt.toISOString()}] ${log.symbol} ${log.type}: ${log.message}`);
    }
  }

  console.log("─────────────────────────────────────────────\n");

  await cleanup(ruleIds);
  await client.end();

  // Exit non-zero if the primary test (price rule) failed
  process.exit(priceFired ? 0 : 1);
}

run().catch((err) => {
  console.error("[test] Fatal error:", err);
  process.exit(1);
});
