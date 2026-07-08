import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, authedQuery } from "../middleware";
import { MIN_SYSTEM_LEVERAGE, MAX_SYSTEM_LEVERAGE, SUPPORTED_SYMBOLS } from "../../contracts/constants";
import { analyzeAll, klinesFromBinance } from "../services/price-action";
import { subscribeToSymbol, unsubscribeFromSymbol, marketEvents } from "../services/streaming";
import type { LiquidityEvent } from "../services/liquidity-engine";
import { liquidityEngine } from "../services/liquidity-engine";
import { marketStateManager } from "../services/market-state";
import {
  fetchKlines,
  fetchKlinesPaginated,
  fetch24hTicker,
  fetchOrderBook,
  fetchRecentTrades,
  fetchAggTrades,
  fetchMarkPrice,
  fetchFundingRate,
  SUPPORTED_PAIRS,
  type BinanceKline,
} from "../services/binance";
import { getDb } from "../queries/connection";
import { marketData, orderBookSnapshots, recentTicks, marketRegimes, liquidityZones } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";

// ─── Interval → milliseconds ───
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

// Resample 1m candles from DB into a higher timeframe.
// Used when REST endpoints are unavailable (geo-block) — gives us chart data from WS-cached 1m data.
function resampleFromOneMin(
  rows: { timestamp: Date; open: string; high: string; low: string; close: string; volume: string; quoteVolume: string; tradeCount: number | null }[],
  intervalMs: number,
  limit: number
): BinanceKline[] {
  if (rows.length === 0 || intervalMs <= 60_000) return [];

  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    const ts = row.timestamp.getTime();
    const bucket = Math.floor(ts / intervalMs) * intervalMs;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(row);
  }

  const result: BinanceKline[] = [];
  for (const [bucket, candles] of groups) {
    const sorted = [...candles].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    result.push({
      openTime: bucket,
      open: sorted[0].open,
      high: String(Math.max(...sorted.map((c) => parseFloat(c.high)))),
      low: String(Math.min(...sorted.map((c) => parseFloat(c.low)))),
      close: sorted[sorted.length - 1].close,
      volume: String(sorted.reduce((s, c) => s + parseFloat(c.volume), 0)),
      closeTime: bucket + intervalMs - 1,
      quoteVolume: String(sorted.reduce((s, c) => s + parseFloat(c.quoteVolume), 0)),
      trades: sorted.reduce((s, c) => s + (c.tradeCount ?? 0), 0),
    });
  }

  return result.sort((a, b) => a.openTime - b.openTime).slice(-limit);
}

export const marketRouter = createRouter({
  // ─── Get supported trading pairs ───
  pairs: authedQuery.query(() => {
    return SUPPORTED_PAIRS;
  }),

  // ─── Expose system configurations dynamically ───
  systemConfig: authedQuery.query(() => {
    return {
      minLeverage: MIN_SYSTEM_LEVERAGE,
      maxLeverage: MAX_SYSTEM_LEVERAGE,
      supportedSymbols: SUPPORTED_SYMBOLS,
      supportedPairs: SUPPORTED_PAIRS,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
    };
  }),

  // ─── Fetch OHLC Klines from Binance ───
  klines: authedQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        interval: z.string().default("1m"),
        limit: z.number().min(1).max(1000).default(500),
        endTime: z.number().optional(),   // ms timestamp — fetch candles before this time
      })
    )
    .query(async ({ input }) => {
      try {
        const klines = await fetchKlines(input.symbol, input.interval, input.limit, input.endTime);
        // Store in DB for caching
        const db = getDb();
        for (const k of klines.slice(-10)) {
          await db.insert(marketData).values({
            symbol: input.symbol,
            timeframe: input.interval,
            timestamp: new Date(k.openTime),
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
            quoteVolume: k.quoteVolume,
            tradeCount: k.trades,
          }).catch(() => {}); // ignore duplicates
        }
        return klines;
      } catch (error: any) {
        console.warn(`[market-router] klines REST failed for ${input.symbol}/${input.interval}:`, error.message);
        const db = getDb();

        // Fallback 1: same-timeframe DB cache (populated on previous successful fetches)
        const cached = await db
          .select()
          .from(marketData)
          .where(and(eq(marketData.symbol, input.symbol), eq(marketData.timeframe, input.interval)))
          .orderBy(desc(marketData.timestamp))
          .limit(input.limit);

        if (cached.length >= 10) {
          return cached.reverse().map((c) => ({
            openTime: c.timestamp.getTime(),
            open: c.open, high: c.high, low: c.low, close: c.close,
            volume: c.volume, closeTime: c.timestamp.getTime() + 60_000,
            quoteVolume: c.quoteVolume, trades: c.tradeCount || 0,
          }));
        }

        // Fallback 2: resample from 1m DB candles (WS continuously populates these)
        const intervalMs = INTERVAL_MS[input.interval] ?? 0;
        if (intervalMs > 60_000) {
          // Fetch enough 1m candles to cover the requested number of higher-TF candles
          const oneMinNeeded = Math.min(input.limit * (intervalMs / 60_000), 100000); // increased cap to ensure enough candles for large intervals
          const oneMin = await db
            .select()
            .from(marketData)
            .where(and(eq(marketData.symbol, input.symbol), eq(marketData.timeframe, "1m")))
            .orderBy(desc(marketData.timestamp))
            .limit(Math.ceil(oneMinNeeded))
            .then((rows) => rows.reverse());

          const resampled = resampleFromOneMin(oneMin, intervalMs, input.limit);
          if (resampled.length > 0) {
            console.log(`[market-router] Serving ${resampled.length} ${input.interval} candles resampled from ${oneMin.length} 1m DB rows`);
            return resampled;
          }
        }

        return []; // no data available
      }
    }),

  // ─── Single batch (for paginated historical fetch from UI) ───
  klinesBatch: authedQuery
    .input(
      z.object({
        symbol: z.string(),
        interval: z.string(),
        limit: z.number().min(1).max(1500).default(1500),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      return fetchKlines(
        input.symbol,
        input.interval,
        input.limit,
        input.endTime,
        input.startTime
      );
    }),

  // ─── Full historical range (server-side pagination) ───
  klinesHistorical: authedQuery
    .input(
      z.object({
        symbol: z.string(),
        interval: z.string(),
        startTime: z.number(),
        endTime: z.number(),
      })
    )
    .query(async ({ input }) => {
      return fetchKlinesPaginated(
        input.symbol,
        input.interval,
        input.startTime,
        input.endTime
      );
    }),

  // ─── Fetch 24h ticker stats ───
  // ─── SMC / ICT Price Action Analysis ───
  priceAction: authedQuery
    .input(z.object({
      symbol:   z.string().default("BTCUSDT"),
      interval: z.string().default("1m"),
      limit:    z.number().min(50).max(500).default(200),
    }))
    .query(async ({ input }) => {
      // 1. Try to get klines from DB cache
      const db = getDb();
      const dbRows = await db
        .select()
        .from(marketData)
        .where(and(eq(marketData.symbol, input.symbol), eq(marketData.timeframe, input.interval)))
        .orderBy(desc(marketData.timestamp))
        .limit(input.limit)
        .catch(() => []);

      let rawKlines: { openTime: number; open: string; high: string; low: string; close: string; volume: string }[];

      if (dbRows.length >= 50) {
        rawKlines = [...dbRows].reverse().map((r) => ({
          openTime: r.timestamp.getTime(),
          open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
        }));
      } else {
        // Fallback to REST
        try {
          const fetched = await fetchKlines(input.symbol, input.interval, input.limit);
          rawKlines = fetched.map((k) => ({
            openTime: k.openTime, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
          }));
        } catch {
          return null;
        }
      }

      const klines = klinesFromBinance(rawKlines);
      return analyzeAll(klines);
    }),

  ticker24h: authedQuery
    .input(
      z.object({
        symbol: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fetch24hTicker(input.symbol);
      } catch (error: any) {
        return { error: error.message };
      }
    }),

  // ─── Fetch order book depth ───
  orderBook: authedQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        limit: z.number().min(5).max(1000).default(100),
      })
    )
    .query(async ({ input }) => {
      try {
        const depth = await fetchOrderBook(input.symbol, input.limit);
        // Store snapshot
        const db = getDb();
        const bestBid = parseFloat(depth.bids[0]?.[0] || "0");
        const bestAsk = parseFloat(depth.asks[0]?.[0] || "0");
        await db.insert(orderBookSnapshots).values({
          symbol: input.symbol,
          bids: depth.bids.slice(0, 20),
          asks: depth.asks.slice(0, 20),
          midPrice: String((bestBid + bestAsk) / 2),
          spread: String(bestAsk - bestBid),
        }).catch(() => {});
        return depth;
      } catch (error: any) {
        return { error: error.message, bids: [], asks: [] };
      }
    }),

  // ─── Fetch recent trades ───
  recentTrades: authedQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        limit: z.number().min(1).max(1000).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        const trades = await fetchRecentTrades(input.symbol, input.limit);
        // Store in DB
        const db = getDb();
        for (const t of trades.slice(-10)) {
          await db.insert(recentTicks).values({
            symbol: input.symbol,
            price: t.price,
            size: t.qty,
            side: t.isBuyerMaker ? "sell" : "buy",
            isMaker: t.isBuyerMaker,
            tradeTime: new Date(t.time),
          }).catch(() => {});
        }
        return trades;
      } catch {
        return [];
      }
    }),

  // ─── Fetch aggregated trades ───
  aggTrades: authedQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        limit: z.number().min(1).max(1000).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fetchAggTrades(input.symbol, input.limit);
      } catch {
        return [];
      }
    }),

  // ─── Fetch mark price ───
  markPrice: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      try {
        return await fetchMarkPrice(input.symbol);
      } catch (error: any) {
        return { error: error.message };
      }
    }),

  // ─── Fetch funding rate ───
  fundingRate: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      try {
        return await fetchFundingRate(input.symbol);
      } catch (error: any) {
        return { error: error.message };
      }
    }),

  // ─── Get cached market data ───
  cachedKlines: authedQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        interval: z.string().default("1m"),
        limit: z.number().default(150),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(marketData)
        .where(
          and(
            eq(marketData.symbol, input.symbol),
            eq(marketData.timeframe, input.interval)
          )
        )
        .orderBy(desc(marketData.timestamp))
        .limit(input.limit);
      return rows.reverse();
    }),

  // ─── Order Book Subscription ───
  orderBookStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable((emit) => {
        const symbol = input.symbol;
        subscribeToSymbol(symbol);
        const onData = (data: any) => emit.next(data);
        marketEvents.on(`${symbol}:depth`, onData);
        return () => {
          marketEvents.off(`${symbol}:depth`, onData);
          unsubscribeFromSymbol(symbol);
        };
      });
    }),

  // ─── Recent Trades Subscription ───
  recentTradesStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable((emit) => {
        const symbol = input.symbol;
        subscribeToSymbol(symbol);
        const onData = (data: any) => emit.next(data);
        marketEvents.on(`${symbol}:trade`, onData);
        return () => {
          marketEvents.off(`${symbol}:trade`, onData);
          unsubscribeFromSymbol(symbol);
        };
      });
    }),

  // ─── Ticker Subscription ───
  tickerStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable((emit) => {
        const symbol = input.symbol;
        subscribeToSymbol(symbol);
        const onData = (data: any) => emit.next(data);
        marketEvents.on(`${symbol}:ticker`, onData);
        return () => {
          marketEvents.off(`${symbol}:ticker`, onData);
          unsubscribeFromSymbol(symbol);
        };
      });
    }),

  // ─── Kline Subscription ───
  klineStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable((emit) => {
        const symbol = input.symbol;
        subscribeToSymbol(symbol);
        const onData = (data: any) => emit.next(data);
        marketEvents.on(`${symbol}:kline`, onData);
        return () => {
          marketEvents.off(`${symbol}:kline`, onData);
          unsubscribeFromSymbol(symbol);
        };
      });
    }),

  // ─── Liquidity Event Stream ───
  liquidityEventStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable<LiquidityEvent>((emit) => {
        const handler = (event: LiquidityEvent) => {
          if (event.symbol === input.symbol) {
            emit.next(event);
          }
        };
        liquidityEngine.on("liquidity_event", handler);
        return () => liquidityEngine.off("liquidity_event", handler);
      });
    }),

  // ─── Get Live State & Derived Metrics from Memory ───
  liveState: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(({ input }) => {
      const state = marketStateManager.get(input.symbol);
      if (!state) return null;

      return {
        symbol: state.symbol,
        ltp: state.ltp,
        previousLtp: state.previousLtp,
        metrics: state.metrics,
        updatedAt: state.updatedAt,
        sequenceNo: state.sequenceNo,
        recentLtp: state.ltpWindow.values().slice(-50),
        recentTrades: state.tradeWindow.values().slice(-50),
        recentDeltas: state.deltaWindow.values().slice(-20),
      };
    }),

  // ─── CVD History (tick-level, from in-memory cvdWindow) ───
  cvdHistory: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(({ input }) => {
      const state = marketStateManager.get(input.symbol.toUpperCase());
      if (!state) return { points: [] as { ts: number; delta: number; cumulative: number }[] };
      return {
        points: state.cvdWindow.values().map((t) => ({
          ts: t.timestamp,
          delta: t.delta,
          cumulative: t.cumulative,
        })),
      };
    }),

  // ─── CVD Stream (fires on each new trade tick) ───
  cvdStream: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .subscription(({ input }) => {
      return observable<{ ts: number; delta: number; cumulative: number }>((emit) => {
        const sym = input.symbol.toUpperCase();
        const onTrade = () => {
          const state = marketStateManager.get(sym);
          if (!state) return;
          const last = state.cvdWindow.values().at(-1);
          if (last) emit.next({ ts: last.timestamp, delta: last.delta, cumulative: last.cumulative });
        };
        marketEvents.on(`${sym}:trade`, onTrade);
        return () => { marketEvents.off(`${sym}:trade`, onTrade); };
      });
    }),

  // ─── Get Live State & Derived Metrics for All Supported Symbols ───
  allLiveStates: authedQuery
    .query(() => {
      const results: Record<string, any> = {};
      for (const pair of SUPPORTED_PAIRS) {
        const state = marketStateManager.get(pair.binance);
        if (state) {
          results[pair.binance] = {
            symbol: state.symbol,
            ltp: state.ltp,
            metrics: state.metrics,
            updatedAt: state.updatedAt,
            sequenceNo: state.sequenceNo,
          };
        }
      }
      return results;
    }),

  // ─── Get latest market regime for a symbol ───
  regime: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(marketRegimes)
        .where(eq(marketRegimes.symbol, input.symbol))
        .orderBy(desc(marketRegimes.timestamp))
        .limit(1);
      return rows[0] || null;
    }),

  // ─── Get regime history for a symbol ───
  regimeHistory: authedQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT"), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(marketRegimes)
        .where(eq(marketRegimes.symbol, input.symbol))
        .orderBy(desc(marketRegimes.timestamp))
        .limit(input.limit);
    }),

  liquidityZones: authedQuery
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (input?.symbol) {
        return db
          .select()
          .from(liquidityZones)
          .where(and(eq(liquidityZones.isSwept, false), eq(liquidityZones.symbol, input.symbol)));
      }
      return db
        .select()
        .from(liquidityZones)
        .where(eq(liquidityZones.isSwept, false));
    }),
});
