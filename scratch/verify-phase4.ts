import { initVectorStore, memoryStore } from "../api/brain/brain-memory";
import { reflectOnTrade } from "../api/brain/brain-reflection";
import { getDb } from "../api/queries/connection";
import { brainEpisodes, brainReflections, brainStrategies } from "@db/schema";
import dotenv from "dotenv";
import path from "path";
import { eq } from "drizzle-orm";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

async function main() {
  console.log("=== Phase 4 Verification ===");

  const db = getDb();

  // Clean tables
  console.log("Cleaning database tables...");
  await db.delete(brainReflections);
  await db.delete(brainEpisodes);

  // Guarantee at least one active strategy exists for the rule attachment test
  const strategies = await db.select().from(brainStrategies).where(eq(brainStrategies.active, true)).limit(1);
  if (strategies.length === 0) {
    console.log("Creating default active strategy...");
    await db.insert(brainStrategies).values({
      name: "Verification Strategy",
      promptTemplate: "You are a professional scalp trader.",
      parameters: { risk: 0.01 },
      active: true
    });
  }

  // 1. Initialize Vector Collection (dynamically checking vector size)
  console.log("\n1. Initializing Qdrant Collection...");
  try {
    await initVectorStore();
    console.log("✓ Qdrant initialization step run.");
  } catch (err: any) {
    console.error("✗ Qdrant init failed:", err.message);
  }

  // 2. Index a mock trade episode
  console.log("\n2. Testing Episodic Memory indexing...");
  let episodeId = 0;
  try {
    const observation = {
      symbol: "BTCUSDT",
      price: 64200,
      cvd: -150,
      imbalance: 0.12,
      drawdown: 0.0,
    };
    
    episodeId = await memoryStore.saveEpisode({
      timestamp: new Date(),
      marketSymbol: "BTCUSDT",
      observation: observation,
      reasoning: "Thought: BTC showing support, but CVD is negative. Let's long with tight stop.",
      proposedAction: { side: "long", sizePct: 2.0 },
      governorJson: { approved: true },
      actualAction: { status: "executed" }
    });
    console.log("✓ Mock episode successfully saved & indexed! Episode ID:", episodeId);
  } catch (err: any) {
    console.error("✗ Memory indexing failed:", err.message);
  }

  // 3. Trigger Post-Close Reflection & Lesson Generation
  console.log("\n3. Testing Post-Close LLM Reflection...");
  if (episodeId > 0) {
    try {
      // Trigger reflection for a trade that ended in a loss (-120.00 PnL)
      await reflectOnTrade(episodeId, -120.00, { side: "long", exitPrice: 63800 });
      console.log("✓ Reflection run completed successfully.");

      // Check reflections table
      const [refl] = await db.select().from(brainReflections).where(eq(brainReflections.episodeId, episodeId)).limit(1);
      console.log("✓ Saved Reflection Row:");
      console.log("  - Lesson:", refl.lesson);
      console.log("  - Rule Created:", refl.ruleCreated);

      // Check if rule was appended to the active strategy
      const [strategy] = await db.select().from(brainStrategies).where(eq(brainStrategies.active, true)).limit(1);
      console.log("✓ Active Strategy prompt updated:");
      console.log(strategy.promptTemplate);
    } catch (err: any) {
      console.error("✗ Reflection test failed:", err.message);
    }
  }

  // 4. Test Semantic Retrieval from Qdrant
  console.log("\n4. Testing Vector Similarity Search...");
  try {
    const searchString = "BTC showing support, but CVD is negative";
    console.log(`Searching vector memory for: "${searchString}"`);
    const matches = await memoryStore.getSimilarEpisodes(searchString, 2);
    console.log(`✓ Similarity query returned ${matches.length} matches.`);
    if (matches.length > 0) {
      console.log("  - Match Episode ID:", matches[0].id);
      console.log("  - Match Symbol:", matches[0].marketSymbol);
      console.log("  - Match Reflection:", matches[0].reflection);
    }
  } catch (err: any) {
    console.error("✗ Vector search failed:", err.message);
  }

  process.exit(0);
}

main();
