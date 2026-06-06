import { evolveStrategies } from "../api/brain/brain-evolution";
import { getDb } from "../api/queries/connection";
import { brainStrategies, brainEpisodes } from "@db/schema";
import dotenv from "dotenv";
import path from "path";
import { eq } from "drizzle-orm";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

async function main() {
  console.log("=== Phase 5 Verification ===");

  const db = getDb();

  // Seed two base strategies to enable crossover comparison
  console.log("Seeding base strategies...");
  await db.delete(brainStrategies);

  await db.insert(brainStrategies).values([
    {
      name: "Trend_Follower",
      description: "Standard Trend follow model",
      promptTemplate: "You are a trend follower. Buy on bullish candle closes near EMA20.",
      parameters: { mode: "trend" },
      active: true,
      sharpRatio: "1.2000"
    },
    {
      name: "Range_Reverter",
      description: "Range Bollinger Band reversion model",
      promptTemplate: "You are a range reverter. Buy below lower Bollinger Band, sell above upper BB.",
      parameters: { mode: "reversion" },
      active: false,
      sharpRatio: "0.8000"
    }
  ]);

  // Seed mock episodes representing history
  await db.delete(brainEpisodes);
  await db.insert(brainEpisodes).values([
    {
      marketSymbol: "BTCUSDT",
      observation: { trend: "bullish" },
      outcomePnl: "150.00000000"
    },
    {
      marketSymbol: "BTCUSDT",
      observation: { trend: "bullish" },
      outcomePnl: "-50.00000000"
    }
  ]);

  // Trigger Strategy Evolution Run
  console.log("\nTriggering EvolveStrategies Cycle...");
  try {
    await evolveStrategies();
    console.log("✓ Evolution cycle finished!");

    // Inspect the strategy table results
    const strategies = await db.select().from(brainStrategies);
    console.log("\n✓ Scored & Updated Strategy Profiles in Postgres:");
    strategies.forEach(s => {
      console.log(`  - Strategy '${s.name}':`);
      console.log(`    * Sharpe Ratio: ${s.sharpRatio}`);
      console.log(`    * Total PnL: ${s.totalPnl}`);
      console.log(`    * Win Rate: ${s.winRate}%`);
      console.log(`    * Active Status: ${s.active}`);
      console.log(`    * Prompt Snippet: "${s.promptTemplate?.replace(/\n/g, ' ')}"`);
    });
  } catch (err: any) {
    console.error("✗ Evolution cycle failed:", err.message);
  }

  process.exit(0);
}

main();
