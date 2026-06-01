import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { signals, marketData } from "@db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { EventEmitter } from "events";
import { observable } from "@trpc/server/observable";
import {
  analyzeConfluence,
  aggregateOrderBookMetrics,
  aggregateTradeTape,
} from "../services/confluence";
import { fetchOrderBook, fetchRecentTrades, fetchKlines, SUPPORTED_PAIRS } from "../services/binance";
import { subscribeToSymbol } from "../services/streaming";
import { marketStateManager } from "../services/market-state";
import { STRATEGY_CONFIGS, type StrategyType } from "../services/strategy-config";
import {
  evaluateGridStrategy,
  evaluateMomentumReversal,
  evaluateBBReversion,
  evaluateMLSizing,
  evaluateScalpingMicro
} from "../services/strategies";

// ─── Signal update event bus ───
export const signalEvents = new EventEmitter();
signalEvents.setMaxListeners(50);

// ─── Input helper: checks cache / local DB, falls back to REST ───
async function getConfluenceInput(binanceSymbol: string) {
  const state = marketStateManager.get(binanceSymbol);

  // 1. Order Book Metrics
  let obMetrics;
  if (state && state.orderBook) {
    obMetrics = {
      spread: state.metrics.spread,
      spreadPercent: state.metrics.spreadPercent,
      bidDepth: state.metrics.bidDepth,
      askDepth: state.metrics.askDepth,
      imbalance: state.metrics.imbalance,
      midPrice: state.metrics.midPrice,
    };
  } else {
    const orderBook = await fetchOrderBook(binanceSymbol, 50);
    obMetrics = aggregateOrderBookMetrics(orderBook.bids, orderBook.asks);
  }

  // 2. Trade Tape Metrics
  let tapeMetrics;
  if (state && state.tradeWindow.size() > 0) {
    const trades = state.tradeWindow.values();
    tapeMetrics = aggregateTradeTape(
      trades.map((t) => ({
        price: String(t.price),
        qty: String(t.quantity),
        isBuyerMaker: t.side === "SELL",
      }))
    );
  } else {
    const recentTrades = await fetchRecentTrades(binanceSymbol, 50);
    tapeMetrics = aggregateTradeTape(
      recentTrades.map((t) => ({
        price: t.price,
        qty: t.qty,
        isBuyerMaker: t.isBuyerMaker,
      }))
    );
  }

  // 3. Kline prices and volumes
  const db = getDb();
  const dbKlines = await db
    .select()
    .from(marketData)
    .where(
      and(
        eq(marketData.symbol, binanceSymbol),
        eq(marketData.timeframe, "1m")
      )
    )
    .orderBy(desc(marketData.timestamp))
    .limit(150)
    .catch(() => []);

  let prices: number[];
  let volumes: number[];
  let highs: number[];
  let lows: number[];

  if (dbKlines.length >= 50) {
    const sorted = [...dbKlines].reverse();
    prices = sorted.map((k) => parseFloat(k.close));
    volumes = sorted.map((k) => parseFloat(k.volume));
    highs = sorted.map((k) => parseFloat(k.high));
    lows = sorted.map((k) => parseFloat(k.low));
  } else {
    const klines = await fetchKlines(binanceSymbol, "1m", 150);
    prices = klines.map((k) => parseFloat(k.close));
    volumes = klines.map((k) => parseFloat(k.volume));
    highs = klines.map((k) => parseFloat(k.high));
    lows = klines.map((k) => parseFloat(k.low));
  }

  // 4. Extra Metrics (from in-memory state manager)
  const extraMetrics = state ? {
    sweepScore: state.metrics.sweepScore,
    absorptionScore: state.metrics.absorptionScore,
    volatilityRegime: state.metrics.volatilityRegime,
    bidAskImbalance: state.metrics.bidAskImbalance,
    liquidityRemoved: state.metrics.liquidityRemoved,
    liquidityAdded: state.metrics.liquidityAdded,
  } : undefined;

  return { obMetrics, tapeMetrics, prices, volumes, highs, lows, extraMetrics };
}

// ─── Auto-analysis loop ───
let autoAnalysisTimer: ReturnType<typeof setTimeout> | null = null;
let activeStrategyType: StrategyType = "intraday";

async function runAutoAnalysis() {
  const config = STRATEGY_CONFIGS[activeStrategyType];
  try {
    const db = getDb();
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const { obMetrics, tapeMetrics, prices, volumes, highs, lows, extraMetrics } = await getConfluenceInput(pair.binance);
        
        let signalData;
        const currentPrice = prices[prices.length - 1] || 0;

        if (activeStrategyType === "grid") {
          const res = evaluateGridStrategy(currentPrice, prices, config.threshold);
          signalData = {
            symbol: pair.coindcx,
            microScore: String(res.score),
            intraScore: "50.00",
            swingScore: "50.00",
            compositeScore: String(res.score),
            threshold: String(config.threshold),
            isGated: res.isGated,
            direction: res.direction,
            metadata: res.metadata,
          };
        } else if (activeStrategyType === "momentum_reversal") {
          const res = evaluateMomentumReversal(currentPrice, prices, config.threshold);
          signalData = {
            symbol: pair.coindcx,
            microScore: "50.00",
            intraScore: String(res.score),
            swingScore: "50.00",
            compositeScore: String(res.score),
            threshold: String(config.threshold),
            isGated: res.isGated,
            direction: res.direction,
            metadata: res.metadata,
          };
        } else if (activeStrategyType === "bb_reversion") {
          const res = evaluateBBReversion(currentPrice, prices, config.threshold);
          signalData = {
            symbol: pair.coindcx,
            microScore: "50.00",
            intraScore: String(res.score),
            swingScore: "50.00",
            compositeScore: String(res.score),
            threshold: String(config.threshold),
            isGated: res.isGated,
            direction: res.direction,
            metadata: res.metadata,
          };
        } else if (activeStrategyType === "ml_sizing") {
          const res = evaluateMLSizing(currentPrice, prices, highs, lows, config.threshold);
          signalData = {
            symbol: pair.coindcx,
            microScore: "50.00",
            intraScore: "50.00",
            swingScore: String(res.score),
            compositeScore: String(res.score),
            threshold: String(config.threshold),
            isGated: res.isGated,
            direction: res.direction,
            metadata: res.metadata,
          };
        } else if (activeStrategyType === "scalping_micro") {
          const res = evaluateScalpingMicro(currentPrice, obMetrics, tapeMetrics, config.threshold);
          signalData = {
            symbol: pair.coindcx,
            microScore: String(res.score),
            intraScore: "50.00",
            swingScore: "50.00",
            compositeScore: String(res.score),
            threshold: String(config.threshold),
            isGated: res.isGated,
            direction: res.direction,
            metadata: res.metadata,
          };
        } else {
          // Standard Confluence
          const analysis = analyzeConfluence(
            pair.coindcx,
            obMetrics,
            tapeMetrics,
            prices,
            volumes,
            extraMetrics,
            config.weights,
            config.threshold
          );
          signalData = {
            symbol: pair.coindcx,
            microScore: String(analysis.microScore),
            intraScore: String(analysis.intraScore),
            swingScore: String(analysis.swingScore),
            compositeScore: String(analysis.compositeScore),
            threshold: String(analysis.threshold),
            isGated: analysis.isGated,
            direction: analysis.direction,
            metadata: analysis.indicators,
          };
        }

        await db.insert(signals).values(signalData).catch(() => {});
      } catch (err) {
        console.error(`[signal-router] Auto-analysis failed for ${pair.binance}:`, err);
      }
    }
    signalEvents.emit("update");
  } catch (err) {
    console.error("[signal-router] Auto-analysis loop error:", err);
  }
  autoAnalysisTimer = setTimeout(runAutoAnalysis, config.signalIntervalMs);
}

export function startAutoAnalysis(strategyType: StrategyType = "intraday") {
  if (autoAnalysisTimer) {
    if (activeStrategyType === strategyType) return; // already running same strategy
    clearTimeout(autoAnalysisTimer);
    autoAnalysisTimer = null;
  }

  activeStrategyType = strategyType;

  // Keep WebSocket connections active for all supported symbols from startup
  for (const pair of SUPPORTED_PAIRS) {
    console.log(`[signal-router] Bootstrapping WebSocket subscription for ${pair.binance}`);
    subscribeToSymbol(pair.binance);
  }

  console.log(`[signal-router] Starting auto-analysis with strategy: ${strategyType} (interval: ${STRATEGY_CONFIGS[strategyType].signalIntervalMs}ms)`);
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
        const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(input.symbol);

        // Run confluence analysis
        const coindcxSymbol = `B-${input.symbol.replace("USDT", "_USDT")}`;
        const analysis = analyzeConfluence(coindcxSymbol, obMetrics, tapeMetrics, prices, volumes, extraMetrics);

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
        const { obMetrics, tapeMetrics, prices, volumes, extraMetrics } = await getConfluenceInput(pair.binance);
        const analysis = analyzeConfluence(pair.coindcx, obMetrics, tapeMetrics, prices, volumes, extraMetrics);

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
