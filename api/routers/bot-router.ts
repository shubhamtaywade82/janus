/**
 * Bot Router — tRPC control plane for the automated trading bot
 */

import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { STRATEGY_CONFIGS, type StrategyType } from "../services/strategy-config";
import { latestRegimeCache } from "../services/regime-detector";
import { startAutoAnalysis } from "./signal-router";
import { getDb } from "../queries/connection";
import { autoExecutorConfig, executorDecisions } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { globalAutoExecutor, autoExecutorEvents } from "../services/auto-executor";
import { env } from "../lib/env";

const strategyTypeSchema = z.enum([
  "intraday", "swing", "grid",
  "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro", "h6_momentum",
  "alpha_protocol",
]);

export const botRouter = createRouter({
  // ─── Current bot status ───
  status: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, ctx.user.id))
      .limit(1);
    const config = rows[0] ?? null;

    const recentDecisions = await db
      .select()
      .from(executorDecisions)
      .where(eq(executorDecisions.userId, ctx.user.id))
      .orderBy(desc(executorDecisions.createdAt))
      .limit(10)
      .catch(() => []);

    return {
      enabled: config?.enabled ?? false,
      placeOrders: env.placeOrders,
      useLLMFilter: config?.useLlmAdvisor ?? true,
      brainDriverEnabled: config?.brainDriverEnabled ?? false,
      brainGateEnabled: config?.brainGateEnabled ?? false,
      brainShadowMode: config?.brainShadowMode ?? true,
      stats: {
        signalsReceived: globalAutoExecutor.state.signalsProcessed,
        tradesExecuted: globalAutoExecutor.state.executionsToday,
        tradesRejectedByRisk: 0,
        tradesRejectedByLLM: globalAutoExecutor.state.skipsToday,
        startedAt: 0,
      },
      recentDecisions,
      ollamaPool: [],
    };
  }),

  // ─── Start auto-executor ───
  start: adminQuery
    .input(z.object({ useLLM: z.boolean().optional().default(true) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select({ id: autoExecutorConfig.id })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, 1))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(autoExecutorConfig)
          .set({ enabled: true, useLlmAdvisor: input.useLLM, updatedAt: new Date() })
          .where(eq(autoExecutorConfig.userId, 1));
      } else {
        await db
          .insert(autoExecutorConfig)
          .values({ userId: 1, enabled: true, useLlmAdvisor: input.useLLM });
      }
      globalAutoExecutor.invalidateConfigCache();
      return { ok: true, message: "Auto-executor started" };
    }),

  // ─── Stop auto-executor ───
  stop: adminQuery.mutation(async () => {
    const db = getDb();
    const existing = await db
      .select({ id: autoExecutorConfig.id })
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, 1))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(autoExecutorConfig)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(autoExecutorConfig.userId, 1));
    } else {
      await db
        .insert(autoExecutorConfig)
        .values({ userId: 1, enabled: false });
    }
    globalAutoExecutor.invalidateConfigCache();
    return { ok: true, message: "Auto-executor stopped" };
  }),

  // ─── Override strategy (pins to fixed strategy, disables regime auto-switch) ───
  setStrategy: adminQuery
    .input(z.object({ strategy: strategyTypeSchema }))
    .mutation(({ input }) => {
      startAutoAnalysis(input.strategy as StrategyType, false); // false = don't auto-switch
      return {
        ok: true,
        strategy: input.strategy,
        config: STRATEGY_CONFIGS[input.strategy as StrategyType],
      };
    }),

  // ─── Re-enable automatic regime detection → strategy switching ───
  enableAutoRegime: adminQuery.mutation(() => {
    startAutoAnalysis(undefined, true); // true = auto-switch enabled
    return { ok: true, message: "Regime-based strategy auto-switching enabled" };
  }),

  // ─── Toggle LLM filter ───
  setLLMFilter: adminQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select({ id: autoExecutorConfig.id })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, 1))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(autoExecutorConfig)
          .set({ useLlmAdvisor: input.enabled, updatedAt: new Date() })
          .where(eq(autoExecutorConfig.userId, 1));
      } else {
        await db
          .insert(autoExecutorConfig)
          .values({ userId: 1, useLlmAdvisor: input.enabled });
      }
      globalAutoExecutor.invalidateConfigCache();
      return { ok: true, llmFilter: input.enabled };
    }),

  // ─── Latest regime per tracked symbol ───
  regime: authedQuery.query(() => {
    const entries: Record<string, any> = {};
    latestRegimeCache.forEach((v, k) => { entries[k] = v; });
    return entries;
  }),

  // ─── Recent decision history (persisted — survives restart) ───
  decisions: authedQuery
    .input(z.object({ limit: z.number().min(1).max(200).default(50), symbol: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const where = input.symbol
        ? sql`${executorDecisions.userId} = ${ctx.user.id} and ${executorDecisions.symbol} = ${input.symbol}`
        : eq(executorDecisions.userId, ctx.user.id);
      return db
        .select()
        .from(executorDecisions)
        .where(where)
        .orderBy(desc(executorDecisions.createdAt))
        .limit(input.limit)
        .catch(() => []);
    }),

  // ─── Gate-level decision breakdown ("why is the bot not trading?") ───
  decisionStats: authedQuery
    .input(z.object({ windowMinutes: z.number().min(1).max(1440).default(60) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const since = new Date(Date.now() - input.windowMinutes * 60_000);
      const rows = await db
        .select({
          gate: executorDecisions.gate,
          action: executorDecisions.action,
          count: sql<number>`count(*)::int`,
        })
        .from(executorDecisions)
        .where(sql`${executorDecisions.userId} = ${ctx.user.id} and ${executorDecisions.createdAt} >= ${since}`)
        .groupBy(executorDecisions.gate, executorDecisions.action)
        .catch(() => []);
      const executed = rows.filter((r) => r.action === "execute").reduce((s, r) => s + r.count, 0);
      const skipped = rows.filter((r) => r.action === "skip").reduce((s, r) => s + r.count, 0);
      return { windowMinutes: input.windowMinutes, executed, skipped, byGate: rows };
    }),

  // ─── Real-time decision stream (WebSocket subscription) ───
  decisionStream: authedQuery.subscription(() => {
    return observable<any>((emit) => {
      const onDecision = (d: any) => emit.next(d);
      autoExecutorEvents.on("decision", onDecision);
      return () => autoExecutorEvents.off("decision", onDecision);
    });
  }),
});

export type BotRouter = typeof botRouter;
