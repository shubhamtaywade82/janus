import { getDb } from "../api/queries/connection";
import { brainEpisodes } from "../db/schema";

async function main() {
  const db = getDb();
  try {
    const [result] = await db.insert(brainEpisodes).values({
      userId: 1,
      triggerType: "signal",
      marketSymbol: "ETHUSDT",
      observation: { test: true },
      reasoning: "test reasoning",
      proposedAction: { mode: "hold" },
      governorJson: { shadowMode: true },
      actualAction: { status: "shadow_logged" },
      signalSource: "confluence",
      brainVerdict: "EXIT_NOW",
      governorVerdict: "rejected",
      governorGate: "some gate",
      executionResult: "shadow",
    }).returning({ id: brainEpisodes.id });
    console.log("Success! ID:", result.id);
  } catch (err: any) {
    console.error("Drizzle INSERT failed:", err);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
