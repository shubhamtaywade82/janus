import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import {
  fetchKlines,
  fetch24hTicker,
  fetchOrderBook,
  fetchRecentTrades,
  fetchAggTrades,
  fetchMarkPrice,
  fetchFundingRate,
  SUPPORTED_PAIRS,
} from "../services/binance";
import { getDb } from "../queries/connection";
import { marketData, orderBookSnapshots, recentTicks } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";

export const marketRouter = createRouter({
  // ─── Get supported trading pairs ───
  pairs: publicQuery.query(() => {
    return SUPPORTED_PAIRS;
  }),

  // ─── Fetch OHLC Klines from Binance ───
  klines: publicQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        interval: z.string().default("1m"),
        limit: z.number().min(1).max(1000).default(150),
      })
    )
    .query(async ({ input }) => {
      try {
        const klines = await fetchKlines(input.symbol, input.interval, input.limit);
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
        // Fallback to cached data
        const db = getDb();
        const cached = await db
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
        return cached.reverse().map((c) => ({
          openTime: c.timestamp.getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          closeTime: c.timestamp.getTime() + 60000,
          quoteVolume: c.quoteVolume,
          trades: c.tradeCount || 0,
        }));
      }
    }),

  // ─── Fetch 24h ticker stats ───
  ticker24h: publicQuery
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
  orderBook: publicQuery
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
  recentTrades: publicQuery
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
      } catch (error: any) {
        return [];
      }
    }),

  // ─── Fetch aggregated trades ───
  aggTrades: publicQuery
    .input(
      z.object({
        symbol: z.string().default("BTCUSDT"),
        limit: z.number().min(1).max(1000).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fetchAggTrades(input.symbol, input.limit);
      } catch (error: any) {
        return [];
      }
    }),

  // ─── Fetch mark price ───
  markPrice: publicQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      try {
        return await fetchMarkPrice(input.symbol);
      } catch (error: any) {
        return { error: error.message };
      }
    }),

  // ─── Fetch funding rate ───
  fundingRate: publicQuery
    .input(z.object({ symbol: z.string().default("BTCUSDT") }))
    .query(async ({ input }) => {
      try {
        return await fetchFundingRate(input.symbol);
      } catch (error: any) {
        return { error: error.message };
      }
    }),

  // ─── Get cached market data ───
  cachedKlines: publicQuery
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
});
