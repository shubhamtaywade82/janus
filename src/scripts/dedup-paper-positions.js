#!/usr/bin/env node
// src/scripts/dedup-paper-positions.js

import { getDb } from "../../api/queries/connection.ts";
import { positions } from "../../db/schema.ts";
import { and, eq, desc } from "drizzle-orm";
import { weightedEntryPrice } from "../lib/position-utils.ts";

/**
 * One‑off script to merge duplicate open paper positions.
 * Run with: node src/scripts/dedup-paper-positions.js
 */
async function main() {
  const db = getDb();

  // 1️⃣ Fetch all open paper positions
  const paperRows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.isPaper, true), eq(positions.status, "open")))
    .orderBy(desc(positions.createdAt));

  // 2️⃣ Group by userId|symbol|side
  const groups = {};
  for (const row of paperRows) {
    const key = `${row.userId}|${row.symbol}|${row.side}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  // 3️⃣ Process each group with more than one row
  for (const [key, rows] of Object.entries(groups)) {
    if (rows.length <= 1) continue;
    console.log(`🔎 Deduping ${rows.length} rows for ${key}`);

    // sort oldest→newest so latest holds optional fields
    rows.sort((a, b) => Number(a.id) - Number(b.id));

    let totalSize = 0;
    let totalMargin = 0;
    let entryPrice = "0";
    for (const r of rows) {
      const size = parseFloat(r.size) || 0;
      const margin = parseFloat(r.margin) || 0;
      totalSize += size;
      totalMargin += margin;
      entryPrice = weightedEntryPrice(entryPrice, totalSize - size, r.entryPrice, r.size);
    }

    const latest = rows[rows.length - 1];
    const stopLoss = latest.stopLoss ?? null;
    const takeProfit = latest.takeProfit ?? null;
    const liquidationPrice = latest.liquidationPrice ?? null;
    const currentPrice = latest.currentPrice;

    // Delete old rows (drizzle lacks bulk delete, so loop)
    for (const r of rows) {
      await db.delete(positions).where(eq(positions.id, r.id)).execute();
    }

    // Insert merged row
    const [merged] = await db
      .insert(positions)
      .values({
        userId: latest.userId,
        symbol: latest.symbol,
        side: latest.side,
        entryPrice,
        currentPrice,
        size: totalSize.toString(),
        leverage: latest.leverage,
        margin: totalMargin.toString(),
        liquidationPrice,
        stopLoss,
        takeProfit,
        signalId: null,
        strategyType: latest.strategyType,
        unrealizedPnl: "0",
        realizedPnl: "0",
        status: "open",
        isPaper: true,
        marginMode: latest.marginMode ?? "isolated",
        marginCurrency: latest.marginCurrency ?? "USDT",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: positions.id });

    console.log(`✅ Created merged position id=${merged.id}`);
  }

  console.log("🟢 Deduplication complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
