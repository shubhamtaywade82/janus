import { getDb } from "../api/queries/connection";
import { signals } from "../db/schema";
import { globalAutoExecutor } from "../api/services/auto-executor";
import { globalKillSwitch } from "../api/services/kill-switch";

async function run() {
  console.log("Connecting to database...");
  const db = getDb();

  console.log("Ensuring kill switch is inactive...");
  globalKillSwitch.reset();

  console.log("Inserting test signal...");
  const [insertedSignal] = await db.insert(signals).values({
    symbol: "B-BTC_USDT",
    microScore: "85.00",
    intraScore: "85.00",
    swingScore: "85.00",
    compositeScore: "85.00",
    threshold: "75.00",
    isGated: true,
    direction: "long",
    metadata: {
      rsi: 45,
      ema20: 95000,
      ema50: 94000,
      spread: 0.0001,
      imbalance: 0.3
    }
  }).returning();

  console.log("Inserted signal ID:", insertedSignal.id);

  console.log("Triggering auto executor for the batch containing the test signal...");
  // Capture console logs temporarily to show skip/execute details
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  
  console.log = (...args) => { origLog("[AUTO-EXECUTOR LOG]", ...args); };
  console.warn = (...args) => { origWarn("[AUTO-EXECUTOR WARN]", ...args); };
  console.error = (...args) => { origError("[AUTO-EXECUTOR ERROR]", ...args); };

  try {
    await globalAutoExecutor.onSignalBatch([insertedSignal]);
  } finally {
    // Restore console logs
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  
  console.log("Done! Check your /brain console logs or database positions table to confirm creation.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error triggering test signal:", err);
  process.exit(1);
});
