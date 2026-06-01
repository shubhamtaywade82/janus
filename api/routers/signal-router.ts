import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { signals } from "@db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { EventEmitter } from "events";
import { observable } from "@trpc/server/observable";
import {
  analyzeConfluence,
  aggregateOrderBookMetrics,
  aggregateTradeTape,
} from "../services/confluence";
import { fetchOrderBook, fetchRecentTrades, fetchKlines, SUPPORTED_PAIRS } from "../services/binance";

// ─── Signal update event bus ───
export const signalEvents = new EventEmitter();
signalEvents.setMaxListeners(50);

// ─── Auto-analysis loop — runs every 30s on the server ───
let autoAnalysisTimer: ReturnType<typeof setTimeout> | null = null;

async function runAutoAnalysis() {
  try {
    const db = getDb();
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const [orderBook, recentTrades, klines] = await Promise.all([
          fetchOrderBook(pair.binance, 50),
          fetchRecentTrades(pair.binance, 50),
          fetchKlines(pair.binance, "1m", 150),
        ]);
        const obMetrics = aggregateOrderBookMetrics(orderBook.bids, orderBook.asks);
        const tapeMetrics = aggregateTradeTape(recentTrades.map((t) => ({ price: t.price, qty: t.qty, isBuyerMaker: t.isBuyerMaker })));
        const prices = klines.map((k) => parseFloat(k.close));
        const volumes = klines.map((k) => parseFloat(k.volume));
        const analysis = analyzeConfluence(pair.coindcx, obMetrics, tapeMetrics, prices, volumes);
        await db.insert(signals).values({
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
      } catch { /* skip failed pairs */ }
    }
    signalEvents.emit("update");
  } catch {}
  autoAnalysisTimer = setTimeout(runAutoAnalysis, 30_000);
}

export function startAutoAnalysis() {
  if (autoAnalysisTimer) return; // already running
  runAutoAnalysis();
}

export const signalRouter = createRouter({
  // ─── Get latest signals — one per symbol ───
  latest: publicQuery
    .input(
      z.object({
        symbol: z.string().optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      if (input.symbol) {
        return db
          .select()
          .from(signals)
          .where(eq(signals.symbol, input.symbol))
          .orderBy(desc(signals.createdAt))
          .limit(1);
      }
      // DISTINCT ON returns one row per symbol — the latest by created_at
      // db.execute returns snake_case columns; map to camelCase to match ORM schema
      const result = await db.execute(sql`
        SELECT DISTINCT ON (symbol) *
        FROM signals
        ORDER BY symbol, created_at DESC
      `);
      return Array.from(result).map((r: any) => ({
        id: r.id,
        symbol: r.symbol,
        microScore: r.micro_score,
        intraScore: r.intra_score,
        swingScore: r.swing_score,
        compositeScore: r.composite_score,
        threshold: r.threshold,
        isGated: r.is_gated,
        direction: r.direction,
        metadata: r.metadata,
        createdAt: r.created_at,
      })) as typeof signals.$inferSelect[];
    }),

  // ─── Get gated signals only ───
  gated: publicQuery
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(signals)
        .where(eq(signals.isGated, true))
        .orderBy(desc(signals.createdAt))
        .limit(input.limit);
    }),

  // ─── Run confluence analysis on live data ───
  analyze: publicQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
      })
    )
    .query(async ({ input }) => {
      try {
        // Fetch all required data in parallel
        const [orderBook, recentTrades, klines] = await Promise.all([
          fetchOrderBook(input.symbol, 50),
          fetchRecentTrades(input.symbol, 50),
          fetchKlines(input.symbol, "1m", 150),
        ]);

        // Aggregate order book metrics
        const obMetrics = aggregateOrderBookMetrics(orderBook.bids, orderBook.asks);

        // Aggregate trade tape metrics
        const tapeMetrics = aggregateTradeTape(
          recentTrades.map((t) => ({
            price: t.price,
            qty: t.qty,
            isBuyerMaker: t.isBuyerMaker,
          }))
        );

        // Extract prices and volumes from klines
        const prices = klines.map((k) => parseFloat(k.close));
        const volumes = klines.map((k) => parseFloat(k.volume));

        // Run confluence analysis
        const coindcxSymbol = `B-${input.symbol.replace("USDT", "_USDT")}`;
        const analysis = analyzeConfluence(coindcxSymbol, obMetrics, tapeMetrics, prices, volumes);

        // Store in database
        const db = getDb();
        await db.insert(signals).values({
          symbol: coindcxSymbol,
          microScore: String(analysis.microScore),
          intraScore: String(analysis.intraScore),
          swingScore: String(analysis.swingScore),
          compositeScore: String(analysis.compositeScore),
          threshold: String(analysis.threshold),
          isGated: analysis.isGated,
          direction: analysis.direction,
          metadata: analysis.indicators,
        });

        return analysis;
      } catch (error: any) {
        return {
          error: error.message,
          symbol: input.symbol,
          microScore: 50,
          intraScore: 50,
          swingScore: 50,
          compositeScore: 50,
          threshold: 75,
          isGated: false,
          direction: "neutral" as const,
          indicators: {
            spread: 0,
            imbalance: 0,
            vwap: 0,
            rsi: 50,
            ema20: 0,
            ema50: 0,
            trendStrength: 0,
          },
          timestamp: Date.now(),
        };
      }
    }),

  // ─── Batch analyze all supported pairs ───
  analyzeAll: publicQuery.query(async () => {
    const results = [];
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const [orderBook, recentTrades, klines] = await Promise.all([
          fetchOrderBook(pair.binance, 50),
          fetchRecentTrades(pair.binance, 50),
          fetchKlines(pair.binance, "1m", 150),
        ]);

        const obMetrics = aggregateOrderBookMetrics(orderBook.bids, orderBook.asks);
        const tapeMetrics = aggregateTradeTape(
          recentTrades.map((t) => ({
            price: t.price,
            qty: t.qty,
            isBuyerMaker: t.isBuyerMaker,
          }))
        );

        const prices = klines.map((k) => parseFloat(k.close));
        const volumes = klines.map((k) => parseFloat(k.volume));

        const analysis = analyzeConfluence(pair.coindcx, obMetrics, tapeMetrics, prices, volumes);

        // Store in DB
        const db = getDb();
        await db.insert(signals).values({
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

  // ─── Get score history for a symbol ───
  history: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        limit: z.number().default(100),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(signals)
        .where(eq(signals.symbol, input.symbol))
        .orderBy(desc(signals.createdAt))
        .limit(input.limit);
    }),

  // ─── Get signal statistics ───
  stats: publicQuery.query(async () => {
    const db = getDb();
    const allSignals = await db.select().from(signals).orderBy(desc(signals.createdAt)).limit(500);
    
    const total = allSignals.length;
    const gated = allSignals.filter((s) => s.isGated).length;
    const longSignals = allSignals.filter((s) => s.direction === "long").length;
    const shortSignals = allSignals.filter((s) => s.direction === "short").length;
    const avgComposite = total > 0
      ? allSignals.reduce((sum, s) => sum + parseFloat(s.compositeScore), 0) / total
      : 0;

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

  // ─── Real-time signal update stream ───
  stream: publicQuery.subscription(() => {
    return observable<{ updatedAt: number }>((emit) => {
      const onUpdate = () => emit.next({ updatedAt: Date.now() });
      signalEvents.on("update", onUpdate);
      return () => signalEvents.off("update", onUpdate);
    });
  }),
});
