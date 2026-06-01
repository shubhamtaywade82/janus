import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";

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

  // ─── Create a new position (simulated) ───
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
      });
      return { id: Number(result[0].insertId), ...input };
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
      });
      return { id: Number(result[0].insertId), ...input };
    }),

  // ─── Get portfolio summary ───
  portfolio: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const openPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, input.userId),
            eq(positions.status, "open")
          )
        );

      const allTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.userId, input.userId))
        .orderBy(desc(trades.createdAt))
        .limit(100);

      const totalUnrealizedPnl = openPositions.reduce(
        (sum, p) => sum + parseFloat(p.unrealizedPnl || "0"),
        0
      );
      const totalRealizedPnl = allTrades.reduce(
        (sum, t) => sum + parseFloat(t.fee || "0") * -1,
        0
      );
      const totalMargin = openPositions.reduce(
        (sum, p) => sum + parseFloat(p.margin || "0"),
        0
      );

      return {
        openPositionsCount: openPositions.length,
        totalUnrealizedPnl: totalUnrealizedPnl.toFixed(4),
        totalRealizedPnl: totalRealizedPnl.toFixed(4),
        totalMargin: totalMargin.toFixed(4),
        totalEquity: totalMargin + totalUnrealizedPnl,
        positions: openPositions,
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
