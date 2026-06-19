import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fs from "fs";
import * as path from "path";
import { BrainOrchestrator } from "../brain/brain-orchestrator";
import { getDb } from "../queries/connection";
import { brainEpisodes, brainStrategies, brainReflections } from "@db/schema";
import { desc } from "drizzle-orm";
import { globalKillSwitch } from "../services/kill-switch";
import { proposeTradeAsSignal } from "../brain/signal-bridge";
import { env } from "../lib/env";
import { globalAutoExecutor } from "../services/auto-executor";
import { SUPPORTED_SYMBOLS } from "../../contracts/constants";

const VALID_SYMBOLS = new Set<string>(SUPPORTED_SYMBOLS);

function validateSymbol(input: string): string | null {
  const normalized = input.replace("B-", "").replace("_", "");
  if (VALID_SYMBOLS.has(normalized)) return normalized;
  return null;
}

export const brainRouter = new Hono();
const orchestrator = new BrainOrchestrator(); // mode read per-call from config

// POST /api/brain/decide?symbol=BTCUSDT
brainRouter.post("/decide", async (c) => {
  const rawSymbol = c.req.query("symbol") || "BTCUSDT";
  const symbol = validateSymbol(rawSymbol);
  if (!symbol) {
    return c.json({ error: `Unsupported symbol: ${rawSymbol}. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` }, 400);
  }
  // Default to User ID 1 for single-user system context
  const userId = 1;
  
  try {
    // Manual probe — evaluate a synthetic signal for the symbol.
    const direction = (c.req.query("direction") as "long" | "short") || "long";
    const result = await orchestrator.evaluate(
      { symbol, direction, compositeScore: "80", metadata: { source: "manual-decide" } },
      userId
    );
    return c.json(result);
  } catch (err: any) {
    console.error("[Brain Router] Decide failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/episodes
brainRouter.get("/episodes", async (c) => {
  const limitCount = parseInt(c.req.query("limit") || "50", 10);
  const db = getDb();
  
  try {
    const episodes = await db
      .select()
      .from(brainEpisodes)
      .orderBy(desc(brainEpisodes.timestamp))
      .limit(limitCount);
      
    return c.json(episodes);
  } catch (err: any) {
    console.error("[Brain Router] Fetch episodes failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/strategies
brainRouter.get("/strategies", async (c) => {
  const db = getDb();
  try {
    const strategies = await db.select().from(brainStrategies);
    return c.json(strategies);
  } catch (err: any) {
    console.error("[Brain Router] Fetch strategies failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/reflections
brainRouter.get("/reflections", async (c) => {
  const limitCount = parseInt(c.req.query("limit") || "20", 10);
  const db = getDb();
  try {
    const reflections = await db
      .select()
      .from(brainReflections)
      .orderBy(desc(brainReflections.appliedAt))
      .limit(limitCount);
      
    return c.json(reflections);
  } catch (err: any) {
    console.error("[Brain Router] Fetch reflections failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/brain/evolution/run
brainRouter.post("/evolution/run", async (c) => {
  return c.json({ success: true, message: "Evolution trigger stub (Shadow Mode)" });
});

// POST /api/brain/trigger-signal — Manual signal injection for testing
brainRouter.post("/trigger-signal", async (c) => {
  try {
    const body = await c.req.json();
    const rawSymbol = body.symbol || "B-BTC_USDT";
    const symbol = validateSymbol(rawSymbol);
    if (!symbol) {
      return c.json({ error: `Unsupported symbol: ${rawSymbol}. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` }, 400);
    }
    const direction = body.direction || "long";
    const compositeScore = String(body.compositeScore ?? 85);
    const threshold = String(body.threshold ?? 75);

    // Validate
    if (!['long', 'short'].includes(direction)) {
      return c.json({ error: "direction must be 'long' or 'short'" }, 400);
    }

    // Ensure kill switch is clear
    globalKillSwitch.reset();

    // Route through the shared bridge (same path the autonomous brain driver uses).
    const sizeUsdt = body.sizeUsdt ? parseFloat(String(body.sizeUsdt)) : undefined;
    if (sizeUsdt !== undefined && (!Number.isFinite(sizeUsdt) || sizeUsdt <= 0)) {
      return c.json({ error: "sizeUsdt must be a positive number" }, 400);
    }

    const { signalId, decision: firstDecision } = await proposeTradeAsSignal({
      symbol,
      direction,
      compositeScore: Number(compositeScore),
      threshold: Number(threshold),
      source: "manual-trigger",
      rsi: body.rsi ?? 50,
      sizeUsdt,
      leverage: body.leverage ? parseFloat(String(body.leverage)) : undefined,
      stopLossPct: body.stopLossPct ? parseFloat(String(body.stopLossPct)) / 100 : undefined,
      takeProfitPct: body.takeProfitPct ? parseFloat(String(body.takeProfitPct)) / 100 : undefined,
      disableTrailing: body.disableTrailing === true || body.disableTrailing === "true",
      extraMetadata: body.metadata || {},
    });

    if (!firstDecision) {
      const config = await globalAutoExecutor.getActiveConfig();
      let reason = "Executor did not process the signal";
      if (!env.autoExecute) reason = "AUTO_EXECUTE is disabled — set AUTO_EXECUTE=true in .env and restart";
      else if (!config?.enabled) reason = "Auto-trader is disabled — enable it in the Auto Trader panel";
      else if (!globalKillSwitch.canTrade()) reason = "Kill switch is active";
      return c.json({ error: reason, signalId }, 400);
    }

    if (firstDecision.action === "skip") {
      return c.json({
        error: firstDecision.reason,
      }, 400);
    }

    return c.json({
      success: true,
      signalId,
      symbol,
      direction,
      score: compositeScore,
      mode: env.tradingMode,
      message: firstDecision?.reason || `Signal injected and processed through 8-gate pipeline (${env.tradingMode} mode)`,
    });
  } catch (err: any) {
    console.error("[Brain Router] Trigger signal failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/mode — Returns current trading mode
brainRouter.get("/mode", async (c) => {
  return c.json({
    mode: env.tradingMode,
    placeOrders: env.placeOrders,
    paperTrading: env.paperTrading,
    autoExecute: env.autoExecute,
  });
});

// GET /api/brain/logs/stream
brainRouter.get("/logs/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    const logPath = path.resolve(process.cwd(), "logs/combined.log");
    if (!fs.existsSync(logPath)) {
      await stream.writeSSE({ data: "Log file not found." });
      return;
    }

    // Read last 20KB on initial load
    const stats = fs.statSync(logPath);
    const startBytes = Math.max(0, stats.size - 20 * 1024);
    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(stats.size - startBytes);
    fs.readSync(fd, buffer, 0, buffer.length, startBytes);
    fs.closeSync(fd);

    const initialLines = buffer.toString("utf-8").split("\n");
    // Filter and stream only lines containing relevant brain modules to keep it clean
    const allowedModules = ["[Brain", "[ws]", "[llm-advisor]", "[coindcx-ws]", "[position-lifecycle]", "[auto-executor]", "[reconciler]", "[liq-monitor]"];
    
    for (const line of initialLines) {
      if (line.trim() && allowedModules.some(m => line.includes(m))) {
        await stream.writeSSE({ data: line });
      }
    }

    // Watch for new content additions
    let currentSize = stats.size;
    const watcher = fs.watch(logPath, async (event) => {
      if (event === "change") {
        try {
          const newStats = fs.statSync(logPath);
          if (newStats.size > currentSize) {
            const addedLength = newStats.size - currentSize;
            const newFd = fs.openSync(logPath, "r");
            const newBuf = Buffer.alloc(addedLength);
            fs.readSync(newFd, newBuf, 0, addedLength, currentSize);
            fs.closeSync(newFd);
            currentSize = newStats.size;

            const lines = newBuf.toString("utf-8").split("\n");
            for (const line of lines) {
              if (line.trim() && allowedModules.some(m => line.includes(m))) {
                await stream.writeSSE({ data: line });
              }
            }
          } else {
            currentSize = newStats.size;
          }
        } catch {
          // ignore stat/read errors
        }
      }
    });

    stream.onAbort(() => {
      watcher.close();
    });

    // Heartbeat keepalive (every 15s)
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      try {
        await stream.writeSSE({ event: "heartbeat", data: "ping" });
      } catch {
        break; // socket closed
      }
    }
  });
});
