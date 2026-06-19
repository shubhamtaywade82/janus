// ─── Position Manager → Telegram Notifier ───────────────────────────────────
// Listens to Position Manager event-bus events and sends Telegram notifications
// for significant position lifecycle events: open, close, partial exit, protection,
// trailing stop, errors.  Assessment events (every 30s) are deliberately ignored
// to avoid spam.

import { positionManagerBus } from "./position-manager/event-bus";
import { sendTelegramMessage, isTelegramPaused } from "./telegram";
import { getDb } from "../queries/connection";
import { users, positions } from "@db/schema";
import { positionTransactions } from "@db/position-manager-schema";
import { eq, desc, and } from "drizzle-orm";
import type { ManagedPosition, PositionAction } from "./position-manager/types";

// ─── Config ──────────────────────────────────────────────────────────────────

// Debounce rapid-fire events on the same position (e.g. sync + discovered)
const POSITION_EVENT_DEBOUNCE_MS = 5_000;
const lastNotifiedForPosition = new Map<number, number>();

function canNotifyPosition(positionId: number): boolean {
  const last = lastNotifiedForPosition.get(positionId) ?? 0;
  if (Date.now() - last < POSITION_EVENT_DEBOUNCE_MS) return false;
  lastNotifiedForPosition.set(positionId, Date.now());
  return true;
}

// ─── Credential helper ───────────────────────────────────────────────────────

async function getTelegramCreds(): Promise<{ botToken: string; chatId: string } | null> {
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
    console.error("[position-telegram] Failed to fetch credentials:", err);
    return null;
  }
}

// ─── Message builders ────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildOpenMessage(p: ManagedPosition, isPaper: boolean): string {
  const mode = isPaper ? "🧪 PAPER" : "💰 LIVE";
  const sideEmoji = p.side === "LONG" ? "🟢" : "🔴";
  const currency = isPaper ? "₹" : "USDT";
  
  // Format: 🟢 Position Opened | {symbol} {side} ×{leverage} | Entry: {entry} | Size: {size} | Margin: {margin} | Mark: {mark_price} | SL: {sl} | TP: {tp}
  return (
    `${sideEmoji} <b>Position Opened</b> ${mode}\n` +
    `<b>${escapeHtml(p.symbol)}</b> ${p.side} ×${p.leverage} | ` +
    `Entry: <code>${p.entryPrice.toFixed(4)}</code> | ` +
    `Size: <code>${p.quantity.toFixed(4)}</code> | ` +
    `Margin: <code>${p.margin.toFixed(2)} ${currency}</code> | ` +
    `Mark: <code>${p.markPrice.toFixed(4)}</code> | ` +
    `SL: <code>${p.stopLoss?.toFixed(4) ?? "None"}</code> | ` +
    `TP: <code>${p.takeProfit?.toFixed(4) ?? "None"}</code>`
  );
}

async function buildCloseMessage(positionId: number, reason: string): Promise<string> {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        symbol: positions.symbol,
        side: positions.side,
        entryPrice: positions.entryPrice,
        currentPrice: positions.currentPrice,
        realizedPnl: positions.realizedPnl,
        leverage: positions.leverage,
        size: positions.size,
        isPaper: positions.isPaper,
        createdAt: positions.createdAt,
        closedAt: positions.closedAt,
      })
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!row) {
      return `🔴 <b>Position Closed</b>\n\nID: ${positionId}\nReason: ${escapeHtml(reason)}`;
    }

    const isPaper = row.isPaper ?? false;
    const mode = isPaper ? "🧪 PAPER" : "💰 LIVE";
    const currency = isPaper ? "₹" : "USDT";
    const pnl = parseFloat(row.realizedPnl ?? "0");
    const exit = parseFloat(row.currentPrice ?? "0");
    const side = row.side?.toUpperCase() ?? "UNKNOWN";
    
    const durationMs = (row.closedAt ? row.closedAt.getTime() : Date.now()) - row.createdAt.getTime();
    const durationMin = Math.floor(durationMs / 60_000);
    const durationStr = durationMin > 60 
      ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` 
      : `${durationMin}m`;

    // Format: 🔴 Position Closed | {symbol} {side} | Exit: {price} | Mark: {mark_price} | Total Realized: {pnl} | Duration: {time}
    return (
      `🔴 <b>Position Closed</b> ${mode}\n` +
      `<b>${escapeHtml(row.symbol)}</b> ${side} | ` +
      `Exit: <code>${exit.toFixed(4)}</code> | ` +
      `Mark: <code>${exit.toFixed(4)}</code> | ` +
      `Total Realized: <b>${pnl.toFixed(2)} ${currency}</b> | ` +
      `Duration: <code>${durationStr}</code>\n` +
      `Reason: <i>${escapeHtml(reason)}</i>`
    );
  } catch (err) {
    console.error("[position-telegram] Error building close message:", err);
    return `🔴 <b>Position Closed</b>\n\nID: ${positionId}\nReason: ${escapeHtml(reason)}`;
  }
}

async function buildActionMessage(
  positionId: number,
  action: PositionAction,
  result: "ok" | "failed",
  detail?: string
): Promise<string> {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        symbol: positions.symbol,
        side: positions.side,
        leverage: positions.leverage,
        currentPrice: positions.currentPrice,
        entryPrice: positions.entryPrice,
        extremePrice: positions.extremePrice,
        size: positions.size,
        realizedPnl: positions.realizedPnl,
        isPaper: positions.isPaper,
        stopLoss: positions.stopLoss,
      })
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!row) {
      return `⚡ <b>${action}</b>\n\nPosition ID: <code>${positionId}</code>\nResult: ${result}\n${detail ?? ""}`;
    }

    // Fetch latest transaction for precise details
    const [tx] = await db
      .select()
      .from(positionTransactions)
      .where(eq(positionTransactions.positionId, positionId))
      .orderBy(desc(positionTransactions.createdAt))
      .limit(1);

    const isPaper = row.isPaper ?? false;
    const mode = isPaper ? "🧪 PAPER" : "💰 LIVE";
    const side = row.side?.toUpperCase() ?? "UNKNOWN";
    const mark = parseFloat(row.currentPrice ?? "0");
    const entry = tx?.avgEntryPrice ? parseFloat(tx.avgEntryPrice) : parseFloat(row.entryPrice ?? "0");
    const sl = row.stopLoss ? parseFloat(row.stopLoss) : 0;
    const extreme = row.extremePrice ? parseFloat(row.extremePrice) : 0;
    const currency = isPaper ? "₹" : "USDT";

    const statusEmoji = result === "ok" ? "" : "❌ ";
    const statusText = result === "ok" ? "" : " (FAILED)";

    // Standardized Formats based on Action
    if (action === "MOVE_TO_BREAKEVEN") {
      // 🛡️ Breakeven | {symbol} {side} | Avg Entry: {avg_entry} | Mark: {mark_price} | SL locked at {sl}
      return (
        `${statusEmoji}🛡️ <b>Breakeven${statusText}</b> ${mode}\n` +
        `<b>${escapeHtml(row.symbol)}</b> ${side} | ` +
        `Avg Entry: <code>${entry.toFixed(4)}</code> | ` +
        `Mark: <code>${mark.toFixed(4)}</code> | ` +
        `SL locked at <code>${sl.toFixed(4)}</code>` +
        (detail ? `\nDetail: <i>${escapeHtml(detail)}</i>` : "")
      );
    }

    if (action === "TRAIL_SL") {
      // 🎯 Trail Stop | {symbol} {side} | Mark: {mark_price} | SL trailed to {sl} | Extreme: {extreme_price}
      return (
        `${statusEmoji}🎯 <b>Trail Stop${statusText}</b> ${mode}\n` +
        `<b>${escapeHtml(row.symbol)}</b> ${side} | ` +
        `Mark: <code>${mark.toFixed(4)}</code> | ` +
        `SL trailed to <code>${sl.toFixed(4)}</code> | ` +
        `Extreme: <code>${extreme.toFixed(4)}</code>` +
        (detail ? `\nDetail: <i>${escapeHtml(detail)}</i>` : "")
      );
    }

    if (action === "PARTIAL_EXIT" || action === "REDUCE_SIZE") {
      // 📉 Partial Exit | {symbol} {side} | Closed {size} @ {price} | Mark: {mark_price} | Realized: {pnl} | Remaining: {size}
      const pnl = tx?.realizedPnl ? parseFloat(tx.realizedPnl) : 0;
      const closedSize = tx?.quantityDelta ? Math.abs(parseFloat(tx.quantityDelta)) : 0;
      const closedPrice = tx?.price ? parseFloat(tx.price) : mark;

      return (
        `${statusEmoji}📉 <b>Partial Exit${statusText}</b> ${mode}\n` +
        `<b>${escapeHtml(row.symbol)}</b> ${side} | ` +
        `Closed <code>${closedSize.toFixed(4)}</code> @ <code>${closedPrice.toFixed(4)}</code> | ` +
        `Mark: <code>${mark.toFixed(4)}</code> | ` +
        `Realized: <b>${pnl.toFixed(2)} ${currency}</b> | ` +
        `Remaining: <code>${row.size}</code>` +
        (detail ? `\nDetail: <i>${escapeHtml(detail)}</i>` : "")
      );
    }

    if (action === "SCALE_IN") {
      // 📈 Scale In | {symbol} {side} | Added {size} @ {price} | Mark: {mark_price} | New Avg Entry: {avg_entry} | Total Size: {size}
      const addedSize = tx?.quantityDelta ? parseFloat(tx.quantityDelta) : 0;
      const addedPrice = tx?.price ? parseFloat(tx.price) : mark;

      return (
        `${statusEmoji}📈 <b>Scale In${statusText}</b> ${mode}\n` +
        `<b>${escapeHtml(row.symbol)}</b> ${side} | ` +
        `Added <code>${addedSize.toFixed(4)}</code> @ <code>${addedPrice.toFixed(4)}</code> | ` +
        `Mark: <code>${mark.toFixed(4)}</code> | ` +
        `New Avg Entry: <code>${entry.toFixed(4)}</code> | ` +
        `Total Size: <code>${row.size}</code>` +
        (detail ? `\nDetail: <i>${escapeHtml(detail)}</i>` : "")
      );
    }

    // Fallback for other actions
    const actionLabels: Record<string, { emoji: string; label: string }> = {
      TIGHTEN_TP: { emoji: "📈", label: "Tighten TP" },
      EXTEND_TP: { emoji: "📈", label: "Extend TP" },
      FULL_EXIT: { emoji: "🔒", label: "Full Exit" },
    };

    const cfg = actionLabels[action] ?? { emoji: "⚡", label: action };
    return (
      `${statusEmoji}${cfg.emoji} <b>${cfg.label}${statusText}</b> ${mode}\n` +
      `<b>${escapeHtml(row.symbol)}</b> ${side} ×${row.leverage} | ` +
      `Mark: <code>${mark.toFixed(4)}</code>` +
      (detail ? `\nDetail: <i>${escapeHtml(detail)}</i>` : "")
    );

  } catch (err) {
    console.error("[position-telegram] Error building action message:", err);
    return `⚡ <b>${action}</b>\n\nPosition ID: <code>${positionId}</code>\nResult: ${result}\n${detail ?? ""}`;
  }
}

async function buildProtectedMessage(positionId: number, sl: number, tp: number): Promise<string> {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        symbol: positions.symbol,
        side: positions.side,
        leverage: positions.leverage,
        currentPrice: positions.currentPrice,
        isPaper: positions.isPaper,
      })
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!row) {
      return `🛡️ <b>Protection Set</b>\n\nPosition ID: <code>${positionId}</code>\nSL: ${sl}\nTP: ${tp}`;
    }

    const mode = row.isPaper ? "🧪 PAPER" : "💰 LIVE";
    const side = row.side?.toUpperCase() ?? "UNKNOWN";
    const mark = parseFloat(row.currentPrice ?? "0");

    const modeLabel = row.isPaper ? "Bot-Managed (Paper)" : "Bot-Managed (Live)";
    return (
      `🛡️ <b>Protection Set</b> ${mode} <i>${modeLabel}</i>\n` +
      `<b>${escapeHtml(row.symbol)}</b> ${side} ×${row.leverage} | ` +
      `Mark: <code>${mark.toFixed(4)}</code> | ` +
      `SL: <code>${sl.toFixed(4)}</code> | ` +
      `TP: <code>${tp.toFixed(4)}</code>\n` +
      `<i>Note: Protection is enforced by Janus trailing engine — not exchange-native conditional orders</i>`
    );
  } catch (err) {
    console.error("[position-telegram] Error building protected message:", err);
    return `🛡️ <b>Protection Set (Bot-Managed)</b>\n\nPosition ID: <code>${positionId}</code>\nSL: ${sl}\nTP: ${tp}`;
  }
}

async function buildProtectionMismatchMessage(
  positionId: number,
  botSl: number,
  botTp: number,
  exSl: number | null,
  exTp: number | null
): Promise<string> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ symbol: positions.symbol, side: positions.side, leverage: positions.leverage, isPaper: positions.isPaper })
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    const symbol = row ? escapeHtml(row.symbol) : `#${positionId}`;
    const side = row?.side?.toUpperCase() ?? "";
    const mode = row?.isPaper ? "🧪 PAPER" : "💰 LIVE";

    return (
      `🚨 <b>Protection Mismatch</b> ${mode}\n` +
      `<b>${symbol}</b> ${side}\n` +
      `Bot SL: <code>${botSl.toFixed(4)}</code> | ` +
      `Exchange SL: <code>${exSl !== null ? exSl.toFixed(4) : "—"}</code>\n` +
      `Bot TP: <code>${botTp.toFixed(4)}</code> | ` +
      `Exchange TP: <code>${exTp !== null ? exTp.toFixed(4) : "—"}</code>\n` +
      `<i>Exchange may have been modified manually. Janus will continue enforcing bot-side SL/TP.</i>`
    );
  } catch (err) {
    console.error("[position-telegram] Error building mismatch message:", err);
    return (
      `🚨 <b>Protection Mismatch</b>\n\nPosition ID: <code>${positionId}</code>\n` +
      `Bot: SL=${botSl} TP=${botTp} | Exchange: SL=${exSl ?? "—"} TP=${exTp ?? "—"}`
    );
  }
}

function buildErrorMessage(context: string, error: Error): string {
  return (
    `⚠️ <b>Position Manager Error</b>\n\n` +
    `Context: <code>${escapeHtml(context)}</code>\n` +
    `Error: <pre>${escapeHtml(error.message)}</pre>`
  );
}

// ─── Send helper ─────────────────────────────────────────────────────────────

async function notify(text: string): Promise<void> {
  if (isTelegramPaused()) return;
  const creds = await getTelegramCreds();
  if (!creds) return;
  await sendTelegramMessage({ botToken: creds.botToken, chatId: creds.chatId, text, parseMode: "HTML" });
}

// ─── Event handlers ──────────────────────────────────────────────────────────

let isRunning = false;

function onDiscovered(position: ManagedPosition) {
  if (position.openedAlertSent) return; // already alerted before restart
  if (!canNotifyPosition(position.id)) return;
  notify(buildOpenMessage(position, position.isPaper)).catch(() => {});
}

function onClosed(positionId: number, reason: string) {
  if (!canNotifyPosition(positionId)) return;
  buildCloseMessage(positionId, reason)
    .then((text) => notify(text))
    .catch(() => {});
}

function onActionExecuted(positionId: number, action: PositionAction, result: "ok" | "failed", detail?: string) {
  // Skip noisy / redundant events
  if (action === "KEEP_OPEN") return;
  // FULL_EXIT is already handled by position:closed which has richer info
  if (action === "FULL_EXIT" && result === "ok") return;
  if (!canNotifyPosition(positionId)) return;

  buildActionMessage(positionId, action, result, detail)
    .then((text) => notify(text))
    .catch((err) => console.error("[position-telegram] Error in onActionExecuted:", err));
}

function onProtected(positionId: number, sl: number, tp: number) {
  if (!canNotifyPosition(positionId)) return;
  buildProtectedMessage(positionId, sl, tp)
    .then((text) => notify(text))
    .catch((err) => console.error("[position-telegram] Error in onProtected:", err));
}

function onProtectionMismatch(
  positionId: number,
  botSl: number,
  botTp: number,
  exSl: number | null,
  exTp: number | null
) {
  // Not debounced — mismatch is always worth alerting immediately
  buildProtectionMismatchMessage(positionId, botSl, botTp, exSl, exTp)
    .then((text) => notify(text))
    .catch((err) => console.error("[position-telegram] Error in onProtectionMismatch:", err));
}

function onError(context: string, error: Error) {
  notify(buildErrorMessage(context, error)).catch(() => {});
}

function onStarted() {
  notify("🤖 <b>Position Manager Started</b>\n\nMonitoring open positions every 30s.").catch(() => {});
}

function onStopped() {
  notify("🛑 <b>Position Manager Stopped</b>").catch(() => {});
}

// ─── Public lifecycle ────────────────────────────────────────────────────────

export function startPositionTelegramNotifier(): void {
  if (isRunning) return;
  isRunning = true;

  positionManagerBus.on("position:discovered", onDiscovered);
  positionManagerBus.on("position:closed", onClosed);
  positionManagerBus.on("position:action-executed", onActionExecuted);
  positionManagerBus.on("position:protected", onProtected);
  positionManagerBus.on("position:protection-mismatch", onProtectionMismatch);
  positionManagerBus.on("manager:error", onError);
  positionManagerBus.on("manager:started", onStarted);
  positionManagerBus.on("manager:stopped", onStopped);

  console.log("[position-telegram-notifier] Started — listening for position events");
}

export function stopPositionTelegramNotifier(): void {
  if (!isRunning) return;
  isRunning = false;

  positionManagerBus.off("position:discovered", onDiscovered);
  positionManagerBus.off("position:closed", onClosed);
  positionManagerBus.off("position:action-executed", onActionExecuted);
  positionManagerBus.off("position:protected", onProtected);
  positionManagerBus.off("position:protection-mismatch", onProtectionMismatch);
  positionManagerBus.off("manager:error", onError);
  positionManagerBus.off("manager:started", onStarted);
  positionManagerBus.off("manager:stopped", onStopped);

  console.log("[position-telegram-notifier] Stopped");
}
