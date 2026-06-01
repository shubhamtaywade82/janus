import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";
import { createFuturesOrder, getFuturesPositions, getCoinDCXTicker, calculateLiquidationPrice } from "../services/coindcx";
import { TRPCError } from "@trpc/server";

export const tradingRouter = createRouter({
  // ─── Get all positions ───
  positions: publicQuery
    .input(
      z.object({
        userId: z.number().optional(),
        status: z.enum(["open", "closed", "liquidated"]).optional(),
        symbol: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const userId = input.userId || 1;

      // Check if user has saved credentials for CoinDCX
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, userId),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);

      if (creds && creds[0] && input.status === "open") {
        try {
          // Fetch live CoinDCX futures positions
          const livePositions = await getFuturesPositions({
            apiKey: creds[0].apiKey,
            apiSecret: creds[0].apiSecret,
          });

          // Fetch live tickers to calculate currentPrice and PnL
          const tickers = await getCoinDCXTicker();
          const tickerMap = new Map<string, number>();
          if (Array.isArray(tickers)) {
            tickers.forEach((t: any) => {
              if (t.market && t.last_price) {
                tickerMap.set(t.market, parseFloat(t.last_price));
              }
            });
          }

          // Map positions to DB schema format
          const mapped = livePositions
            .filter((p: any) => parseFloat(p.active_pos) !== 0)
            .map((p: any, idx: number) => {
              const sizeVal = parseFloat(p.active_pos);
              const side = sizeVal >= 0 ? "long" : "short";
              const absSize = Math.abs(sizeVal);
              const symbol = p.pair.replace("B-", "").replace("_", "");
              
              const lastPrice = tickerMap.get(p.pair) || parseFloat(p.avg_price);
              const entryPrice = parseFloat(p.avg_price);
              
              let unrealizedPnl = 0;
              if (side === "long") {
                unrealizedPnl = (lastPrice - entryPrice) * absSize;
              } else {
                unrealizedPnl = (entryPrice - lastPrice) * absSize;
              }

              return {
                id: idx + 10000, // Safe temporary key
                userId,
                symbol,
                side,
                entryPrice: p.avg_price,
                currentPrice: String(lastPrice),
                size: String(absSize),
                leverage: p.leverage,
                margin: p.locked_margin,
                unrealizedPnl: String(unrealizedPnl),
                realizedPnl: "0.00",
                liquidationPrice: p.liquidation_price || null,
                stopLoss: p.stop_loss_trigger || null,
                takeProfit: p.take_profit_trigger || null,
                status: "open",
                createdAt: new Date(),
                updatedAt: new Date(),
              };
            });

          return mapped;
        } catch (err) {
          console.error("[trading-router] Failed to fetch live positions from CoinDCX, falling back to local DB:", err);
        }
      }

      const conditions = [];
      if (input.userId) conditions.push(eq(positions.userId, input.userId));
      if (input.status) conditions.push(eq(positions.status, input.status));
      if (input.symbol) conditions.push(eq(positions.symbol, input.symbol));

      const query = db.select().from(positions).orderBy(desc(positions.createdAt));
      if (conditions.length > 0) {
        return query.where(and(...conditions));
      }
      return query;
    }),

  // ─── Get position by ID ───
  position: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(positions)
        .where(eq(positions.id, input.id))
        .limit(1);
      return result[0] || null;
    }),

  // ─── Create a new position (simulated/live) ───
  createPosition: publicQuery
    .input(
      z.object({
        userId: z.number(),
        symbol: z.string(),
        side: z.enum(["long", "short"]),
        entryPrice: z.string(),
        currentPrice: z.string(),
        size: z.string(),
        leverage: z.number().min(1).max(125).default(1),
        margin: z.string(),
        liquidationPrice: z.string().optional(),
        stopLoss: z.string().optional(),
        takeProfit: z.string().optional(),
        signalId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // 1. Leverage Cap check (10x maximum)
      if (input.leverage > 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Leverage exceeds maximum allowed safety cap of 10x.",
        });
      }

      // 2. Stop-Loss & Liquidation Price distance buffer check
      if (input.stopLoss) {
        const entry = parseFloat(input.entryPrice);
        const stop = parseFloat(input.stopLoss);
        const size = parseFloat(input.size);
        const margin = parseFloat(input.margin);
        
        const liq = input.liquidationPrice 
          ? parseFloat(input.liquidationPrice) 
          : calculateLiquidationPrice(entry, margin, size, input.side, input.leverage);

        const distLiq = Math.abs(entry - liq);
        const distStop = Math.abs(entry - stop);

        if (distLiq < 2 * distStop) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Risk buffer violation: Projected liquidation price distance must be at least twice the distance of the stop loss price relative to entry price.",
          });
        }
      }

      // Check if user has saved CoinDCX credentials for live execution
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, input.userId),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);

      let exchangeOrderId: string | undefined = undefined;

      if (creds && creds[0]) {
        try {
          // Format symbol from BTCUSDT -> B-BTC_USDT
          let coindcxSymbol = input.symbol;
          if (!coindcxSymbol.startsWith("B-")) {
            coindcxSymbol = `B-${input.symbol.replace("USDT", "_USDT")}`;
          }

          console.log(`[coindcx-execution] Attempting live order for ${coindcxSymbol} (${input.side})`);
          const orderRes = await createFuturesOrder(
            {
              apiKey: creds[0].apiKey,
              apiSecret: creds[0].apiSecret,
            },
            {
              market: coindcxSymbol,
              side: input.side === "long" ? "buy" : "sell",
              order_type: "market",
              total_quantity: parseFloat(input.size),
              price: parseFloat(input.entryPrice),
              leverage: input.leverage,
            }
          );

          if (orderRes && orderRes.id) {
            exchangeOrderId = orderRes.id;
            console.log(`[coindcx-execution] Live order succeeded. Order ID: ${exchangeOrderId}`);
          }
        } catch (err) {
          console.error("[coindcx-execution] Failed live execution, falling back to simulation mode:", err);
        }
      }

      const result = await db.insert(positions).values({
        userId: input.userId,
        symbol: input.symbol,
        side: input.side,
        entryPrice: input.entryPrice,
        currentPrice: input.currentPrice,
        size: input.size,
        leverage: input.leverage,
        margin: input.margin,
        liquidationPrice: input.liquidationPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        signalId: input.signalId,
        unrealizedPnl: "0",
        realizedPnl: "0",
        status: "open",
        exchangeOrderId,
      }).returning({ id: positions.id });

      return { id: result[0].id, ...input, exchangeOrderId };
    }),

  // ─── Close a position ───
  closePosition: publicQuery
    .input(
      z.object({
        id: z.number(),
        closePrice: z.string(),
        realizedPnl: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(positions)
        .set({
          status: "closed",
          currentPrice: input.closePrice,
          realizedPnl: input.realizedPnl,
          unrealizedPnl: "0",
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(positions.id, input.id));
      return { success: true };
    }),

  // ─── Update position PnL ───
  updatePositionPnl: publicQuery
    .input(
      z.object({
        id: z.number(),
        currentPrice: z.string(),
        unrealizedPnl: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(positions)
        .set({
          currentPrice: input.currentPrice,
          unrealizedPnl: input.unrealizedPnl,
          updatedAt: new Date(),
        })
        .where(eq(positions.id, input.id));
      return { success: true };
    }),

  // ─── Get trade history ───
  trades: publicQuery
    .input(
      z.object({
        userId: z.number().optional(),
        symbol: z.string().optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.userId) conditions.push(eq(trades.userId, input.userId));
      if (input.symbol) conditions.push(eq(trades.symbol, input.symbol));

      const query = db
        .select()
        .from(trades)
        .orderBy(desc(trades.createdAt))
        .limit(input.limit);
      if (conditions.length > 0) {
        return query.where(and(...conditions));
      }
      return query;
    }),

  // ─── Record a trade ───
  recordTrade: publicQuery
    .input(
      z.object({
        userId: z.number(),
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        orderType: z.enum(["market", "limit", "stop"]).default("market"),
        price: z.string(),
        size: z.string(),
        leverage: z.number().default(1),
        fee: z.string().default("0"),
        total: z.string(),
        positionId: z.number().optional(),
        clientOrderId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(trades).values({
        userId: input.userId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        price: input.price,
        size: input.size,
        leverage: input.leverage,
        fee: input.fee,
        total: input.total,
        positionId: input.positionId,
        clientOrderId: input.clientOrderId,
        status: "filled",
        executedAt: new Date(),
      }).returning({ id: trades.id });
      return { id: result[0].id, ...input };
    }),

  // ─── Get portfolio summary ───
  portfolio: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const userId = input.userId;

      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, userId),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);

      let openPositions: any[] = [];
      let totalRealizedPnl = 0;
      let totalMargin = 0;
      let totalUnrealizedPnl = 0;
      let recentTrades: any[] = [];

      // Try fetching live if credentials exist
      if (creds && creds[0]) {
        try {
          // Fetch live positions
          const livePositions = await getFuturesPositions({
            apiKey: creds[0].apiKey,
            apiSecret: creds[0].apiSecret,
          });

          // Fetch live tickers to calculate currentPrice and PnL
          const tickers = await getCoinDCXTicker();
          const tickerMap = new Map<string, number>();
          if (Array.isArray(tickers)) {
            tickers.forEach((t: any) => {
              if (t.market && t.last_price) {
                tickerMap.set(t.market, parseFloat(t.last_price));
              }
            });
          }

          openPositions = livePositions
            .filter((p: any) => parseFloat(p.active_pos) !== 0)
            .map((p: any, idx: number) => {
              const sizeVal = parseFloat(p.active_pos);
              const side = sizeVal >= 0 ? "long" : "short";
              const absSize = Math.abs(sizeVal);
              const symbol = p.pair.replace("B-", "").replace("_", "");
              
              const lastPrice = tickerMap.get(p.pair) || parseFloat(p.avg_price);
              const entryPrice = parseFloat(p.avg_price);
              
              let unrealizedPnl = 0;
              if (side === "long") {
                unrealizedPnl = (lastPrice - entryPrice) * absSize;
              } else {
                unrealizedPnl = (entryPrice - lastPrice) * absSize;
              }

              totalMargin += parseFloat(p.locked_margin || "0");
              totalUnrealizedPnl += unrealizedPnl;

              return {
                id: idx + 10000,
                userId,
                symbol,
                side,
                entryPrice: p.avg_price,
                currentPrice: String(lastPrice),
                size: String(absSize),
                leverage: p.leverage,
                margin: p.locked_margin,
                unrealizedPnl: String(unrealizedPnl),
                realizedPnl: "0.00",
                liquidationPrice: p.liquidation_price || null,
                stopLoss: p.stop_loss_trigger || null,
                takeProfit: p.take_profit_trigger || null,
                status: "open",
                createdAt: new Date(),
                updatedAt: new Date(),
              };
            });

          const allTrades = await db
            .select()
            .from(trades)
            .where(eq(trades.userId, userId))
            .orderBy(desc(trades.createdAt))
            .limit(100);
          recentTrades = allTrades.slice(0, 20);

          totalRealizedPnl = allTrades.reduce(
            (sum, t) => sum + parseFloat(t.fee || "0") * -1,
            0
          );

          return {
            openPositionsCount: openPositions.length,
            totalUnrealizedPnl: totalUnrealizedPnl.toFixed(4),
            totalRealizedPnl: totalRealizedPnl.toFixed(4),
            totalMargin: totalMargin.toFixed(4),
            totalEquity: totalMargin + totalUnrealizedPnl,
            positions: openPositions,
            recentTrades,
          };
        } catch (err) {
          console.error("[trading-router] Failed to fetch live portfolio details from CoinDCX, falling back to local DB:", err);
        }
      }

      // Fallback: Local simulated DB positions
      const localPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.status, "open")
          )
        );

      const allTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.userId, userId))
        .orderBy(desc(trades.createdAt))
        .limit(100);

      const localUnrealizedPnl = localPositions.reduce(
        (sum, p) => sum + parseFloat(p.unrealizedPnl || "0"),
        0
      );
      const localRealizedPnl = allTrades.reduce(
        (sum, t) => sum + parseFloat(t.fee || "0") * -1,
        0
      );
      const localMargin = localPositions.reduce(
        (sum, p) => sum + parseFloat(p.margin || "0"),
        0
      );

      return {
        openPositionsCount: localPositions.length,
        totalUnrealizedPnl: localUnrealizedPnl.toFixed(4),
        totalRealizedPnl: localRealizedPnl.toFixed(4),
        totalMargin: localMargin.toFixed(4),
        totalEquity: localMargin + localUnrealizedPnl,
        positions: localPositions,
        recentTrades: allTrades.slice(0, 20),
      };
    }),

  // ─── Save exchange credentials ───
  saveCredentials: publicQuery
    .input(
      z.object({
        userId: z.number(),
        exchange: z.enum(["coindcx", "binance"]),
        apiKey: z.string(),
        apiSecret: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(exchangeCredentials).values({
        userId: input.userId,
        exchange: input.exchange,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
      });
      return { success: true };
    }),

  // ─── Get exchange credentials ───
  credentials: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(exchangeCredentials)
        .where(eq(exchangeCredentials.userId, input.userId));
    }),
});
