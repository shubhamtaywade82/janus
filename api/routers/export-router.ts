/**
 * Export Router
 * Provides endpoints for exporting trading state and trade history.
 *
 * Endpoints:
 *   exportState  — JSON blob of open positions + recent closed positions + equity curve
 *   exportTrades — CSV of closed positions for tax/accounting purposes
 */

import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, signals, equitySnapshots } from "@db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";

export const exportRouter = createRouter({
  /**
   * Returns a JSON snapshot of:
   *   - All open positions for the authenticated user
   *   - Last 100 closed positions
   *   - Last 50 signals
   *   - Last 30 equity snapshots
   */
  exportState: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;

    const [openPositions, recentClosed, recentSignals, equity] = await Promise.all([
      db
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "open")))
        .orderBy(desc(positions.createdAt)),

      db
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "closed")))
        .orderBy(desc(positions.closedAt))
        .limit(100),

      db
        .select()
        .from(signals)
        .orderBy(desc(signals.createdAt))
        .limit(50),

      db
        .select()
        .from(equitySnapshots)
        .where(eq(equitySnapshots.userId, userId))
        .orderBy(desc(equitySnapshots.snapshotAt))
        .limit(30),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      positions: [...openPositions, ...recentClosed],
      recentSignals,
      equity: equity.reverse(), // chronological order for charting
    };
  }),

  /**
   * Returns a CSV string of closed positions for tax reporting.
   * Columns: id, symbol, side, entryPrice, exitPrice, size, leverage,
   *          realizedPnl, fee, strategyType, createdAt, closedAt
   *
   * Optional date range filter: from / to (ISO 8601 datetime strings)
   */
  exportTrades: authedQuery
    .input(
      z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      const conditions = [
        eq(positions.userId, userId),
        eq(positions.status, "closed"),
      ];

      if (input.from) {
        conditions.push(gte(positions.closedAt, new Date(input.from)));
      }
      if (input.to) {
        conditions.push(lte(positions.closedAt, new Date(input.to)));
      }

      const rows = await db
        .select({
          id: positions.id,
          symbol: positions.symbol,
          side: positions.side,
          entryPrice: positions.entryPrice,
          currentPrice: positions.currentPrice, // exit price for closed positions
          size: positions.size,
          leverage: positions.leverage,
          realizedPnl: positions.realizedPnl,
          strategyType: positions.strategyType,
          createdAt: positions.createdAt,
          closedAt: positions.closedAt,
        })
        .from(positions)
        .where(and(...conditions))
        .orderBy(desc(positions.closedAt));

      // Build CSV
      const headers = [
        "id",
        "symbol",
        "side",
        "entryPrice",
        "exitPrice",
        "size",
        "leverage",
        "realizedPnl",
        "fee",
        "strategyType",
        "createdAt",
        "closedAt",
      ];

      const csvLines: string[] = [headers.join(",")];

      for (const row of rows) {
        const line = [
          row.id,
          row.symbol,
          row.side,
          row.entryPrice,
          row.currentPrice ?? "",        // exit price
          row.size,
          row.leverage,
          row.realizedPnl ?? "0",
          "0",                           // fee — not stored separately; extend if needed
          row.strategyType ?? "",
          row.createdAt.toISOString(),
          row.closedAt ? row.closedAt.toISOString() : "",
        ]
          .map((v) => {
            // Escape fields containing commas or quotes
            const str = String(v);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",");

        csvLines.push(line);
      }

      return {
        csv: csvLines.join("\n"),
        rowCount: rows.length,
        exportedAt: new Date().toISOString(),
      };
    }),
});
