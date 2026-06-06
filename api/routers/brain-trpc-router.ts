import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { brainEpisodes, brainReflections, brainStrategies, autoExecutorConfig } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { brainEvents } from "../brain/brain-orchestrator";
import { globalAutoExecutor } from "../services/auto-executor";

// tRPC surface for the AI Brain — mirrors the existing Hono /api/brain/* reads but
// uses the same useQuery/useSubscription pattern as every other panel. The Hono
// routes remain for backward compat.
export const brainTrpcRouter = createRouter({
  episodes: authedQuery
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(brainEpisodes)
        .orderBy(desc(brainEpisodes.createdAt))
        .limit(input.limit)
        .catch(() => []);
    }),

  reflections: authedQuery
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(brainReflections)
        .orderBy(desc(brainReflections.appliedAt))
        .limit(input.limit)
        .catch(() => []);
    }),

  strategies: authedQuery.query(async () => {
    const db = getDb();
    return db.select().from(brainStrategies).catch(() => []);
  }),

  // Live brain reasoning/decisions (driver + gate)
  decisionStream: authedQuery.subscription(() =>
    observable<any>((emit) => {
      const onDecision = (d: any) => emit.next(d);
      brainEvents.on("decision", onDecision);
      return () => brainEvents.off("decision", onDecision);
    })
  ),

  // ─── Brain participation toggles (single source of truth: auto_executor_config) ───
  getBrainMode: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select({
        brainDriverEnabled: autoExecutorConfig.brainDriverEnabled,
        brainGateEnabled: autoExecutorConfig.brainGateEnabled,
        brainShadowMode: autoExecutorConfig.brainShadowMode,
      })
      .from(autoExecutorConfig)
      .where(eq(autoExecutorConfig.userId, ctx.user.id))
      .limit(1);
    return rows[0] ?? { brainDriverEnabled: false, brainGateEnabled: false, brainShadowMode: true };
  }),

  setBrainMode: authedQuery
    .input(
      z.object({
        brainDriverEnabled: z.boolean().optional(),
        brainGateEnabled: z.boolean().optional(),
        brainShadowMode: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = await db
        .select({ id: autoExecutorConfig.id })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(autoExecutorConfig)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(autoExecutorConfig.userId, ctx.user.id));
      } else {
        await db.insert(autoExecutorConfig).values({ userId: ctx.user.id, ...input });
      }
      globalAutoExecutor.invalidateConfigCache();
      return { success: true, ...input };
    }),
});

export type BrainTrpcRouter = typeof brainTrpcRouter;
