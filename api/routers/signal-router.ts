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
import { fetchKlines, SUPPORTED_PAIRS } from "../services/binance";
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
import {
  detectRegimeForSymbol,
  latestRegimeCache,
} from "../services/regime-detector";
import { globalAutoExecutor } from "../services/auto-executor";

// ─── Signal update event bus ───
export const signalEvents = new EventEmitter();
signalEvents.setMaxListeners(50);

// ─── Input helper: checks cache / local DB, falls back to REST ───
async function getConfluenceInput(binanceSymbol: string) {
  const state = marketStateManager.get(binanceSymbol);

  // 1. Order Book Metrics — WS-only, never REST (prevents IP ban from 8×/tick calls)
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
    // WS not ready yet — neutral metrics; microstructure score will be 50 (no edge)
    obMetrics = { spread: 0, spreadPercent: 0.05, bidDepth: 0, askDepth: 0, imbalance: 0, midPrice: 0 };
  }

  // 2. Trade Tape Metrics — WS-only, never REST
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
    // WS not ready yet — neutral metrics
    tapeMetrics = { buyVolume: 0, sellVolume: 0, delta: 0, makerRatio: 0.5, avgTradeSize: 0, tradeCount: 0 };
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
    try {
      const klines = await fetchKlines(binanceSymbol, "1m", 150);
      prices = klines.map((k) => parseFloat(k.close));
      volumes = klines.map((k) => parseFloat(k.volume));
      highs = klines.map((k) => parseFloat(k.high));
      lows = klines.map((k) => parseFloat(k.low));
    } catch (err: any) {
      console.warn(`[signal-router] Failed to fetch klines for ${binanceSymbol} via REST (fallback to empty):`, err.message || err);
      prices = [];
      volumes = [];
      highs = [];
      lows = [];
    }
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

// ─── Per-symbol strategy + timing state ───
// Each symbol gets its own regime-detected strategy and its own analysis schedule.
const symbolStrategyMap = new Map<string, StrategyType>(); // binanceSymbol → strategy
const symbolLastAnalyzedAt = new Map<string, number>();    // binanceSymbol → last analysis ms

let autoAnalysisTimer: ReturnType<typeof setTimeout> | null = null;
let activeStrategyType: StrategyType = "intraday"; // fallback / manual-pin mode
let autoRegimeDetect = true;
let lastRegimeDetectAt = 0;
const REGIME_DETECT_INTERVAL_MS = 60_000;
const MIN_LOOP_MS = 2_000; // loop ticks every 2s; per-symbol interval gates actual scoring

// ─── Signal evaluator — routes to correct strategy evaluator for a symbol ───
function evaluateSymbolSignal(
  coindcxSymbol: string,
  strategy: StrategyType,
  currentPrice: number,
  prices: number[],
  volumes: number[],
  highs: number[],
  lows: number[],
  obMetrics: ReturnType<typeof aggregateOrderBookMetrics>,
  tapeMetrics: ReturnType<typeof aggregateTradeTape>,
  extraMetrics?: Record<string, unknown>
): typeof signals.$inferInsert {
  const config = STRATEGY_CONFIGS[strategy];

  if (strategy === "grid") {
    const res = evaluateGridStrategy(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: String(res.score), intraScore: "50.00", swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "momentum_reversal") {
    const res = evaluateMomentumReversal(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: String(res.score), swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "bb_reversion") {
    const res = evaluateBBReversion(currentPrice, prices, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: String(res.score), swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "ml_sizing") {
    const res = evaluateMLSizing(currentPrice, prices, highs, lows, config.threshold);
    return { symbol: coindcxSymbol, microScore: "50.00", intraScore: "50.00", swingScore: String(res.score), compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  if (strategy === "scalping_micro") {
    const res = evaluateScalpingMicro(currentPrice, obMetrics, tapeMetrics, config.threshold);
    return { symbol: coindcxSymbol, microScore: String(res.score), intraScore: "50.00", swingScore: "50.00", compositeScore: String(res.score), threshold: String(config.threshold), isGated: res.isGated, direction: res.direction, metadata: { ...res.metadata, strategy } };
  }
  // Confluence-based: scalping / intraday / swing
  const analysis = analyzeConfluence(coindcxSymbol, obMetrics, tapeMetrics, prices, volumes, extraMetrics as any, config.weights, config.threshold);
  return { symbol: coindcxSymbol, microScore: String(analysis.microScore), intraScore: String(analysis.intraScore), swingScore: String(analysis.swingScore), compositeScore: String(analysis.compositeScore), threshold: String(analysis.threshold), isGated: analysis.isGated, direction: analysis.direction, metadata: { ...analysis.indicators, strategy } };
}

async function runAutoAnalysis() {
  const now = Date.now();

  // ─── Per-symbol regime detection — all 8 symbols in parallel, throttled to 60s ───
  if (autoRegimeDetect && now - lastRegimeDetectAt >= REGIME_DETECT_INTERVAL_MS) {
    lastRegimeDetectAt = now;
    const regimeResults = await Promise.allSettled(
      SUPPORTED_PAIRS.map((pair) => detectRegimeForSymbol(pair.binance))
    );

    regimeResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const pair = SUPPORTED_PAIRS[i];
        const prev = symbolStrategyMap.get(pair.binance);
        const next = result.value.strategy;
        latestRegimeCache.set(pair.binance, result.value);
        symbolStrategyMap.set(pair.binance, next);

        if (prev && prev !== next) {
          console.log(`[regime] ${pair.binance}: ${prev} → ${next} (${result.value.regime})`);
          signalEvents.emit("strategy-switch", {
            symbol: pair.binance,
            from: prev,
            to: next,
            regime: result.value.regime,
            reason: result.value.reason,
          });
        } else if (!prev) {
          console.log(`[regime] ${pair.binance}: initial strategy = ${next} (${result.value.regime})`);
        }
      }
    });
  }

  const batchSignals: typeof signals.$inferSelect[] = [];
  try {
    const db = getDb();

    for (const pair of SUPPORTED_PAIRS) {
      // Per-symbol strategy — fall back to activeStrategyType when auto-detect off or not yet detected
      const strategy = autoRegimeDetect
        ? (symbolStrategyMap.get(pair.binance) ?? activeStrategyType)
        : activeStrategyType;

      const config = STRATEGY_CONFIGS[strategy];

      // Skip if this symbol was analyzed too recently for its strategy's interval
      const lastAt = symbolLastAnalyzedAt.get(pair.binance) ?? 0;
      if (now - lastAt < config.signalIntervalMs) continue;
      symbolLastAnalyzedAt.set(pair.binance, now);

      try {
        const { obMetrics, tapeMetrics, prices, volumes, highs, lows, extraMetrics } = await getConfluenceInput(pair.binance);
        const currentPrice = prices[prices.length - 1] || 0;

        const signalData = evaluateSymbolSignal(
          pair.coindcx, strategy, currentPrice,
          prices, volumes, highs, lows,
          obMetrics, tapeMetrics, extraMetrics
        );

        const inserted = await db.insert(signals).values(signalData).returning().catch(() => []);
        if (inserted[0]) batchSignals.push(inserted[0]);
      } catch (err) {
        console.error(`[signal-router] Analysis failed for ${pair.binance}:`, err);
      }
    }

    if (batchSignals.length > 0) {
      signalEvents.emit("update");
      globalAutoExecutor.onSignalBatch(batchSignals).catch((err) =>
        console.error("[auto-executor] Batch error:", err)
      );
    }
  } catch (err) {
    console.error("[signal-router] Loop error:", err);
  }

  // Loop always runs at MIN_LOOP_MS (2s); per-symbol intervals gate actual scoring
  autoAnalysisTimer = setTimeout(runAutoAnalysis, MIN_LOOP_MS);
}

// Bootstrap database with historical klines once on startup to avoid REST rate limits during analysis
async function bootstrapHistoricalKlines() {
  console.log("[signal-router] Bootstrapping historical klines for supported pairs...");
  const db = getDb();
  for (const pair of SUPPORTED_PAIRS) {
    try {
      // Check if we already have enough klines in DB
      const existing = await db
        .select({ id: marketData.id })
        .from(marketData)
        .where(
          and(
            eq(marketData.symbol, pair.binance),
            eq(marketData.timeframe, "1m")
          )
        )
        .limit(50)
        .catch(() => []);

      if (existing.length < 50) {
        console.log(`[signal-router] Fetching historical klines for ${pair.binance} via REST to bootstrap DB...`);
        const klines = await fetchKlines(pair.binance, "1m", 150);
        for (const k of klines) {
          await db.insert(marketData).values({
            symbol: pair.binance,
            timeframe: "1m",
            timestamp: new Date(k.openTime || k.closeTime || Date.now()),
            open: String(k.open),
            high: String(k.high),
            low: String(k.low),
            close: String(k.close),
            volume: String(k.volume),
            quoteVolume: String(k.quoteVolume || "0"),
            tradeCount: k.trades || 0,
          }).onConflictDoUpdate({
            target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
            set: {
              open: String(k.open),
              high: String(k.high),
              low: String(k.low),
              close: String(k.close),
              volume: String(k.volume),
              quoteVolume: String(k.quoteVolume || "0"),
              tradeCount: k.trades || 0,
            }
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn(`[signal-router] Failed to bootstrap klines for ${pair.binance}:`, err.message || err);
    }
    // Sleep a bit to avoid hitting rate limits on startup
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log("[signal-router] Historical klines bootstrapping completed.");
}

export function startAutoAnalysis(strategyType: StrategyType = "intraday", autoSwitch?: boolean) {
  // autoSwitch=true → regime detector drives strategy; autoSwitch=false → pin to strategyType
  if (autoSwitch !== undefined) autoRegimeDetect = autoSwitch;

  if (autoAnalysisTimer) {
    if (activeStrategyType === strategyType && autoSwitch === undefined) return; // no change
    clearTimeout(autoAnalysisTimer);
    autoAnalysisTimer = null;
  }

  activeStrategyType = strategyType;

  // Run bootstrapping in background
  bootstrapHistoricalKlines().catch((err) => {
    console.error("[signal-router] Bootstrapping failed:", err);
  });

  for (const pair of SUPPORTED_PAIRS) {
    subscribeToSymbol(pair.binance);
  }

  const mode = autoRegimeDetect ? "per-symbol-regime" : "fixed";
  console.log(`[signal-router] Starting auto-analysis mode=${mode} fallback=${strategyType} loop=${MIN_LOOP_MS}ms`);
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

  // ─── Current regime + active strategy ───
  // ─── Per-symbol regime status ───
  regimeStatus: publicQuery
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(({ input }) => {
      if (input?.symbol) {
        // Single symbol query (used by Dashboard for the selected symbol)
        const r = latestRegimeCache.get(input.symbol);
        return {
          symbol: input.symbol,
          regime: r?.regime ?? "intraday_trend",
          strategy: symbolStrategyMap.get(input.symbol) ?? activeStrategyType,
          reason: r?.reason ?? "no data yet",
          inputs: r?.inputs,
          timestamp: r?.timestamp ?? null,
        };
      }
      // All symbols (used by bot overview)
      const all: Record<string, unknown> = {};
      for (const pair of SUPPORTED_PAIRS) {
        const r = latestRegimeCache.get(pair.binance);
        all[pair.binance] = {
          regime: r?.regime ?? "unknown",
          strategy: symbolStrategyMap.get(pair.binance) ?? activeStrategyType,
          reason: r?.reason ?? "",
          timestamp: r?.timestamp ?? null,
        };
      }
      return { symbols: all, fallbackStrategy: activeStrategyType, autoRegime: autoRegimeDetect };
    }),

  // ─── Live per-symbol regime switch stream ───
  regimeStream: publicQuery.subscription(() => {
    return observable((emit) => {
      const onSwitch = (data: unknown) => emit.next(data);
      signalEvents.on("strategy-switch", onSwitch);
      return () => signalEvents.off("strategy-switch", onSwitch);
    });
  }),
});
