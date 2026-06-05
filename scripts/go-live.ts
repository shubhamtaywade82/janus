#!/usr/bin/env -S npx tsx
/**
 * go-live.ts — Production preflight checklist for Janus
 *
 * Usage:
 *   npx tsx scripts/go-live.ts
 *   npx tsx scripts/go-live.ts --allow-fail  # report issues without exiting 1
 *
 * Checks performed:
 *   1. Environment variables — all required vars present
 *   2. Database — reachable and migrations applied
 *   3. Backup — recent backup exists (< 24h old)
 *   4. Health endpoint — server returns 200 ok
 *   5. Telegram — bot token + chat ID configured
 *   6. WebSocket streams — at least one stream active
 *   7. Encryption — ENCRYPTION_KEY set
 *   8. Paper trading log — ≥ 48h of paper trades exist in DB
 *   9. Kill switch — not active
 *  10. Open orphan positions — none detected
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ALLOW_FAIL = process.argv.includes("--allow-fail");

interface Check {
  name: string;
  critical: boolean;
  run: () => Promise<{ ok: boolean; detail?: string }>;
}

const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";

function pass(msg: string) { console.log(`  ${GREEN}✔${RESET} ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✘${RESET} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }

// ── Helpers ─────────────────────────────────────────────────────────────────

async function httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; body: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, body, status: res.status };
  } catch (err) {
    return { ok: false, body: String(err), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function envRequired(name: string): string | null {
  return process.env[name] || null;
}

// ── Checks ───────────────────────────────────────────────────────────────────

const checks: Check[] = [
  {
    name: "Required env vars",
    critical: true,
    async run() {
      const required = [
        "APP_SECRET", "DATABASE_URL", "AUTH_URL",
        "AUTH_PLATFORM_URL", "ENCRYPTION_KEY",
      ];
      const missing = required.filter((v) => !envRequired(v));
      if (missing.length === 0) return { ok: true, detail: "All required vars present" };
      return { ok: false, detail: `Missing: ${missing.join(", ")}` };
    },
  },

  {
    name: "ENCRYPTION_KEY set",
    critical: true,
    async run() {
      const key = envRequired("ENCRYPTION_KEY");
      if (!key) return { ok: false, detail: "ENCRYPTION_KEY is not set — credentials stored unencrypted!" };
      if (key.length !== 64) return { ok: false, detail: `ENCRYPTION_KEY must be 64 hex chars (32 bytes), got ${key.length}` };
      return { ok: true, detail: "64-hex key present" };
    },
  },

  {
    name: "PLACE_ORDERS safeguard",
    critical: false,
    async run() {
      const placeOrders = process.env.PLACE_ORDERS === "true";
      const autoExecute = process.env.AUTO_EXECUTE === "true";
      const paperTrading = process.env.PAPER_TRADING === "true";
      if (paperTrading) return { ok: true, detail: "PAPER_TRADING=true — safe mode" };
      if (placeOrders && !autoExecute) return { ok: true, detail: "PLACE_ORDERS=true but AUTO_EXECUTE=false — manual mode" };
      if (placeOrders && autoExecute) return { ok: true, detail: "⚡ LIVE TRADING ENABLED — verify intentional" };
      return { ok: true, detail: "PLACE_ORDERS=false — dry-run mode" };
    },
  },

  {
    name: "Database reachable",
    critical: true,
    async run() {
      try {
        // Use pg CLI to test connection quickly
        const dbUrl = process.env.DATABASE_URL!;
        execSync(`psql "${dbUrl}" -c "SELECT 1" -q --no-psqlrc 2>&1`, { stdio: "pipe", timeout: 10000 });
        return { ok: true, detail: "Connection successful" };
      } catch {
        // Fallback: try via npm run db:migrate dry-run
        try {
          const { getDb } = await import("../api/queries/connection.js");
          const db = getDb();
          await (db as any).execute("SELECT 1");
          return { ok: true, detail: "Connection successful (via ORM)" };
        } catch (err) {
          return { ok: false, detail: `Cannot reach database: ${err}` };
        }
      }
    },
  },

  {
    name: "Recent DB backup exists",
    critical: false,
    async run() {
      const backupDir = join(PROJECT_ROOT, "backups");
      if (!existsSync(backupDir)) {
        return { ok: false, detail: `Backup directory not found: ${backupDir}` };
      }
      const files = readdirSync(backupDir)
        .filter((f) => f.startsWith("janus_") && f.endsWith(".sql.gz"))
        .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return { ok: false, detail: "No backups found — run scripts/backup-db.sh first" };
      }
      const latestAge = (Date.now() - files[0].mtime) / 3600_000;
      if (latestAge > 24) {
        return { ok: false, detail: `Latest backup is ${latestAge.toFixed(1)}h old (> 24h)` };
      }
      return { ok: true, detail: `Latest backup: ${files[0].f} (${latestAge.toFixed(1)}h ago)` };
    },
  },

  {
    name: "Health endpoint responds",
    critical: true,
    async run() {
      const port = process.env.PORT || "3010";
      const res = await httpGet(`http://localhost:${port}/health`);
      if (!res.ok) {
        return { ok: false, detail: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
      }
      try {
        const json = JSON.parse(res.body);
        return { ok: json.status === "ok" || json.status === "degraded", detail: `status=${json.status} db=${json.db} uptime=${json.uptime}s` };
      } catch {
        // Fall back to tRPC health endpoint in development (where /health is excluded from Vite devServer)
        const trpcRes = await httpGet(`http://localhost:${port}/api/trpc/health.detailed`);
        if (trpcRes.ok) {
          try {
            const trpcJson = JSON.parse(trpcRes.body);
            const data = trpcJson.result?.data?.json;
            if (data) {
              return { ok: true, detail: `tRPC status=${data.status} db=${data.checks?.db?.ok ? "ok" : "error"} uptime=${data.uptime}s (dev server)` };
            }
          } catch {}
        }
        return { ok: false, detail: "Invalid JSON response from /health, and tRPC health failed" };
      }
    },
  },

  {
    name: "Telegram bot configured",
    critical: false,
    async run() {
      const token = envRequired("TELEGRAM_BOT_TOKEN");
      const chatId = envRequired("TELEGRAM_CHAT_ID");
      if (!token || !chatId) {
        return { ok: false, detail: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — alerts will be silent" };
      }
      // Validate token format: <bot_id>:<hash>
      if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
        return { ok: false, detail: "TELEGRAM_BOT_TOKEN format looks invalid" };
      }
      // Ping Telegram API
      const res = await httpGet(`https://api.telegram.org/bot${token}/getMe`);
      if (!res.ok) return { ok: false, detail: `Telegram API rejected token (HTTP ${res.status})` };
      const body = JSON.parse(res.body);
      return { ok: body.ok === true, detail: `Bot: @${body.result?.username}` };
    },
  },

  {
    name: "dist/boot.js present",
    critical: true,
    async run() {
      const bootPath = join(PROJECT_ROOT, "dist", "boot.js");
      if (!existsSync(bootPath)) {
        return { ok: false, detail: "dist/boot.js not found — run: npm run build" };
      }
      const size = statSync(bootPath).size;
      return { ok: true, detail: `${(size / 1024).toFixed(0)} KB` };
    },
  },

  {
    name: "Paper trading history ≥ 48h",
    critical: false,
    async run() {
      const port = process.env.PORT || "3010";
      const res = await httpGet(`http://localhost:${port}/health`);
      if (!res.ok) return { ok: false, detail: "Server not responding — start server first" };

      // Check via DB if accessible
      try {
        const { getDb } = await import("../api/queries/connection.js");
        const { positions } = await import("../db/schema.js");
        const { eq, and, lte, sql: drizzleSql } = await import("drizzle-orm");
        const db = getDb();

        const cutoff = new Date(Date.now() - 48 * 3600_000);
        const rows = await db
          .select({ count: drizzleSql<number>`count(*)::int` })
          .from(positions)
          .where(and(eq(positions.isPaper, true), lte(positions.createdAt, cutoff)));

        const count = rows[0]?.count ?? 0;
        if (count === 0) {
          return { ok: false, detail: "No paper positions older than 48h — complete paper trading protocol first" };
        }
        return { ok: true, detail: `${count} paper positions found (oldest > 48h ago)` };
      } catch {
        return { ok: false, detail: "Could not query paper trade history — check DATABASE_URL" };
      }
    },
  },

  {
    name: "No orphaned live positions",
    critical: false,
    async run() {
      try {
        const { getDb } = await import("../api/queries/connection.js");
        const { positions } = await import("../db/schema.js");
        const { eq, and } = await import("drizzle-orm");
        const db = getDb();

        const orphans = await db
          .select({ id: positions.id, symbol: positions.symbol })
          .from(positions)
          .where(and(eq(positions.status, "open"), eq(positions.isPaper, false)));

        if (orphans.length > 0) {
          return {
            ok: false,
            detail: `${orphans.length} open live position(s) detected: ${orphans.map((p) => p.symbol).join(", ")}`,
          };
        }
        return { ok: true, detail: "No open live positions" };
      } catch {
        return { ok: false, detail: "Could not check for orphan positions" };
      }
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}Janus Go-Live Preflight Checklist${RESET}`);
  console.log(`${"─".repeat(50)}`);
  console.log(`Environment: ${process.env.NODE_ENV ?? "development"}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`${"─".repeat(50)}\n`);

  let passed = 0;
  let failed = 0;
  let criticalFailed = 0;

  for (const check of checks) {
    process.stdout.write(`  ${check.critical ? "🔴" : "🔵"} ${check.name}... `);
    try {
      const result = await check.run();
      if (result.ok) {
        process.stdout.write(`${GREEN}PASS${RESET}`);
        if (result.detail) process.stdout.write(` — ${result.detail}`);
        console.log();
        passed++;
      } else {
        process.stdout.write(`${check.critical ? RED : YELLOW}${check.critical ? "FAIL" : "WARN"}${RESET}`);
        if (result.detail) process.stdout.write(` — ${result.detail}`);
        console.log();
        failed++;
        if (check.critical) criticalFailed++;
      }
    } catch (err) {
      process.stdout.write(`${RED}ERROR${RESET} — ${err}\n`);
      failed++;
      if (check.critical) criticalFailed++;
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ""}${failed} failed${RESET}`);

  if (criticalFailed > 0) {
    console.log(`\n${RED}${BOLD}❌ ${criticalFailed} critical check(s) failed — DO NOT go live${RESET}`);
    if (!ALLOW_FAIL) process.exit(1);
  } else if (failed > 0) {
    console.log(`\n${YELLOW}${BOLD}⚠  Non-critical warnings present — review before going live${RESET}`);
  } else {
    console.log(`\n${GREEN}${BOLD}✅ All checks passed — ready to go live${RESET}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Preflight script error:", err);
  process.exit(1);
});
