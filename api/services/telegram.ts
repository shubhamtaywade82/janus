/**
 * Telegram Service
 * Handles sending alerts and system notifications to Telegram channels/chats.
 */

export interface SendTelegramMessageOptions {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

/**
 * Sends a text message to a specific Telegram chat/channel using a Telegram Bot.
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

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram Bot API Error (status ${response.status}):`, errorText);
      return false;
    }

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
