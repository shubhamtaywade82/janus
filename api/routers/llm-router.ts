import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { llmApiKeys, systemLogs } from "@db/schema";
import { eq, desc, asc, and } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { globalLlmAdvisor } from "../services/llm-advisor";
import { EventEmitter } from "events";

// Local event bus for LLM decisions (fed by auto-executor)
export const llmDecisionEvents = new EventEmitter();
llmDecisionEvents.setMaxListeners(20);

export const llmRouter = createRouter({
  // ─── List all keys for a user ───
  listKeys: authedQuery
    .query(async ({ ctx }) => {
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
        .where(eq(llmApiKeys.userId, ctx.user.id))
        .orderBy(asc(llmApiKeys.priority));
    }),

  // ─── Add a new key ───
  addKey: authedQuery
    .input(
      z.object({
        label: z.string().min(1).max(100),
        provider: z.enum(["ollama", "openai", "anthropic"]).default("ollama"),
        endpoint: z.string().url(),
        apiKey: z.string().default(""),
        model: z.string().default("llama3"),
        priority: z.number().min(1).max(100).default(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const result = await db
        .insert(llmApiKeys)
        .values({ userId: ctx.user.id, ...input })
        .returning({ id: llmApiKeys.id });
      return { id: result[0].id };
    }),

  // ─── Delete a key ───
  deleteKey: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(llmApiKeys).where(
        and(
          eq(llmApiKeys.id, input.id),
          eq(llmApiKeys.userId, ctx.user.id)
        )
      );
      return { success: true };
    }),

  // ─── Toggle active ───
  toggleKey: authedQuery
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db
        .update(llmApiKeys)
        .set({ isActive: input.isActive })
        .where(
          and(
            eq(llmApiKeys.id, input.id),
            eq(llmApiKeys.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),

  // ─── Test a key — sends a trivial prompt ───
  testKey: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let key = globalLlmAdvisor.getKeyById(input.id);

      if (!key) {
        const db = getDb();
        const rows = await db
          .select()
          .from(llmApiKeys)
          .where(
            and(
              eq(llmApiKeys.id, input.id),
              eq(llmApiKeys.userId, ctx.user.id)
            )
          )
          .limit(1);

        if (rows[0]) {
          key = {
            id: rows[0].id,
            label: rows[0].label,
            provider: rows[0].provider,
            endpoint: rows[0].endpoint,
            apiKey: rows[0].apiKey ?? "",
            model: rows[0].model,
            priority: rows[0].priority,
          };
        }
      }

      if (!key) return { success: false, error: "Key not found" };

      const t0 = Date.now();
      try {
        const result = await globalLlmAdvisor.testSpecificKey(key);
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
  keyStatus: authedQuery.query(() => globalLlmAdvisor.getKeyStatus()),

  // ─── Activity log — last N LLM decisions from system_logs ───
  activityLog: authedQuery
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
  decisionStream: authedQuery.subscription(() => {
    return observable((emit) => {
      const onDecision = (d: unknown) => emit.next(d);
      llmDecisionEvents.on("decision", onDecision);
      return () => llmDecisionEvents.off("decision", onDecision);
    });
  }),
});
