/**
 * Telegram Service
 * Handles sending alerts and system notifications to Telegram channels/chats.
 */

import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { env } from "../lib/env";

export interface SendTelegramMessageOptions {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

// ─── Global rate limiter ───
// Telegram allows 30 messages/second per bot, but practically 1 msg/s per chat
// to avoid flooding. We enforce a minimum gap and respect 429 retry_after.
const MIN_SEND_INTERVAL_MS = 3_000;
let lastSentAt = 0;
let rateLimitUntil = 0;

// ─── Circuit breaker for unreachable API (blocked networks, DNS failures) ───
const INITIAL_CIRCUIT_BACKOFF_MS = 60_000;
const MAX_CIRCUIT_BACKOFF_MS = 30 * 60_000;
const CIRCUIT_LOG_INTERVAL_MS = 5 * 60_000;
let circuitOpenUntil = 0;
let circuitBackoffMs = INITIAL_CIRCUIT_BACKOFF_MS;
let lastCircuitLogAt = 0;

export function getTelegramApiBase(): string {
  return env.telegramApiBase;
}

export function isTelegramPaused(): boolean {
  const now = Date.now();
  return now < rateLimitUntil || now < circuitOpenUntil;
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  return (
    error.message.includes("fetch failed") ||
    cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    cause?.code === "ECONNREFUSED" ||
    cause?.code === "ENOTFOUND" ||
    cause?.code === "ETIMEDOUT"
  );
}

function openCircuit(reason: string): void {
  circuitOpenUntil = Date.now() + circuitBackoffMs;
  const now = Date.now();
  if (now - lastCircuitLogAt >= CIRCUIT_LOG_INTERVAL_MS) {
    const backoffSec = Math.round(circuitBackoffMs / 1000);
    console.warn(
      `[telegram] API unreachable — pausing sends for ${backoffSec}s (${reason}). ` +
        `Set TELEGRAM_API_BASE if using a local Bot API proxy.`,
    );
    lastCircuitLogAt = now;
  }
  circuitBackoffMs = Math.min(circuitBackoffMs * 2, MAX_CIRCUIT_BACKOFF_MS);
}

/** Record a network-level Telegram failure (shared by send + polling paths). */
export function recordTelegramNetworkFailure(reason: string): void {
  openCircuit(reason);
}

function closeCircuit(): void {
  circuitOpenUntil = 0;
  circuitBackoffMs = INITIAL_CIRCUIT_BACKOFF_MS;
}

/** Test-only reset for module-level rate/circuit state. */
export function __resetTelegramStateForTests(): void {
  lastSentAt = 0;
  rateLimitUntil = 0;
  circuitOpenUntil = 0;
  circuitBackoffMs = INITIAL_CIRCUIT_BACKOFF_MS;
  lastCircuitLogAt = 0;
}

/**
 * Sends a text message to a specific Telegram chat/channel using a Telegram Bot.
 * Respects the global rate limit, 429 backoff, and network circuit breaker.
 */
export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  parseMode = "HTML",
}: SendTelegramMessageOptions): Promise<boolean> {
  if (!botToken || !chatId) {
    console.warn("Telegram alert skipped: botToken or chatId is not configured.");
    return false;
  }

  const now = Date.now();
  if (now < rateLimitUntil || now < circuitOpenUntil) {
    return false;
  }
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
    return false;
  }

  try {
    const response = await fetch(`${getTelegramApiBase()}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
      signal: AbortSignal.timeout(env.telegramConnectTimeoutMs),
    });

    if (response.status === 429) {
      const body = (await response.json().catch(() => ({}))) as {
        parameters?: { retry_after?: number };
      };
      const retryAfterSec = body?.parameters?.retry_after ?? 60;
      rateLimitUntil = Date.now() + retryAfterSec * 1_000;
      console.warn(`[telegram] Rate-limited — backing off ${retryAfterSec}s`);
      return false;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram Bot API Error (status ${response.status}):`, errorText);
      return false;
    }

    lastSentAt = Date.now();
    closeCircuit();
    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      openCircuit((error as Error).message);
    } else {
      console.error("Failed to send Telegram message:", error);
    }
    return false;
  }
}

/**
 * Tests connection with the provided bot token and chat ID by sending a test message.
 */
export async function testTelegramConnection(botToken: string, chatId: string): Promise<boolean> {
  const testMessage = `🤖 <b>Janus Trading Bot</b>\n\nConnection test successful! You will now receive alert notifications here.`;
  return sendTelegramMessage({ botToken, chatId, text: testMessage });
}

/**
 * Broadcasts an alert message to the primary Telegram chat by fetching credentials from the DB.
 * Enforces global rate limiting — excess calls are silently dropped.
 */
export async function broadcastTelegramAlert(
  text: string,
  options?: { isLiquidityAlert?: boolean },
): Promise<boolean> {
  if (isTelegramPaused()) return false;

  try {
    const db = getDb();
    const user = await db
      .select({
        telegramBotToken: users.telegramBotToken,
        telegramChatId: users.telegramChatId,
        telegramLiquidityAlertsEnabled: users.telegramLiquidityAlertsEnabled,
      })
      .from(users)
      .limit(1);

    if (!user || user.length === 0) return false;
    const settings = user[0];

    if (options?.isLiquidityAlert && !settings.telegramLiquidityAlertsEnabled) {
      return false;
    }

    if (!settings.telegramBotToken || !settings.telegramChatId) return false;

    return sendTelegramMessage({
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      text,
    });
  } catch (error) {
    console.error("Failed to broadcast telegram alert:", error);
    return false;
  }
}
