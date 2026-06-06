import { BrainOrchestrator } from "../api/brain/brain-orchestrator";
import { brainRouter } from "../api/routers/brain-router";
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

async function main() {
  console.log("=== Phase 2 Verification ===");

  const orchestrator = new BrainOrchestrator(true); // Shadow mode
  const symbol = "BTCUSDT";
  const userId = 1;

  // 1. Verify ReAct Orchestration and DB Write
  console.log("\n1. Testing BrainOrchestrator ReAct Decision Loop...");
  try {
    const result = await orchestrator.decide(symbol, userId, { signalName: "BTC_Breakout", score: 85 });
    console.log("✓ Decision Completed successfully!");
    console.log("✓ Episode ID created:", result.episodeId);
    console.log("✓ Decision Mode Proposed:", result.decision.mode);
    console.log("✓ Suggested Side:", result.decision.side || "HOLD");
    console.log("✓ Confidence:", result.decision.confidence);
    console.log("✓ Rationale:", result.decision.rationale);
  } catch (err: any) {
    console.error("✗ Orchestrator decide failed:", err.message);
  }

  // 2. Verify Hono Router `/episodes` endpoint using in-memory request matching
  console.log("\n2. Testing Hono brainRouter '/episodes' REST endpoint...");
  try {
    const response = await brainRouter.request("/episodes?limit=5");
    if (response.status === 200) {
      const data = await response.json();
      console.log("✓ HTTP GET /episodes returned Status 200 OK!");
      console.log(`✓ Retrieved ${data.length} episodes from Postgres.`);
      if (data.length > 0) {
        console.log("✓ Latest Episode ID from HTTP Response:", data[0].id);
        console.log("✓ Market Symbol:", data[0].marketSymbol);
      }
    } else {
      console.error(`✗ HTTP GET /episodes failed with status ${response.status}`);
    }
  } catch (err: any) {
    console.error("✗ Router request failed:", err.message);
  }

  process.exit(0);
}

main();
