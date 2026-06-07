import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { signals } from "@db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { comprehensiveAnalysis } from "../services/market-analysis";
import { signalEvents, evictKnnSnapshot, startAutoAnalysis } from "../services/signal-engine";

export { evictKnnSnapshot, startAutoAnalysis };

export const signalRouter = createRouter({
  latest: authedQuery
    .input(z.object({ symbol: z.string().optional(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const db = getDb();
      if (input.symbol) {
        return db.select().from(signals).where(eq(signals.symbol, input.symbol)).orderBy(desc(signals.createdAt)).limit(1);
      }
      const result = await db.execute(sql`SELECT DISTINCT ON (symbol) * FROM signals ORDER BY symbol, created_at DESC`);
      return Array.from(result as any[]).map((r) => ({
        id: r.id, symbol: r.symbol, microScore: r.micro_score, intraScore: r.intra_score, swingScore: r.swing_score,
        compositeScore: r.composite_score, threshold: r.threshold, isGated: r.is_gated, direction: r.direction,
        metadata: r.metadata, createdAt: r.created_at,
      }));
    }),

  gated: authedQuery
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      return getDb().select().from(signals).where(eq(signals.isGated, true)).orderBy(desc(signals.createdAt)).limit(input.limit);
    }),

  comprehensiveAnalysis: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      return comprehensiveAnalysis(input.symbol);
    }),

  onUpdate: authedQuery.subscription(() => {
    return observable((emit) => {
      const onUpdate = () => emit.next({ timestamp: Date.now() });
      signalEvents.on("update", onUpdate);
      return () => signalEvents.off("update", onUpdate);
    });
  }),
});
