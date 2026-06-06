import { evolveStrategies } from "./brain-evolution";
import { BrainOrchestrator, updateEpisodeOutcome } from "./brain-orchestrator";
import { proposeTradeAsSignal } from "./signal-bridge";
import { globalAutoExecutor } from "../services/auto-executor";
import { globalKillSwitch } from "../services/kill-switch";
import { getPaperEquity } from "../services/paper-wallet";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "../lib/env";

let schedulerIntervalId: NodeJS.Timeout | null = null;
let lastExecutedDay = -1;

export function startBrainScheduler() {
  if (schedulerIntervalId) return;

  console.log("[Brain Scheduler] Initializing background tasks...");

  // Check every 15 minutes
  const intervalMs = 15 * 60 * 1000;

  schedulerIntervalId = setInterval(async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();

    // Trigger daily at 2:00 AM
    if (currentHour === 2 && currentDay !== lastExecutedDay) {
      lastExecutedDay = currentDay;
      console.log(`[Brain Scheduler] Daily trigger hit at ${now.toISOString()}. Starting evolution...`);
      try {
        await evolveStrategies();
      } catch (err: any) {
        console.error("[Brain Scheduler] Evolution error:", err.message);
      }
    }
  }, intervalMs);
}

export function stopBrainScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    console.log("[Brain Scheduler] Background tasks stopped.");
  }
}

// ─── Autonomous Brain Driver ─────────────────────────────────────────────────
// Periodically asks the Brain to propose trades and routes approved proposals
// through the auto-executor's full gate pipeline (brain "drives AND is gated").
// Paper-only for now; live driving is a deliberate follow-up.

let driverIntervalId: NodeJS.Timeout | null = null;
let driverInFlight = false;
const DRIVER_INTERVAL_MS = parseInt(process.env.BRAIN_DRIVER_INTERVAL_MS ?? "75000", 10);
const orchestrator = new BrainOrchestrator();

function cdxToBinance(cdx: string): string {
  return cdx.replace("B-", "").replace("_", "");
}
function binanceToCdx(b: string): string {
  return `B-${b.replace("USDT", "_USDT")}`;
}

async function runBrainDriverTick(): Promise<void> {
  if (driverInFlight) return; // never stack ticks
  if (!env.autoExecute) return;

  const config = await globalAutoExecutor.getActiveConfig();
  if (!config?.enabled || !config.brainDriverEnabled) return;
  if (!globalKillSwitch.canTrade()) return;

  // Paper-only guard — driver never opens live positions in this phase.
  const isPaper = !env.placeOrders || env.paperTrading;
  if (!isPaper) return;

  driverInFlight = true;
  try {
    const db = getDb();
    const equity = await getPaperEquity(1).catch(() => 10_000);
    const symbols = (config.targetSymbols as string[]) ?? [];

    for (const binanceSym of symbols) {
      try {
        const cdxSym = binanceToCdx(binanceSym);

        // Cheap pre-skip: don't ask the LLM if a paper position is already open.
        const open = await db
          .select({ id: positions.id })
          .from(positions)
          .where(and(eq(positions.userId, 1), eq(positions.symbol, binanceSym), eq(positions.status, "open"), eq(positions.isPaper, true)))
          .limit(1);
        if (open.length > 0) continue;

        const result = await orchestrator.decide(binanceSym, 1, { source: "brain-driver" }, { shadowMode: config.brainShadowMode });
        const decision = result?.decision;
        if (!result?.approved || decision?.mode !== "enter" || !decision?.side) continue;

        // Size from the governor-adjusted sizePct (already capped at 5%).
        const sizePct = decision.sizePct ?? 1.0;
        const sizeUsdt = Math.max(1, (equity * sizePct) / 100);

        const bridge = await proposeTradeAsSignal({
          symbol: cdxSym,
          direction: decision.side,
          source: "brain-driver",
          sizeUsdt,
          stopLossPct: decision.stopLossPct ? decision.stopLossPct / 100 : undefined,
          takeProfitPct: decision.takeProfitPct ? decision.takeProfitPct / 100 : undefined,
          entryReason: decision.rationale,
          episodeId: result.episodeId,
        });

        const exec = bridge.decision;
        await updateEpisodeOutcome(
          result.episodeId,
          exec?.action === "execute"
            ? { status: "executed", positionSignalId: bridge.signalId, reason: exec.reason }
            : { status: "vetoed_by_gate", gate: exec?.gate, reason: exec?.reason ?? "no decision" }
        );
        console.log(`[Brain Driver] ${binanceSym} → ${decision.side} ${sizeUsdt.toFixed(2)} USDT → ${exec?.action ?? "none"} (${exec?.gate ?? "-"})`);
      } catch (symErr: any) {
        console.error(`[Brain Driver] ${binanceSym} error:`, symErr.message);
      }
    }
  } finally {
    driverInFlight = false;
  }
}

export function startBrainDriver() {
  if (driverIntervalId) return;
  const isPaper = !env.placeOrders || env.paperTrading;
  console.log(`[Brain Driver] Started — interval ${DRIVER_INTERVAL_MS}ms, mode=${isPaper ? "PAPER" : "LIVE(blocked)"}`);
  driverIntervalId = setInterval(() => {
    runBrainDriverTick().catch((err) => console.error("[Brain Driver] tick error:", err));
  }, DRIVER_INTERVAL_MS);
}

export function stopBrainDriver() {
  if (driverIntervalId) {
    clearInterval(driverIntervalId);
    driverIntervalId = null;
    console.log("[Brain Driver] Stopped.");
  }
}
