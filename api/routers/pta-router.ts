import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  trades,
  positions,
} from "@db/schema";
import {
  eq,
  desc,
  and,
  sql,
  gte,
  lte,
} from "drizzle-orm";

function mapSideToEnum(input?: string): "buy" | "sell" | undefined {
  if (!input) return undefined;
  const v = input.toLowerCase();
  if (v === "long" || v === "buy") return "buy";
  if (v === "short" || v === "sell") return "sell";
  return undefined;
}

export const ptaRouter = createRouter({
  tradeJournal: authedQuery
    .input(
      z.object({
        symbol: z.string().optional(),
        side: z.enum(["long", "short", "buy", "sell"]).optional(),
        strategy: z.string().optional(),
        executionMode: z.enum(["PAPER", "LIVE", "SHADOW"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      const conditions = [eq(trades.userId, userId)];
      if (input.symbol) conditions.push(eq(trades.symbol, input.symbol));
      const sideEnum = mapSideToEnum(input.side);
      if (sideEnum)
        conditions.push(eq(trades.side, sideEnum as any));
      if (input.strategy)
        conditions.push(eq(trades.strategyType, input.strategy as any));
      if (input.executionMode)
        conditions.push(eq(trades.executionMode, input.executionMode));
      if (input.from) conditions.push(gte(trades.createdAt, input.from));
      if (input.to) conditions.push(lte(trades.createdAt, input.to));

      const where = and(...conditions);

      const rows = await db
        .select({
          id: trades.id,
          symbol: trades.symbol,
          side: trades.side,
          orderType: trades.orderType,
          price: trades.price,
          size: trades.size,
          leverage: trades.leverage,
          fee: trades.fee,
          tdsDeducted: trades.tdsDeducted,
          total: trades.total,
          status: trades.status,
          strategy: trades.strategyType,
          stopLossPrice: trades.stopLossPrice,
          takeProfitPrice: trades.takeProfitPrice,
          trailingStopPct: trades.trailingStopPct,
          grossPnlUsdt: trades.grossPnlUsdt,
          netPnlUsdt: trades.netPnlUsdt,
          totalFeesUsdt: trades.totalFeesUsdt,
          fundingPaidUsdt: trades.fundingPaidUsdt,
          mfePrice: trades.mfePrice,
          mfePct: trades.mfePct,
          maePrice: trades.maePrice,
          maePct: trades.maePct,
          exitReason: trades.exitReason,
          holdingPeriodSeconds: trades.holdingPeriodSeconds,
          binanceSignalPrice: trades.binanceSignalPrice,
          coindcxFillPrice: trades.coindcxFillPrice,
          slippageBps: trades.slippageBps,
          executionMode: trades.executionMode,
          executedAt: trades.executedAt,
          createdAt: trades.createdAt,
          entryPrice: positions.entryPrice,
          positionStatus: positions.status,
        })
        .from(trades)
        .leftJoin(positions, eq(trades.positionId, positions.id))
        .where(where)
        .orderBy(desc(trades.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(trades)
        .leftJoin(positions, eq(trades.positionId, positions.id))
        .where(where);

      return { rows, total: Number(count ?? 0) };
    }),
});
