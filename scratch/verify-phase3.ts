import { brainGovernor } from "../api/brain/brain-governor";
import { PaperExecutionAdapter } from "../api/brain/paper-adapter";
import { getDb } from "../api/queries/connection";
import { paperAccounts, paperPositions, paperTrades } from "@db/schema";
import dotenv from "dotenv";
import path from "path";
import { eq } from "drizzle-orm";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

async function main() {
  console.log("=== Phase 3 Verification ===");

  const db = getDb();
  const adapter = new PaperExecutionAdapter();

  // Reset paper accounts tables to guarantee clean test environment
  console.log("Cleaning database paper metrics...");
  await db.delete(paperTrades);
  await db.delete(paperPositions);
  await db.delete(paperAccounts);

  const marketData = {
    current_price: 64200,
    smc_resistance: 65000,
    smc_support: 63000,
  };

  // 1. Verify Governor Checks
  console.log("\n1. Testing BrainGovernor Safety Vetting...");
  try {
    const proposal = {
      mode: "enter" as const,
      symbol: "BTCUSDT",
      side: "long" as const,
      confidence: 0.8,
      rationale: "Bullish breakout support",
      sizePct: 3.0,
      stopLossPct: 1.0,
      takeProfitPct: 3.0,
      riskNotes: [],
      evidence: { market: [], memory: [], signals: [] }
    };

    const govResult = await brainGovernor.check(1, proposal, marketData);
    console.log("✓ Governor result approved:", govResult.approved);
    console.log("✓ Governor adjusted size:", govResult.adjustedSizePct);
  } catch (err: any) {
    console.error("✗ Governor check failed:", err.message);
  }

  // 2. Verify Adapter Entry (fees & slippage)
  console.log("\n2. Testing PaperExecutionAdapter Open Position...");
  let openPos: any = null;
  try {
    openPos = await adapter.openPosition(
      "BTCUSDT",
      "long",
      3.0, // 3.0% size
      64200, // market price
      1.0, // SL
      3.0 // TP
    );
    console.log("✓ Position successfully opened!");
    console.log("✓ Open Position ID:", openPos.id);
    console.log("✓ Slippage adjusted Entry Price:", parseFloat(openPos.entryPrice));
    console.log("✓ Margin Allocated:", parseFloat(openPos.margin));
    console.log("✓ Qty purchased:", parseFloat(openPos.quantity));
    console.log("✓ Stop Loss Price:", parseFloat(openPos.stopLoss));
    console.log("✓ Take Profit Price:", parseFloat(openPos.takeProfit));
  } catch (err: any) {
    console.error("✗ Adapter open failed:", err.message);
  }

  // 3. Verify Adapter Exit & PnL Ledger Writes
  console.log("\n3. Testing PaperExecutionAdapter Close Position...");
  if (openPos) {
    try {
      // Simulate price hitting take-profit at 66500
      await adapter.closePosition(openPos.id, 66500);
      console.log("✓ Position successfully closed!");
      
      const [trade] = await db.select().from(paperTrades).where(eq(paperTrades.positionId, openPos.id)).limit(1);
      console.log("✓ Generated Trade Ledger entry:");
      console.log("  - Realized PnL:", parseFloat(trade.pnl));
      console.log("  - Realized Fees paid:", parseFloat(trade.fees));
      console.log("  - R-multiple:", parseFloat(trade.rMultiple));

      const [account] = await db.select().from(paperAccounts).limit(1);
      console.log("✓ Final Account Balance:", parseFloat(account.currentBalance));
      console.log("✓ Final Account Equity:", parseFloat(account.equity));
    } catch (err: any) {
      console.error("✗ Adapter close failed:", err.message);
    }
  }

  process.exit(0);
}

main();
