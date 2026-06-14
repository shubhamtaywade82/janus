import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { signals } from "@db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { comprehensiveAnalysis } from "../services/market-analysis";
import { signalEvents, evictKnnSnapshot, startAutoAnalysis, getConfluenceInput } from "../services/signal-engine";
import { analyzeConfluence } from "../services/confluence";
import { SUPPORTED_PAIRS } from "../services/binance";
import { latestRegimeCache } from "../services/regime-detector";
import { type KnnSupertrendSnapshot } from "../services/knn-supertrend";
import { getKronosSignal, kronosEvents } from "../services/kronos-client";

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

  // ─── On-demand confluence analysis (single symbol) ───
  analyze: authedQuery
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      const binanceSymbol = input.symbol.toUpperCase();
      const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(binanceSymbol);
      const analysis = analyzeConfluence(binanceSymbol, obMetrics, tapeMetrics, prices, volumes, extraMetrics);
      await getDb().insert(signals).values({
        symbol: binanceSymbol,
        microScore: String(analysis.microScore),
        intraScore: String(analysis.intraScore),
        swingScore: String(analysis.swingScore),
        compositeScore: String(analysis.compositeScore),
        threshold: String(analysis.threshold),
        isGated: analysis.isGated,
        direction: analysis.direction,
        metadata: analysis.indicators,
      }).catch(() => {});
      return analysis;
    }),

  // ─── On-demand confluence analysis (all tracked pairs) ───
  analyzeAll: authedQuery.query(async () => {
    const results = [];
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(pair.binance);
        const analysis = analyzeConfluence(pair.coindcx, obMetrics, tapeMetrics, prices, volumes, extraMetrics);
        await getDb().insert(signals).values({
          symbol: pair.coindcx,
          microScore: String(analysis.microScore),
          intraScore: String(analysis.intraScore),
          swingScore: String(analysis.swingScore),
          compositeScore: String(analysis.compositeScore),
          threshold: String(analysis.threshold),
          isGated: analysis.isGated,
          direction: analysis.direction,
          metadata: analysis.indicators,
        }).catch(() => {});
        results.push(analysis);
      } catch {
        // Skip failed pairs
      }
    }
    return results;
  }),

  // ─── Aggregate signal statistics ───
  stats: authedQuery.query(async () => {
    const db = getDb();
    const allSignals = await db.select().from(signals).orderBy(desc(signals.createdAt)).limit(500);
    const total = allSignals.length;
    const gated = allSignals.filter((s) => s.isGated).length;
    const longSignals = allSignals.filter((s) => s.direction === "long").length;
    const shortSignals = allSignals.filter((s) => s.direction === "short").length;
    const avgComposite = total > 0 ? allSignals.reduce((sum, s) => sum + parseFloat(s.compositeScore), 0) / total : 0;
    return {
      total,
      gated,
      gatedPercent: total > 0 ? (gated / total) * 100 : 0,
      longSignals,
      shortSignals,
      avgComposite: avgComposite.toFixed(2),
      bySymbol: SUPPORTED_PAIRS.map((p) => ({
        symbol: p.coindcx,
        signals: allSignals.filter((s) => s.symbol === p.coindcx).length,
        lastSignal: allSignals.find((s) => s.symbol === p.coindcx),
      })),
    };
  }),

  // ─── Signal update stream ───
  stream: authedQuery.subscription(() => {
    return observable<{ updatedAt: number }>((emit) => {
      const onUpdate = () => emit.next({ updatedAt: Date.now() });
      signalEvents.on("update", onUpdate);
      return () => signalEvents.off("update", onUpdate);
    });
  }),

  // ─── Regime status (per-symbol detected regime + strategy) ───
  regimeStatus: authedQuery
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(({ input }) => {
      if (input?.symbol) {
        const r = latestRegimeCache.get(input.symbol);
        return {
          symbol: input.symbol,
          regime: r?.regime ?? "intraday_trend",
          strategy: r?.strategy ?? "intraday",
          reason: r?.reason ?? "no data yet",
          inputs: r?.inputs,
          timestamp: r?.timestamp ?? null,
        };
      }
      const all: Record<string, unknown> = {};
      for (const pair of SUPPORTED_PAIRS) {
        const r = latestRegimeCache.get(pair.binance);
        all[pair.binance] = {
          regime: r?.regime ?? "unknown",
          strategy: r?.strategy ?? "intraday",
          reason: r?.reason ?? "",
          timestamp: r?.timestamp ?? null,
        };
      }
      return { symbols: all };
    }),

  // ─── Regime switch stream ───
  regimeStream: authedQuery.subscription(() => {
    return observable((emit) => {
      const onSwitch = (data: unknown) => emit.next(data);
      signalEvents.on("strategy-switch", onSwitch);
      return () => signalEvents.off("strategy-switch", onSwitch);
    });
  }),

  // ─── KNN supertrend snapshot stream ───
  knnStream: authedQuery.subscription(() => {
    return observable<{ symbol: string; snapshot: KnnSupertrendSnapshot }>((emit) => {
      const onSnapshot = (data: { symbol: string; snapshot: KnnSupertrendSnapshot }) => emit.next(data);
      signalEvents.on("knn-snapshot", onSnapshot);
      return () => signalEvents.off("knn-snapshot", onSnapshot);
    });
  }),

  // ─── Kronos Latest Predictions ───
  kronosLatest: authedQuery
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      return getKronosSignal(input.symbol, "1m", 4);
    }),

  // ─── Kronos Real-time stream ───
  kronosStream: authedQuery.subscription(() => {
    return observable<{ symbol: string; prediction: any }>((emit) => {
      const onPrediction = (data: { symbol: string; prediction: any }) => emit.next(data);
      kronosEvents.on("prediction", onPrediction);
      return () => kronosEvents.off("prediction", onPrediction);
    });
  }),
});
