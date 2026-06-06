import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fs from "fs";
import * as path from "path";
import { BrainOrchestrator } from "../brain/brain-orchestrator";
import { getDb } from "../queries/connection";
import { brainEpisodes, brainStrategies, brainReflections, signals } from "@db/schema";
import { desc } from "drizzle-orm";
import { globalAutoExecutor } from "../services/auto-executor";
import { globalKillSwitch } from "../services/kill-switch";
import { latestTickerCache } from "../services/streaming";
import { env } from "../lib/env";

export const brainRouter = new Hono();
const orchestrator = new BrainOrchestrator(true); // Shadow Mode active

// POST /api/brain/decide?symbol=BTCUSDT
brainRouter.post("/decide", async (c) => {
  const symbol = c.req.query("symbol") || "BTCUSDT";
  // Default to User ID 1 for single-user system context
  const userId = 1;
  
  try {
    const result = await orchestrator.decide(symbol, userId);
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
    const symbol = body.symbol || "B-BTC_USDT";
    const direction = body.direction || "long";
    const compositeScore = String(body.compositeScore ?? 85);
    const threshold = String(body.threshold ?? 75);

    // Validate
    if (!['long', 'short'].includes(direction)) {
      return c.json({ error: "direction must be 'long' or 'short'" }, 400);
    }

    // Ensure kill switch is clear
    globalKillSwitch.reset();

    // Fetch live price for metadata
    const binanceSym = symbol.replace("B-", "").replace("_", "");
    const currentPrice = latestTickerCache.get(binanceSym)?.lastPrice ?? 0;

    const db = getDb();
    const [insertedSignal] = await db.insert(signals).values({
      symbol,
      microScore: compositeScore,
      intraScore: compositeScore,
      swingScore: compositeScore,
      compositeScore,
      threshold,
      isGated: true,
      direction,
      metadata: {
        rsi: body.rsi ?? 50,
        ema20: currentPrice * 0.998,
        ema50: currentPrice * 0.995,
        spread: 0.0002,
        imbalance: 0.3,
        source: "manual-trigger",
        sizeUsdt: body.sizeUsdt ? parseFloat(String(body.sizeUsdt)) : undefined,
        ...(body.metadata || {}),
      },
    }).returning();

    // Fire through the full 8-gate pipeline
    await globalAutoExecutor.onSignalBatch([insertedSignal]);

    const isPaper = env.paperTrading || !env.placeOrders;
    return c.json({
      success: true,
      signalId: insertedSignal.id,
      symbol,
      direction,
      score: compositeScore,
      mode: isPaper ? "paper" : "live",
      message: `Signal injected and processed through 8-gate pipeline (${isPaper ? 'PAPER' : 'LIVE'} mode)`,
    });
  } catch (err: any) {
    console.error("[Brain Router] Trigger signal failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/mode — Returns current trading mode
brainRouter.get("/mode", async (c) => {
  const isPaper = env.paperTrading || !env.placeOrders;
  return c.json({
    mode: isPaper ? "paper" : "live",
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
    let startBytes = Math.max(0, stats.size - 20 * 1024);
    let fd = fs.openSync(logPath, "r");
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
        } catch (watchErr) {
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
