/**
 * Bot Router — tRPC control plane for the automated trading bot
 */

import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, publicQuery } from "../middleware";
import { STRATEGY_CONFIGS, type StrategyType } from "../services/strategy-config";
import { latestRegimeCache } from "../services/regime-detector";
import { startAutoAnalysis } from "./signal-router";
import { getDb } from "../queries/connection";
import { autoExecutorConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import { globalAutoExecutor, autoExecutorEvents } from "../services/auto-executor";
import { env } from "../lib/env";

const strategyTypeSchema = z.enum([
  "scalping", "intraday", "swing", "grid",
  "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro",
]);

export const botRouter = createRouter({
  // ─── Current bot status ───
  status: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, 1))
      .limit(1);
    const config = rows[0] ?? null;

    return {
      enabled: config?.enabled ?? false,
      placeOrders: env.placeOrders,
      useLLMFilter: config?.useLlmAdvisor ?? true,
      stats: {
        signalsReceived: globalAutoExecutor.state.signalsProcessed,
        tradesExecuted: globalAutoExecutor.state.executionsToday,
        tradesRejectedByRisk: 0,
        tradesRejectedByLLM: globalAutoExecutor.state.skipsToday,
        startedAt: 0,
      },
      recentDecisions: globalAutoExecutor.state.lastDecision ? [globalAutoExecutor.state.lastDecision] : [],
      ollamaPool: [],
    };
  }),

  // ─── Start auto-executor ───
  start: publicQuery
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
      return { ok: true, message: "Auto-executor started" };
    }),

  // ─── Stop auto-executor ───
  stop: publicQuery.mutation(async () => {
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
    return { ok: true, message: "Auto-executor stopped" };
  }),

  // ─── Override strategy (pins to fixed strategy, disables regime auto-switch) ───
  setStrategy: publicQuery
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
  enableAutoRegime: publicQuery.mutation(() => {
    startAutoAnalysis(undefined, true); // true = auto-switch enabled
    return { ok: true, message: "Regime-based strategy auto-switching enabled" };
  }),

  // ─── Toggle LLM filter ───
  setLLMFilter: publicQuery
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
      return { ok: true, llmFilter: input.enabled };
    }),

  // ─── Latest regime per tracked symbol ───
  regime: publicQuery.query(() => {
    const entries: Record<string, any> = {};
    latestRegimeCache.forEach((v, k) => { entries[k] = v; });
    return entries;
  }),

  // ─── Recent decision history ───
  decisions: publicQuery
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(({ input: _input }) => {
      return globalAutoExecutor.state.lastDecision ? [globalAutoExecutor.state.lastDecision] : [];
    }),

  // ─── Real-time decision stream (WebSocket subscription) ───
  decisionStream: publicQuery.subscription(() => {
    return observable<any>((emit) => {
      const onDecision = (d: any) => emit.next(d);
      autoExecutorEvents.on("decision", onDecision);
      return () => autoExecutorEvents.off("decision", onDecision);
    });
  }),
});

export type BotRouter = typeof botRouter;
