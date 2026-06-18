import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./oauth/auth";
import { Paths } from "@contracts/constants";
import fs from "fs";
import path from "path";
import { getDb } from "./queries/connection";
import { orders, autoExecutorConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import { RiskManager } from "./services/RiskManager";
import { lockPaperPositionMargin } from "./services/paper-currency";
import { MatchingEngine } from "./services/MatchingEngine";
import Decimal from "decimal.js";
import crypto from "crypto";
import { fileURLToPath } from "url";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// ─── Health endpoint ───────────────────────────────────────────────────────────
// Used by Docker HEALTHCHECK, load balancers, and uptime monitors.
const _bootTime = Date.now();
app.get("/health", async (c) => {
  let dbOk = false;
  try {
    const db = getDb();
    await db.execute("SELECT 1" as any);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const status = dbOk ? 200 : 503;
  return c.json(
    {
      status: dbOk ? "ok" : "degraded",
      uptime: Math.floor((Date.now() - _bootTime) / 1000),
      db: dbOk ? "ok" : "error",
      ts: new Date().toISOString(),
    },
    status
  );
});

// Dev-only mock OAuth — never active in production
if (!env.isProduction) {
  app.get("/api/oauth/authorize", (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state");
    if (!redirectUri || !state) {
      return c.text("Missing redirect_uri or state", 400);
    }
    return c.redirect(`${redirectUri}?code=mock-code-123&state=${state}`, 302);
  });
}
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

app.post("/api/v1/orders/simulated", async (c) => {
  try {
    const body = await c.req.json();
    const mockUserId = 1; // Pulled from contextual auth token verification layers in real app, hardcoded here

    const db = getDb();
    const [config] = await db
      .select()
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, mockUserId))
      .limit(1);

    const currency = config?.paperCurrency ?? "INR";

    const orderParams = {
      symbol: body.symbol,
      side: body.side,
      orderType: body.orderType,
      quantity: body.quantity,
      price: body.price,
      leverage: body.leverage,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    };

    // 1. Structural evaluation via RiskManager
    await RiskManager.validateOrder(mockUserId, orderParams, true, currency);

    const clientOrderId = crypto.randomUUID();

    // 2. Insert order record into the database
    const orderId = await db.transaction(async (tx) => {
      const result = await tx
        .insert(orders)
        .values({
          clientOrderId,
          userId: mockUserId,
          symbol: body.symbol,
          side: body.side,
          orderType: body.orderType,
          price: body.price,
          quantity: body.quantity,
          status: "OPEN",
          leverage: body.leverage,
          stopLoss: body.stopLoss ? String(body.stopLoss) : null,
          takeProfit: body.takeProfit ? String(body.takeProfit) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: orders.id });
      return result[0].id;
    });

    // 3. Pessimistically lock margin using WalletLedgerService
    const qty = new Decimal(body.quantity);
    const price = new Decimal(body.price);
    const leverage = new Decimal(body.leverage);
    const marginAllocation = qty.mul(price).div(leverage).toFixed(8);

    await lockPaperPositionMargin(
      mockUserId,
      parseFloat(marginAllocation),
      orderId,
      currency,
      "order"
    );

    // 4. Register trigger or matching job
    if (body.orderType.toUpperCase() === "LIMIT") {
      await MatchingEngine.registerOrderTrigger(
        body.symbol,
        body.side,
        body.price,
        clientOrderId
      );
    } else {
      const { Queue } = await import("bullmq");
      const { default: Redis } = await import("ioredis");
      const executionQueue = new Queue("EngineExecution", {
        connection: new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379") as any,
      });

      await executionQueue.add("ExecuteMatch", {
        clientOrderId,
        executionPrice: body.price,
        timestamp: Date.now(),
      });
    }

    return c.json({ success: true, clientOrderId, status: "OPEN" }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

import { brainRouter } from "./routers/brain-router";
app.route("/api/brain", brainRouter);

// tRPC handler - allow method override for batch POST requests
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    allowMethodOverride: true,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Static files + SPA fallback
const dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(dirname, "../dist/public");

app.get("*", async (c, next) => {
  const url = new URL(c.req.url);
  const filePath = path.join(distPath, url.pathname);

  // Try to serve the file if it exists
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };
    const content = fs.readFileSync(filePath);
    return c.body(content, 200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
  }

  // Fall back to index.html for SPA routes
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  }

  await next();
});

export default app;

// Setup WS Server context creator
import { authenticateRequest } from "./oauth/auth";
const createContextWSS = async (opts: any) => {
  const ctx: any = {
    req: opts.req,
    resHeaders: new Headers(),
  };
  try {
    const headers = new Headers();
    if (opts.req.headers) {
      for (const [key, value] of Object.entries(opts.req.headers)) {
        if (value) {
          if (Array.isArray(value)) {
            value.forEach((v) => headers.append(key, v));
          } else {
            headers.set(key, value as string);
          }
        }
      }
    }
    ctx.user = await authenticateRequest(headers);
  } catch (err: any) {
    console.error("[ws] Authentication failed in createContextWSS:", err?.message || err);
  }
  return ctx;
};

// Setup WS Server in Development
if (!env.isProduction) {
  const globalWss = globalThis as any;
  if (!globalWss.wss) {
    globalWss.wss = new WebSocketServer({ port: 3011 });
    applyWSSHandler({ wss: globalWss.wss, router: appRouter, createContext: createContextWSS });
    console.log(`[ws] Dev WebSocket Server running on ws://localhost:3011`);
  }
}

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || "3010");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  const wss = new WebSocketServer({ server: server as any });
  applyWSSHandler({ wss, router: appRouter, createContext: createContextWSS });
  console.log(`[ws] Production WebSocket Server attached to HTTP port ${port}`);
}

// Restore persisted state from DB before starting any trading services.
// (Risk sessions are read on-demand from DB by riskSessionStore — no preload needed.)
import { globalKillSwitch } from "./services/kill-switch";
globalKillSwitch.initFromDb().catch((err) => console.error("[kill-switch] Failed to restore state from DB:", err));

// Start CoinDCX Private WebSocket client
import { initCoinDCXPrivateWs } from "./services/coindcx-ws";
initCoinDCXPrivateWs().catch((err) => {
  console.error("[coindcx-ws] Failed to initialize private WS:", err);
});

// Continuous position reconciliation: runs immediately on boot, then every 5 min.
// Marks stale DB positions closed, corrects size mismatches, and alerts on orphans.
import { positionReconciler } from "./services/position-reconciler";
positionReconciler.start();

// Start position exit manager background daemon (SL/TP monitoring)
import { startDaemon as startExitDaemon } from "./services/exit-manager";
startExitDaemon();

// Start market regime recorder (persists regime snapshots every 5 min)
import { startMarketRegimeRecorder } from "./services/market-regime-recorder";
startMarketRegimeRecorder();

// Start auto signal analysis loop with regime detection enabled
import { startAutoAnalysis } from "./routers/signal-router";
startAutoAnalysis("intraday", true).catch((err) => {
  console.error("[signal-engine] Failed to start auto analysis:", err);
});

// Start adaptive R-profile refresh — empirically derives realistic TP R-multiples
// per symbol/horizon from each symbol's own historical price action (every 6h)
import { startRProfileRefresh } from "./services/r-profile-engine";
startRProfileRefresh();

// Init LLM advisor (loads keys from DB + env-level Ollama config)
import { globalLlmAdvisor } from "./services/llm-advisor";
globalLlmAdvisor.init().catch((err) => {
  console.error("[llm-advisor] Init failed:", err);
});

console.log(`[auto-executor] AUTO_EXECUTE=${env.autoExecute} | PLACE_ORDERS=${env.placeOrders}`);

// Start simulated exchange execution worker
import { executionWorker } from "./workers/executionWorker";

// Start AI position lifecycle manager (after LLM advisor is initialized)
import { positionLifecycleManager } from "./services/position-manager/index";
setTimeout(() => positionLifecycleManager.start().catch(console.error), 5_000);

// Start backend alert engine (headless alert evaluation for user rules + system events)
import { alertEngine } from "./services/alert-engine";
alertEngine.start(5_000);

// Start Telegram command bot (polling-based — receives /status, /pause, /resume, etc.)
import { startTelegramCommandBot } from "./services/telegram-bot";
startTelegramCommandBot();

// Start Position Manager → Telegram notifier (auto-alerts on open, close, partial exit, etc.)
import { startPositionTelegramNotifier } from "./services/position-telegram-notifier";
startPositionTelegramNotifier();

// Start AI Brain scheduler (periodic strategy evolution). The Brain evaluates signals
// inline inside the auto-executor (Signal → Governor → Brain → Executor).
import { startBrainScheduler } from "./brain/brain-scheduler";
startBrainScheduler();

// Start liquidation proximity monitor (alerts + auto-reduce when within 5%/2% of liq price)
import { startLiquidationMonitor, stopLiquidationMonitor } from "./services/liquidation-monitor";
startLiquidationMonitor(10_000);

// Start key rotation monitor (daily Telegram reminder when exchange API credentials are stale)
import { keyRotationMonitor } from "./services/key-rotation-monitor";
keyRotationMonitor.start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Called on SIGTERM, SIGINT, uncaughtException, and unhandledRejection.
// Stops all background services before exit so PM2/Docker can restart cleanly.
import { stopTelegramCommandBot } from "./services/telegram-bot";
import { stopPositionTelegramNotifier } from "./services/position-telegram-notifier";
// globalKillSwitch already imported above for DB state init

let _shutdownInProgress = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (_shutdownInProgress) return;
  _shutdownInProgress = true;

  console.log(`[boot] ${signal} received — shutting down gracefully`);

  // 1. Halt new orders immediately
  globalKillSwitch.trigger("manual", `shutdown_${signal}`);

  // 2. Stop all background services
  alertEngine.stop();
  positionReconciler.stop();
  stopTelegramCommandBot();
  stopPositionTelegramNotifier();
  stopLiquidationMonitor();
  keyRotationMonitor.stop();
  positionLifecycleManager.stop?.();
  await executionWorker.close().catch((err) => console.error("[boot] Failed to close executionWorker:", err));

  // 3. Brief pause for in-flight DB writes to complete
  await new Promise((r) => setTimeout(r, 500));

  process.exit(exitCode);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT",  () => shutdown("SIGINT"));

// Crash handlers — log the error and exit so PM2/Docker restarts the process
process.on("uncaughtException", (err: Error) => {
  console.error("[boot] uncaughtException:", err);
  shutdown("uncaughtException", 1).catch(() => process.exit(1));
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[boot] unhandledRejection:", reason);
  shutdown("unhandledRejection", 1).catch(() => process.exit(1));
});
