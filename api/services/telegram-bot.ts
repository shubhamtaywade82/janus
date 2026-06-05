/**
 * Telegram Command Bot
 * Polling-based command handler that lets operators control the trading bot via Telegram.
 * Security: only responds to the configured chatId (userId=1 from DB).
 *
 * Commands:
 *   /status   — open positions, unrealized PnL, today's PnL, bot uptime, kill switch
 *   /pause    — trigger global kill switch ("manual_telegram_pause")
 *   /resume   — reset kill switch
 *   /closeall — emit "closeAll" event on telegramBotEvents
 *   /pos <SYM>— single position detail
 *   /pnl      — daily/weekly realized PnL summary
 *   /stop     — alias for /pause
 *   /help     — list commands
 */

import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { users, positions } from "@db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { globalKillSwitch } from "./kill-switch";
import { sendTelegramMessage } from "./telegram";
import { env } from "../lib/env";

// ─── Public exports ────────────────────────────────────────────────────────────

/** Emits `closeAll` when a /closeall command is received. */
export const telegramBotEvents = new EventEmitter();
telegramBotEvents.setMaxListeners(10);

// ─── Internal state ───────────────────────────────────────────────────────────

const _bootTime = Date.now();
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastUpdateId = 0;

// ─── Credentials helper ───────────────────────────────────────────────────────

interface BotCredentials {
  botToken: string;
  chatId: string;
}

async function getBotCredentials(): Promise<BotCredentials | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        telegramBotToken: users.telegramBotToken,
        telegramChatId: users.telegramChatId,
      })
      .from(users)
      .where(eq(users.id, 1))
      .limit(1);

    const row = rows[0];
    if (!row?.telegramBotToken || !row?.telegramChatId) return null;
    return { botToken: row.telegramBotToken, chatId: row.telegramChatId };
  } catch (err) {
    console.error("[telegram-bot] Failed to fetch credentials:", err);
    return null;
  }
}

// ─── Reply helper ─────────────────────────────────────────────────────────────

async function reply(creds: BotCredentials, chatId: string, text: string): Promise<void> {
  await sendTelegramMessage({
    botToken: creds.botToken,
    chatId,
    text,
    parseMode: "HTML",
  });
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleStatus(chatId: string, creds: BotCredentials): Promise<void> {
  try {
    const db = getDb();

    // Open positions
    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open")));

    // Today's UTC midnight
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    // Today's realized PnL (closed positions only)
    const todayRows = await db
      .select({ realizedPnl: positions.realizedPnl })
      .from(positions)
      .where(
        and(
          eq(positions.userId, 1),
          eq(positions.status, "closed"),
          gte(positions.closedAt, todayMidnight)
        )
      );

    const todayPnl = todayRows.reduce((sum, r) => sum + parseFloat(r.realizedPnl ?? "0"), 0);
    const unrealizedPnl = openPositions.reduce(
      (sum, p) => sum + parseFloat(p.unrealizedPnl ?? "0"),
      0
    );

    const uptimeSec = Math.floor((Date.now() - _bootTime) / 1000);
    const uptimeStr =
      uptimeSec < 60
        ? `${uptimeSec}s`
        : uptimeSec < 3600
        ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
        : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

    const killState = globalKillSwitch.isActive
      ? `🔴 ACTIVE — ${globalKillSwitch.state?.reason}`
      : "🟢 clear";

    const posLines =
      openPositions.length === 0
        ? "  (none)"
        : openPositions
            .map(
              (p) =>
                `  • <b>${p.symbol}</b> ${p.side.toUpperCase()} ×${p.leverage} @ ${p.entryPrice} | uPnL: ${parseFloat(p.unrealizedPnl ?? "0").toFixed(2)} USDT`
            )
            .join("\n");

    const text =
      `<b>Janus Status</b>\n\n` +
      `<b>Kill Switch:</b> ${killState}\n` +
      `<b>Uptime:</b> ${uptimeStr}\n` +
      `<b>Open positions (${openPositions.length}):</b>\n${posLines}\n\n` +
      `<b>Unrealized PnL:</b> ${unrealizedPnl.toFixed(2)} USDT\n` +
      `<b>Today's realized PnL:</b> ${todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)} USDT`;

    await reply(creds, chatId, text);
  } catch (err) {
    await reply(creds, chatId, `❌ Error fetching status: ${(err as Error).message}`);
  }
}

async function handlePause(chatId: string, creds: BotCredentials): Promise<void> {
  if (globalKillSwitch.isActive) {
    await reply(creds, chatId, "ℹ️ Kill switch is already active.");
    return;
  }
  globalKillSwitch.trigger("manual", "manual_telegram_pause");
  await reply(creds, chatId, "🔴 <b>Kill switch triggered.</b> No new positions will be opened.");
}

async function handleResume(chatId: string, creds: BotCredentials): Promise<void> {
  if (!globalKillSwitch.isActive) {
    await reply(creds, chatId, "ℹ️ Kill switch is not active.");
    return;
  }
  globalKillSwitch.reset();
  await reply(creds, chatId, "🟢 <b>Kill switch reset.</b> Auto-executor is active.");
}

async function handleCloseAll(chatId: string, creds: BotCredentials): Promise<void> {
  telegramBotEvents.emit("closeAll");
  await reply(
    creds,
    chatId,
    "⚠️ <b>Close-all signal emitted.</b> All open positions will be closed."
  );
}

async function handlePos(symbol: string, chatId: string, creds: BotCredentials): Promise<void> {
  if (!symbol) {
    await reply(creds, chatId, "Usage: <code>/pos BTCUSDT</code>");
    return;
  }
  try {
    const db = getDb();
    const sym = symbol.toUpperCase();
    const rows = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.symbol, sym), eq(positions.status, "open")))
      .limit(1);

    if (rows.length === 0) {
      await reply(creds, chatId, `No open position for <b>${sym}</b>.`);
      return;
    }

    const p = rows[0];
    const upnl = parseFloat(p.unrealizedPnl ?? "0");
    const margin = parseFloat(p.margin ?? "0");
    const roe = margin > 0 ? ((upnl / margin) * 100).toFixed(2) : "n/a";

    const text =
      `<b>${p.symbol} ${p.side.toUpperCase()}</b>\n\n` +
      `Entry: <code>${p.entryPrice}</code>\n` +
      `Current: <code>${p.currentPrice ?? "–"}</code>\n` +
      `Size: <code>${p.size}</code>\n` +
      `Leverage: <code>×${p.leverage}</code>\n` +
      `Margin: <code>${margin.toFixed(2)} USDT</code>\n` +
      `Stop Loss: <code>${p.stopLoss ?? "–"}</code>\n` +
      `Take Profit: <code>${p.takeProfit ?? "–"}</code>\n` +
      `Unrealized PnL: <code>${upnl.toFixed(2)} USDT (${roe}% ROE)</code>\n` +
      `Strategy: <code>${p.strategyType ?? "–"}</code>\n` +
      `Opened: <code>${p.createdAt.toISOString()}</code>`;

    await reply(creds, chatId, text);
  } catch (err) {
    await reply(creds, chatId, `❌ Error: ${(err as Error).message}`);
  }
}

async function handlePnl(chatId: string, creds: BotCredentials): Promise<void> {
  try {
    const db = getDb();

    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [todayRows, weekRows] = await Promise.all([
      db
        .select({ realizedPnl: positions.realizedPnl })
        .from(positions)
        .where(
          and(
            eq(positions.userId, 1),
            eq(positions.status, "closed"),
            gte(positions.closedAt, todayMidnight)
          )
        ),
      db
        .select({ realizedPnl: positions.realizedPnl })
        .from(positions)
        .where(
          and(
            eq(positions.userId, 1),
            eq(positions.status, "closed"),
            gte(positions.closedAt, weekAgo)
          )
        ),
    ]);

    const todayPnl = todayRows.reduce((s, r) => s + parseFloat(r.realizedPnl ?? "0"), 0);
    const weekPnl = weekRows.reduce((s, r) => s + parseFloat(r.realizedPnl ?? "0"), 0);

    const todayWins = todayRows.filter((r) => parseFloat(r.realizedPnl ?? "0") > 0).length;
    const todayLosses = todayRows.filter((r) => parseFloat(r.realizedPnl ?? "0") <= 0).length;
    const weekWins = weekRows.filter((r) => parseFloat(r.realizedPnl ?? "0") > 0).length;
    const weekLosses = weekRows.filter((r) => parseFloat(r.realizedPnl ?? "0") <= 0).length;

    const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} USDT`;

    const text =
      `<b>PnL Summary</b>\n\n` +
      `<b>Today:</b> ${fmt(todayPnl)}\n` +
      `  Trades: ${todayRows.length} (✅ ${todayWins} / ❌ ${todayLosses})\n\n` +
      `<b>Last 7 days:</b> ${fmt(weekPnl)}\n` +
      `  Trades: ${weekRows.length} (✅ ${weekWins} / ❌ ${weekLosses})`;

    await reply(creds, chatId, text);
  } catch (err) {
    await reply(creds, chatId, `❌ Error: ${(err as Error).message}`);
  }
}

async function handleHelp(chatId: string, creds: BotCredentials): Promise<void> {
  const text =
    `<b>Janus Bot Commands</b>\n\n` +
    `/status — open positions, PnL, uptime, kill switch\n` +
    `/pause — trigger kill switch (stop new orders)\n` +
    `/resume — reset kill switch\n` +
    `/stop — alias for /pause\n` +
    `/closeall — close all open positions\n` +
    `/pos &lt;SYMBOL&gt; — single position detail (e.g. /pos BTCUSDT)\n` +
    `/pnl — daily &amp; weekly realized PnL\n` +
    `/help — show this message`;
  await reply(creds, chatId, text);
}

// ─── Command dispatcher ───────────────────────────────────────────────────────

async function handleCommand(
  text: string,
  fromChatId: string,
  creds: BotCredentials
): Promise<void> {
  // Security: only respond to the configured chat ID
  if (fromChatId !== creds.chatId) {
    console.warn(`[telegram-bot] Ignoring command from unauthorized chat ${fromChatId}`);
    return;
  }

  const parts = text.trim().split(/\s+/);
  // Strip bot username suffix if present (e.g. /status@mybot)
  const rawCmd = (parts[0] ?? "").split("@")[0].toLowerCase();
  const arg = parts[1] ?? "";

  switch (rawCmd) {
    case "/status":
      await handleStatus(fromChatId, creds);
      break;
    case "/pause":
    case "/stop":
      await handlePause(fromChatId, creds);
      break;
    case "/resume":
      await handleResume(fromChatId, creds);
      break;
    case "/closeall":
      await handleCloseAll(fromChatId, creds);
      break;
    case "/pos":
      await handlePos(arg, fromChatId, creds);
      break;
    case "/pnl":
      await handlePnl(fromChatId, creds);
      break;
    case "/help":
    default:
      await handleHelp(fromChatId, creds);
      break;
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

async function pollUpdates(): Promise<void> {
  const creds = await getBotCredentials();
  if (!creds) return; // no token configured yet — silently skip

  try {
    const url =
      `https://api.telegram.org/bot${creds.botToken}/getUpdates` +
      `?offset=${lastUpdateId + 1}&timeout=2&allowed_updates=%5B%22message%22%5D`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return;

    const body = (await res.json()) as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?: { text?: string; chat?: { id: number } };
      }>;
    };

    if (!body.ok || !Array.isArray(body.result)) return;

    for (const update of body.result) {
      lastUpdateId = update.update_id;

      const msgText = update.message?.text;
      const chatId = String(update.message?.chat?.id ?? "");
      if (!msgText || !chatId || !msgText.startsWith("/")) continue;

      // Fire-and-forget; errors are logged inside each handler
      handleCommand(msgText, chatId, creds).catch((err) => {
        console.error(`[telegram-bot] Command handler error:`, err);
      });
    }
  } catch (err) {
    // Network errors during polling are expected (timeout, transient failures)
    // Log only non-timeout errors to avoid noise
    if ((err as Error).name !== "TimeoutError" && (err as Error).name !== "AbortError") {
      console.error("[telegram-bot] Poll error:", err);
    }
  }
}

// ─── Public lifecycle ─────────────────────────────────────────────────────────

// ─── Heartbeat ────────────────────────────────────────────────────────────────
// Sent every 6 hours so the operator knows the bot is alive without doing anything.

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat(): Promise<void> {
  const creds = await getBotCredentials();
  if (!creds) return;

  try {
    const db = getDb();
    const openPositions = await db
      .select({ id: positions.id, symbol: positions.symbol, unrealizedPnl: positions.unrealizedPnl })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open")));

    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const todayRows = await db
      .select({ realizedPnl: positions.realizedPnl })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "closed"), gte(positions.closedAt, todayMidnight)));

    const todayPnl = todayRows.reduce((s, r) => s + parseFloat(r.realizedPnl ?? "0"), 0);
    const unrealized = openPositions.reduce((s, p) => s + parseFloat(p.unrealizedPnl ?? "0"), 0);
    const uptimeSec = Math.floor((Date.now() - _bootTime) / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const killStr = globalKillSwitch.isActive ? "🔴 KILL SWITCH ACTIVE" : "🟢 trading enabled";
    const modeStr = env.paperTrading ? "🧪 PAPER MODE" : env.placeOrders ? "💰 LIVE" : "📋 Dry-run";

    const text =
      `💓 <b>Heartbeat</b>\n\n` +
      `Uptime: ${hours}h ${mins}m\n` +
      `Mode: ${modeStr}\n` +
      `Open positions: ${openPositions.length}\n` +
      `Unrealized PnL: ${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)} USDT\n` +
      `Today realized: ${todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)} USDT\n` +
      `Status: ${killStr}`;

    await sendTelegramMessage({ botToken: creds.botToken, chatId: creds.chatId, text, parseMode: "HTML" });
  } catch (err) {
    console.error("[telegram-bot] Heartbeat failed:", err);
  }
}

export function startTelegramCommandBot(): void {
  // HMR guard — prevent double-init during Vite hot reloads
  const g = globalThis as Record<string, unknown>;
  if (g["__telegramCommandBot__"]) {
    console.log("[telegram-bot] Already running — skipping re-init");
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Poll every 3 seconds (long-polling with timeout=2 inside each call)
  pollInterval = setInterval(() => {
    pollUpdates().catch(() => {}); // swallow top-level errors
  }, 3_000);

  // Heartbeat every 6 hours
  heartbeatInterval = setInterval(() => {
    sendHeartbeat().catch(() => {});
  }, 6 * 60 * 60_000);

  g["__telegramCommandBot__"] = pollInterval;
  console.log("[telegram-bot] Command bot started (polling every 3s, heartbeat every 6h)");
}

export function stopTelegramCommandBot(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  const g = globalThis as Record<string, unknown>;
  delete g["__telegramCommandBot__"];
  console.log("[telegram-bot] Command bot stopped");
}
