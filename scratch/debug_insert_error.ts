import fs from "fs";
import { getDb } from "../api/queries/connection";
import { brainEpisodes } from "../db/schema";

async function main() {
  const content = fs.readFileSync("logs/combined.log", "utf-8");
  const lines = content.split("\n");
  
  // Find the last "Database write error" and its corresponding "params:" line
  let errorIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("Database write error: Failed query")) {
      errorIndex = i;
      break;
    }
  }

  if (errorIndex === -1) {
    console.error("No database write error found in logs.");
    return;
  }

  console.log("Found error line at index:", errorIndex);
  console.log(lines[errorIndex]);

  // Find the params line following the error
  let paramsLine = "";
  for (let i = errorIndex + 1; i < lines.length; i++) {
    if (lines[i].includes("params: ")) {
      paramsLine = lines[i];
      break;
    }
  }

  if (!paramsLine) {
    console.error("No params line found after the error.");
    return;
  }

  console.log("Found params line:");
  // Extract params after "params: "
  const rawParams = paramsLine.substring(paramsLine.indexOf("params: ") + 8);
  
  // The params are comma-separated, but some parameters are JSON objects with commas.
  // Let's parse them carefully.
  // The fields in order:
  // 1. userId (integer)
  // 2. triggerType (string)
  // 3. marketSymbol (string)
  // 4. observation (JSON)
  // 5. reasoning (string)
  // 6. proposedAction (JSON)
  // 7. governorJson (JSON)
  // 8. actualAction (JSON)
  // 9. signalSource (string)
  // 10. brainVerdict (string)
  // 11. governorVerdict (string)
  // 12. governorGate (string)
  // 13. executionResult (string)
  
  // Simple heuristic split or manual mock insertion of the payload
  console.log("Raw params string prefix:", rawParams.substring(0, 500));

  // Let's parse by finding matching braces or quotes
  // To be simple, we can run a query to check if we can insert standard values but with large sizes
  // Or let's see the length of various fields in brain_episodes
  // Wait, let's print the length of columns in brain_episodes:
  // governor_gate (varchar(50)? or varchar(255)? or character varying?)
  // signal_source (varchar(50)? or character varying?)
  // Let's test inserting a row with a long governor_gate!
  const db = getDb();
  try {
    const longGate = "A".repeat(500); // 500 chars
    console.log("Testing insert with long governorGate...");
    await db.insert(brainEpisodes).values({
      userId: 1,
      triggerType: "signal",
      marketSymbol: "ETHUSDT",
      observation: {},
      reasoning: "test",
      proposedAction: {},
      governorJson: {},
      actualAction: {},
      signalSource: "confluence",
      brainVerdict: "EXIT_NOW",
      governorVerdict: "rejected",
      governorGate: longGate,
      executionResult: "shadow",
    });
    console.log("Insert with 500-char governorGate succeeded!");
  } catch (err: any) {
    console.error("Insert with 500-char governorGate failed:", err);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
