/**
 * Bot Router — tRPC control plane for the automated trading bot
 *
 * Endpoints:
 *   bot.status          — current bot state, stats, Ollama pool
 *   bot.start           — enable auto-executor
 *   bot.stop            — disable auto-executor
 *   bot.setStrategy     — override active strategy (disables regime auto-detect)
 *   bot.enableAutoRegime— re-enable automatic regime→strategy switching
 *   bot.setLLMFilter    — toggle LLM advisor on/off
 *   bot.regime          — latest regime per symbol
 *   bot.decisions       — recent bot decision log
 *   bot.decisionStream  — real-time decision events (subscription)
 */

import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, publicQuery } from "../middleware";
import { STRATEGY_CONFIGS, type StrategyType } from "../services/strategy-config";
import { latestRegimeCache } from "../services/regime-detector";
import { startAutoAnalysis } from "./signal-router";
import {
  startAutoExecutor,
  stopAutoExecutor,
  getExecutorStatus,
  setUseLLMFilter,
  executorEvents,
} from "../services/auto-executor";

const strategyTypeSchema = z.enum([
  "scalping", "intraday", "swing", "grid",
  "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro",
]);

export const botRouter = createRouter({
  // ─── Current bot status ───
  status: publicQuery.query(() => {
    return getExecutorStatus();
  }),

  // ─── Start auto-executor ───
  start: publicQuery
    .input(z.object({ useLLM: z.boolean().optional().default(true) }))
    .mutation(({ input }) => {
      startAutoExecutor({ useLLM: input.useLLM });
      return { ok: true, message: "Auto-executor started" };
    }),

  // ─── Stop auto-executor ───
  stop: publicQuery.mutation(() => {
    stopAutoExecutor();
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
    .mutation(({ input }) => {
      setUseLLMFilter(input.enabled);
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
    .query(({ input }) => {
      return getExecutorStatus().recentDecisions.slice(0, input.limit);
    }),

  // ─── Real-time decision stream (WebSocket subscription) ───
  decisionStream: publicQuery.subscription(() => {
    return observable<ReturnType<typeof getExecutorStatus>["recentDecisions"][number]>((emit) => {
      const onDecision = (d: any) => emit.next(d);
      executorEvents.on("decision", onDecision);
      return () => executorEvents.off("decision", onDecision);
    });
  }),
});
