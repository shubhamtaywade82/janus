// ─── Position Manager → Telegram Notifier ───────────────────────────────────
// Listens to Position Manager event-bus events and sends Telegram notifications
// for significant position lifecycle events: open, close, partial exit, protection,
// trailing stop, errors.  Assessment events (every 30s) are deliberately ignored
// to avoid spam.

import { positionManagerBus } from "./position-manager/event-bus";
import { sendTelegramMessage } from "./telegram";
import { getDb } from "../queries/connection";
import { users, positions } from "@db/schema";
import { eq } from "drizzle-orm";
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
  const pnlEmoji = p.unrealizedPnl >= 0 ? "📈" : "📉";
  return (
    `${sideEmoji} <b>Position Opened</b> ${mode}\n\n` +
    `<b>${escapeHtml(p.symbol)}</b> ${p.side} ×${p.leverage}\n` +
    `Entry: <code>${p.entryPrice.toFixed(4)}</code>\n` +
    `Size: <code>${p.quantity.toFixed(4)}</code> | Margin: <code>${p.margin.toFixed(2)} USDT</code>\n` +
    `${pnlEmoji} uPnL: <code>${p.unrealizedPnl.toFixed(2)} USDT</code> | ROE: <code>${p.roe.toFixed(2)}%</code>\n` +
    (p.stopLoss ? `SL: <code>${p.stopLoss.toFixed(4)}</code>  ` : "") +
    (p.takeProfit ? `TP: <code>${p.takeProfit.toFixed(4)}</code>` : "")
  );
}

async function buildCloseMessage(positionId: number, reason: string, isPaper: boolean): Promise<string> {
  const mode = isPaper ? "🧪 PAPER" : "💰 LIVE";
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
      })
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!row) {
      return `🔒 <b>Position Closed</b> ${mode}\n\nID: ${positionId}\nReason: ${escapeHtml(reason)}`;
    }

    const pnl = parseFloat(row.realizedPnl ?? "0");
    const isProfit = pnl >= 0;
    const pnlEmoji = isProfit ? "💰" : "🔴";
    const entry = parseFloat(row.entryPrice ?? "0");
    const exit = parseFloat(row.currentPrice ?? "0");
    const side = row.side?.toUpperCase() ?? "UNKNOWN";

    return (
      `${pnlEmoji} <b>Position Closed</b> ${mode}\n\n` +
      `<b>${escapeHtml(row.symbol)}</b> ${side} ×${row.leverage}\n` +
      `Entry: <code>${entry.toFixed(4)}</code> → Exit: <code>${exit.toFixed(4)}</code>\n` +
      `Size: <code>${row.size}</code>\n` +
      `PnL: <b>${isProfit ? "+" : ""}${pnl.toFixed(2)} USDT</b>\n` +
      `Reason: <i>${escapeHtml(reason)}</i>`
    );
  } catch {
    return `🔒 <b>Position Closed</b> ${mode}\n\nID: ${positionId}\nReason: ${escapeHtml(reason)}`;
  }
}

function buildActionMessage(
  positionId: number,
  action: PositionAction,
  result: "ok" | "failed",
  detail?: string
): string {
  const actionLabels: Record<string, { emoji: string; label: string }> = {
    PARTIAL_EXIT: { emoji: "📉", label: "Partial Exit" },
    REDUCE_SIZE: { emoji: "📉", label: "Reduce Size" },
    MOVE_TO_BREAKEVEN: { emoji: "🛡️", label: "Breakeven" },
    TRAIL_SL: { emoji: "🎯", label: "Trail Stop" },
    TIGHTEN_TP: { emoji: "📈", label: "Tighten TP" },
    EXTEND_TP: { emoji: "📈", label: "Extend TP" },
    SCALE_IN: { emoji: "📥", label: "Scale In" },
    FULL_EXIT: { emoji: "🔒", label: "Full Exit" },
  };

  const cfg = actionLabels[action] ?? { emoji: "⚡", label: action };
  const statusEmoji = result === "ok" ? "" : "❌ ";
  const statusText = result === "ok" ? "" : " (FAILED)";

  return (
    `${statusEmoji}${cfg.emoji} <b>${cfg.label}${statusText}</b>\n\n` +
    `Position ID: <code>${positionId}</code>\n` +
    (detail ? `Detail: <i>${escapeHtml(detail)}</i>` : "")
  );
}

function buildProtectedMessage(positionId: number, sl: number, tp: number): string {
  return (
    `🛡️ <b>Protection Set</b>\n\n` +
    `Position ID: <code>${positionId}</code>\n` +
    `SL: <code>${sl.toFixed(4)}</code>\n` +
    `TP: <code>${tp.toFixed(4)}</code>`
  );
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
  const creds = await getTelegramCreds();
  if (!creds) return;
  await sendTelegramMessage({ botToken: creds.botToken, chatId: creds.chatId, text, parseMode: "HTML" });
}

// ─── Event handlers ──────────────────────────────────────────────────────────

let isRunning = false;

function onDiscovered(position: ManagedPosition) {
  if (!canNotifyPosition(position.id)) return;
  notify(buildOpenMessage(position, position.isPaper)).catch(() => {});
}

function onClosed(positionId: number, reason: string) {
  if (!canNotifyPosition(positionId)) return;
  // Need to fetch isPaper from DB since the event doesn't carry it
  buildCloseMessage(positionId, reason, false)
    .then((text) => notify(text))
    .catch(() => {});
}

function onActionExecuted(positionId: number, action: PositionAction, result: "ok" | "failed", detail?: string) {
  // Skip noisy / redundant events
  if (action === "KEEP_OPEN") return;
  // FULL_EXIT is already handled by position:closed which has richer info
  if (action === "FULL_EXIT" && result === "ok") return;
  if (!canNotifyPosition(positionId)) return;

  notify(buildActionMessage(positionId, action, result, detail)).catch(() => {});
}

function onProtected(positionId: number, sl: number, tp: number) {
  if (!canNotifyPosition(positionId)) return;
  notify(buildProtectedMessage(positionId, sl, tp)).catch(() => {});
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
  positionManagerBus.off("manager:error", onError);
  positionManagerBus.off("manager:started", onStarted);
  positionManagerBus.off("manager:stopped", onStopped);

  console.log("[position-telegram-notifier] Stopped");
}
