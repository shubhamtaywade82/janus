import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { userAlertRules, userAlertLogs, systemAlertLogs } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { alertEngineEvents } from "../services/alert-engine";

const alertTypeEnum = z.enum([
  "price", "sweep", "absorption", "imbalance", "volatility",
]);

const operatorEnum = z.enum([">", "<"]);

export const alertsRouter = createRouter({
  // ─── User Alert Rules ───────────────────────────────────────────────────

  getRules: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(userAlertRules)
      .where(eq(userAlertRules.userId, ctx.user.id))
      .orderBy(desc(userAlertRules.createdAt));
  }),

  createRule: authedQuery
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        type: alertTypeEnum,
        operator: operatorEnum.optional(),
        value: z.number().optional(),
        cooldownSeconds: z.number().int().min(10).max(86400).default(60),
        notifyTelegram: z.boolean().default(true),
        notifyWebhook: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [rule] = await db
        .insert(userAlertRules)
        .values({
          userId: ctx.user.id,
          symbol: input.symbol.toUpperCase(),
          type: input.type,
          operator: input.operator ?? null,
          value: input.value?.toString() ?? null,
          cooldownSeconds: input.cooldownSeconds,
          notifyTelegram: input.notifyTelegram,
          notifyWebhook: input.notifyWebhook ?? null,
        })
        .returning();
      return rule;
    }),

  updateRule: authedQuery
    .input(
      z.object({
        id: z.number().int(),
        isActive: z.boolean().optional(),
        cooldownSeconds: z.number().int().min(10).max(86400).optional(),
        notifyTelegram: z.boolean().optional(),
        notifyWebhook: z.string().url().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...fields } = input;
      const patch: Record<string, unknown> = {};
      if (fields.isActive !== undefined) patch.isActive = fields.isActive;
      if (fields.cooldownSeconds !== undefined) patch.cooldownSeconds = fields.cooldownSeconds;
      if (fields.notifyTelegram !== undefined) patch.notifyTelegram = fields.notifyTelegram;
      if (fields.notifyWebhook !== undefined) patch.notifyWebhook = fields.notifyWebhook;
      await db
        .update(userAlertRules)
        .set(patch)
        .where(and(eq(userAlertRules.id, id), eq(userAlertRules.userId, ctx.user.id)));
      return { success: true };
    }),

  deleteRule: authedQuery
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(userAlertRules)
        .where(and(eq(userAlertRules.id, input.id), eq(userAlertRules.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── User Alert Logs ────────────────────────────────────────────────────

  getLogs: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      return db
        .select()
        .from(userAlertLogs)
        .where(eq(userAlertLogs.userId, ctx.user.id))
        .orderBy(desc(userAlertLogs.triggeredAt))
        .limit(input?.limit ?? 50);
    }),

  // ─── System Alert Logs ──────────────────────────────────────────────────

  getSystemAlerts: authedQuery
    .input(
      z
        .object({
          symbol: z.string().optional(),
          type: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 50;

      if (input?.symbol && input?.type) {
        return db
          .select()
          .from(systemAlertLogs)
          .where(
            and(
              eq(systemAlertLogs.symbol, input.symbol.toUpperCase()),
              eq(systemAlertLogs.type, input.type)
            )
          )
          .orderBy(desc(systemAlertLogs.triggeredAt))
          .limit(limit);
      }

      if (input?.symbol) {
        return db
          .select()
          .from(systemAlertLogs)
          .where(eq(systemAlertLogs.symbol, input.symbol.toUpperCase()))
          .orderBy(desc(systemAlertLogs.triggeredAt))
          .limit(limit);
      }

      return db
        .select()
        .from(systemAlertLogs)
        .orderBy(desc(systemAlertLogs.triggeredAt))
        .limit(limit);
    }),

  // ─── Real-time WebSocket Subscriptions ─────────────────────────────────

  systemAlertStream: authedQuery.subscription(() => {
    return observable<{
      symbol: string;
      type: string;
      direction: string | null;
      interval: string | null;
      message: string;
      metadata: Record<string, unknown>;
      timestamp: number;
    }>((emit) => {
      const onAlert = (event: unknown) => emit.next(event as any);
      alertEngineEvents.on("system-alert", onAlert);
      return () => alertEngineEvents.off("system-alert", onAlert);
    });
  }),

  userAlertStream: authedQuery.subscription(({ ctx }) => {
    return observable<{
      userId: number;
      ruleId: number;
      symbol: string;
      type: string;
      message: string;
      timestamp: number;
    }>((emit) => {
      const onAlert = (event: any) => {
        if (event.userId === ctx.user.id) emit.next(event);
      };
      alertEngineEvents.on("user-alert", onAlert);
      return () => alertEngineEvents.off("user-alert", onAlert);
    });
  }),
});
