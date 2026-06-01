import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, testTelegramConnection } from "../services/telegram";

export const telegramRouter = createRouter({
  // ─── Get Telegram Settings ───
  getSettings: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const user = await db
      .select({
        telegramBotToken: users.telegramBotToken,
        telegramChatId: users.telegramChatId,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    return user[0] || { telegramBotToken: null, telegramChatId: null };
  }),

  // ─── Save Telegram Settings ───
  saveSettings: authedQuery
    .input(
      z.object({
        telegramBotToken: z.string().nullable(),
        telegramChatId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(users)
        .set({
          telegramBotToken: input.telegramBotToken,
          telegramChatId: input.telegramChatId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  // ─── Test Settings ───
  testSettings: authedQuery
    .input(
      z.object({
        telegramBotToken: z.string(),
        telegramChatId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const success = await testTelegramConnection(input.telegramBotToken, input.telegramChatId);
      return { success };
    }),

  // ─── Send Alert ───
  sendAlert: authedQuery
    .input(
      z.object({
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db
        .select({
          telegramBotToken: users.telegramBotToken,
          telegramChatId: users.telegramChatId,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const settings = user[0];
      if (!settings || !settings.telegramBotToken || !settings.telegramChatId) {
        return { success: false, reason: "Telegram not configured" };
      }

      const success = await sendTelegramMessage({
        botToken: settings.telegramBotToken,
        chatId: settings.telegramChatId,
        text: input.message,
      });

      return { success };
    }),
});
