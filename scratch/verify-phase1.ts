import { toolRegistry } from "../api/brain/tool-registry";
import { callLLM } from "../api/services/ollama";
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

async function main() {
  console.log("=== Phase 1 Verification ===");

  // 1. Verify Market Snapshot
  console.log("\n1. Testing ToolRegistry - Market Snapshot for 'BTCUSDT'...");
  try {
    const market = toolRegistry.getMarketSnapshot("BTCUSDT");
    console.log("✓ Market Snapshot Success:", JSON.stringify(market, null, 2));
  } catch (err: any) {
    console.error("✗ Market Snapshot Failed:", err.message);
  }

  // 2. Verify Portfolio Snapshot
  console.log("\n2. Testing ToolRegistry - Portfolio Snapshot for User ID 1...");
  try {
    const portfolio = await toolRegistry.getPortfolioSnapshot(1);
    console.log("✓ Portfolio Snapshot Success:", JSON.stringify(portfolio, null, 2));
  } catch (err: any) {
    console.error("✗ Portfolio Snapshot Failed:", err.message);
  }

  // 3. Verify Ollama Connection
  console.log("\n3. Testing LLM connection...");
  try {
    const response = await callLLM("Respond with exactly 'Ollama Connected' if you receive this message.");
    console.log("✓ LLM Response Received:", JSON.stringify(response.trim()));
  } catch (err: any) {
    console.error("✗ LLM connection failed:", err.message);
  }
  
  process.exit(0);
}

main();
