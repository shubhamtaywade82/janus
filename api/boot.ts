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
const distPath = path.resolve(import.meta.dirname, "../dist/public");

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
startAutoAnalysis("intraday", true); // true = regime auto-switch on

// Init LLM advisor (loads keys from DB + env-level Ollama config)
import { globalLlmAdvisor } from "./services/llm-advisor";
globalLlmAdvisor.init().catch((err) => {
  console.error("[llm-advisor] Init failed:", err);
});

console.log(`[auto-executor] AUTO_EXECUTE=${env.autoExecute} | PLACE_ORDERS=${env.placeOrders}`);

// Start AI position lifecycle manager (after LLM advisor is initialized)
import { positionLifecycleManager } from "./services/position-manager/index";
setTimeout(() => positionLifecycleManager.start().catch(console.error), 5_000);

// Start backend alert engine (headless alert evaluation for user rules + system events)
import { alertEngine } from "./services/alert-engine";
alertEngine.start(5_000);

// Start Telegram command bot (polling-based — receives /status, /pause, /resume, etc.)
import { startTelegramCommandBot } from "./services/telegram-bot";
startTelegramCommandBot();

// Start AI Brain scheduler (periodic strategy evolution). The Brain evaluates signals
// inline inside the auto-executor (Signal → Governor → Brain → Executor).
import { startBrainScheduler } from "./brain/brain-scheduler";
startBrainScheduler();

// Start liquidation proximity monitor (alerts + auto-reduce when within 5%/2% of liq price)
import { startLiquidationMonitor, stopLiquidationMonitor } from "./services/liquidation-monitor";
startLiquidationMonitor(10_000);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Called on SIGTERM, SIGINT, uncaughtException, and unhandledRejection.
// Stops all background services before exit so PM2/Docker can restart cleanly.
import { stopTelegramCommandBot } from "./services/telegram-bot";
import { globalKillSwitch } from "./services/kill-switch";

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
  stopLiquidationMonitor();
  positionLifecycleManager.stop?.();

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
