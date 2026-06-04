/**
 * Telegram Service
 * Handles sending alerts and system notifications to Telegram channels/chats.
 */

import { getDb } from "../queries/connection";
import { users } from "@db/schema";

export interface SendTelegramMessageOptions {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

// ─── Global rate limiter ───
// Telegram allows 30 messages/second per bot, but practically 1 msg/s per chat
// to avoid flooding. We enforce a minimum gap and respect 429 retry_after.
const MIN_SEND_INTERVAL_MS = 3_000; // 1 alert per 3 seconds max
let lastSentAt = 0;
let blockedUntil = 0; // non-zero when a 429 told us to back off

/**
 * Sends a text message to a specific Telegram chat/channel using a Telegram Bot.
 * Respects the global rate limit and 429 backoff.
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
  if (now < blockedUntil) {
    // Still in 429 backoff — silently drop
    return false;
  }
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
    // Rate-limit locally — silently drop
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });

    if (response.status === 429) {
      const body = await response.json().catch(() => ({})) as { parameters?: { retry_after?: number } };
      const retryAfterSec = body?.parameters?.retry_after ?? 60;
      blockedUntil = Date.now() + retryAfterSec * 1_000;
      console.warn(`[telegram] Rate-limited — backing off ${retryAfterSec}s`);
      return false;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram Bot API Error (status ${response.status}):`, errorText);
      return false;
    }

    lastSentAt = Date.now();
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
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
export async function broadcastTelegramAlert(text: string): Promise<boolean> {
  try {
    const db = getDb();
    const user = await db
      .select({ 
        telegramBotToken: users.telegramBotToken, 
        telegramChatId: users.telegramChatId,
        telegramLiquidityAlertsEnabled: users.telegramLiquidityAlertsEnabled
      })
      .from(users)
      .limit(1);

    if (!user || user.length === 0) return false;
    const settings = user[0];
    if (!settings.telegramLiquidityAlertsEnabled) {
      console.log("[telegram] Broadcast of liquidity alert skipped (disabled in user settings)");
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
