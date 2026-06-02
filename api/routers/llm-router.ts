import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { llmApiKeys, systemLogs } from "@db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { globalLlmAdvisor } from "../services/llm-advisor";
import { EventEmitter } from "events";

// Local event bus for LLM decisions (fed by auto-executor)
export const llmDecisionEvents = new EventEmitter();
llmDecisionEvents.setMaxListeners(20);

export const llmRouter = createRouter({
  // ─── List all keys for a user ───
  listKeys: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: llmApiKeys.id,
          label: llmApiKeys.label,
          provider: llmApiKeys.provider,
          endpoint: llmApiKeys.endpoint,
          model: llmApiKeys.model,
          priority: llmApiKeys.priority,
          isActive: llmApiKeys.isActive,
          requestCount: llmApiKeys.requestCount,
          errorCount: llmApiKeys.errorCount,
          lastUsedAt: llmApiKeys.lastUsedAt,
        })
        .from(llmApiKeys)
        .where(eq(llmApiKeys.userId, input.userId))
        .orderBy(asc(llmApiKeys.priority));
    }),

  // ─── Add a new key ───
  addKey: publicQuery
    .input(
      z.object({
        userId: z.number(),
        label: z.string().min(1).max(100),
        provider: z.enum(["ollama", "openai", "anthropic"]).default("ollama"),
        endpoint: z.string().url(),
        apiKey: z.string().default(""),
        model: z.string().default("llama3"),
        priority: z.number().min(1).max(100).default(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db
        .insert(llmApiKeys)
        .values({ ...input })
        .returning({ id: llmApiKeys.id });
      return { id: result[0].id };
    }),

  // ─── Delete a key ───
  deleteKey: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(llmApiKeys).where(eq(llmApiKeys.id, input.id));
      return { success: true };
    }),

  // ─── Toggle active ───
  toggleKey: publicQuery
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(llmApiKeys)
        .set({ isActive: input.isActive })
        .where(eq(llmApiKeys.id, input.id));
      return { success: true };
    }),

  // ─── Test a key — sends a trivial prompt ───
  testKey: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(llmApiKeys)
        .where(eq(llmApiKeys.id, input.id))
        .limit(1);

      if (!rows[0]) return { success: false, error: "Key not found" };

      const t0 = Date.now();
      try {
        const testCtx = {
          symbol: "BTCUSDT",
          direction: "long",
          compositeScore: 80,
          threshold: 75,
          regime: "intraday_trend",
          strategy: "intraday",
          currentPrice: 100000,
          drawdownPct: 0,
          tradeCount: 0,
          openPositions: 0,
        };
        const result = await globalLlmAdvisor.analyzeSignal(testCtx);
        return {
          success: true,
          latencyMs: Date.now() - t0,
          decision: result.decision,
          reasoning: result.reasoning,
        };
      } catch (err: any) {
        return { success: false, error: err.message, latencyMs: Date.now() - t0 };
      }
    }),

  // ─── Key health status (in-memory) ───
  keyStatus: publicQuery.query(() => globalLlmAdvisor.getKeyStatus()),

  // ─── Activity log — last N LLM decisions from system_logs ───
  activityLog: publicQuery
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(systemLogs)
        .where(eq(systemLogs.component, "llm-advisor"))
        .orderBy(desc(systemLogs.createdAt))
        .limit(input.limit);
    }),

  // ─── Live stream of LLM decision events ───
  decisionStream: publicQuery.subscription(() => {
    return observable((emit) => {
      const onDecision = (d: unknown) => emit.next(d);
      llmDecisionEvents.on("decision", onDecision);
      return () => llmDecisionEvents.off("decision", onDecision);
    });
  }),
});
