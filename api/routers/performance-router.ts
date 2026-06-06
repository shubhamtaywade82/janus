import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, signals, brainEpisodes } from "@db/schema";
import { and, eq, desc, inArray, gte } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────
interface Bucket { trades: number; wins: number; losses: number; pnl: number; }
const emptyBucket = (): Bucket => ({ trades: 0, wins: 0, losses: 0, pnl: 0 });

function summarize(pnls: number[]) {
  const trades = pnls.length;
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const totalPnl = grossProfit - grossLoss;
  const winRate = trades ? wins.length / trades : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  // Expectancy per trade = avg win × winRate − avg loss × lossRate
  const expectancy = trades ? (avgWin * winRate) - (avgLoss * (losses.length / trades)) : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Max drawdown over the cumulative realized-PnL curve (chronological order assumed).
  let peak = 0, cum = 0, maxDd = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    trades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalPnl,
    grossProfit,
    grossLoss,
    avgWin,
    avgLoss,
    expectancy,
    profitFactor: profitFactor === Infinity ? null : profitFactor,
    maxDrawdown: maxDd,
  };
}

function classifySource(meta: any, hasSignal: boolean): string {
  const s = meta?.source;
  if (s === "brain-driver") return "brain";
  if (s === "manual-trigger") return "manual-trigger";
  return hasSignal ? "confluence" : "manual";
}

export const performanceRouter = createRouter({
  // Full system performance report — "after N trades, how did everything do?"
  systemReport: authedQuery
    .input(
      z.object({
        isPaper: z.boolean().default(true),
        lastNTrades: z.number().min(1).max(2000).optional(),
        sinceDays: z.number().min(1).max(365).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conds = [
        eq(positions.userId, ctx.user.id),
        eq(positions.status, "closed"),
        eq(positions.isPaper, input.isPaper),
      ];
      if (input.sinceDays) {
        conds.push(gte(positions.closedAt, new Date(Date.now() - input.sinceDays * 86_400_000)));
      }

      let rows = await db
        .select({
          id: positions.id,
          symbol: positions.symbol,
          side: positions.side,
          realizedPnl: positions.realizedPnl,
          strategyType: positions.strategyType,
          signalId: positions.signalId,
          createdAt: positions.createdAt,
          closedAt: positions.closedAt,
        })
        .from(positions)
        .where(and(...conds))
        .orderBy(desc(positions.closedAt))
        .limit(input.lastNTrades ?? 2000)
        .catch(() => []);

      // chronological for drawdown math
      rows = [...rows].reverse();

      // Resolve signal source for attribution (one batched query).
      const signalIds = rows.map((r) => r.signalId).filter((x): x is number => x != null);
      const sigRows = signalIds.length
        ? await db.select({ id: signals.id, metadata: signals.metadata }).from(signals).where(inArray(signals.id, signalIds)).catch(() => [])
        : [];
      const sigMeta = new Map(sigRows.map((s) => [s.id, s.metadata]));

      const allPnls: number[] = [];
      const bySource: Record<string, Bucket> = {};
      const bySymbol: Record<string, Bucket> = {};
      const byStrategy: Record<string, Bucket> = {};
      const equityCurve: { ts: number; cum: number }[] = [];
      let cum = 0;
      let totalHoldMin = 0, holdCount = 0;

      for (const r of rows) {
        const pnl = parseFloat(r.realizedPnl ?? "0") || 0;
        allPnls.push(pnl);
        cum += pnl;
        equityCurve.push({ ts: (r.closedAt ?? r.createdAt)?.getTime?.() ?? 0, cum });

        const src = classifySource(sigMeta.get(r.signalId as number), r.signalId != null);
        const strat = r.strategyType ?? "unknown";
        for (const [map, key] of [[bySource, src], [bySymbol, r.symbol], [byStrategy, strat]] as const) {
          if (!map[key]) map[key] = emptyBucket();
          map[key].trades++;
          map[key].pnl += pnl;
          if (pnl > 0) map[key].wins++;
          else if (pnl < 0) map[key].losses++;
        }

        if (r.closedAt && r.createdAt) {
          totalHoldMin += (r.closedAt.getTime() - r.createdAt.getTime()) / 60_000;
          holdCount++;
        }
      }

      // Brain decision quality (episodes within same window).
      const epConds = [eq(brainEpisodes.userId, ctx.user.id)];
      if (input.sinceDays) epConds.push(gte(brainEpisodes.createdAt, new Date(Date.now() - input.sinceDays * 86_400_000)));
      const episodes = await db
        .select({ proposedAction: brainEpisodes.proposedAction, actualAction: brainEpisodes.actualAction })
        .from(brainEpisodes)
        .where(and(...epConds))
        .catch(() => []);
      const brainQuality = {
        total: episodes.length,
        enter: episodes.filter((e: any) => e.proposedAction?.mode === "enter").length,
        hold: episodes.filter((e: any) => e.proposedAction?.mode === "hold").length,
        executed: episodes.filter((e: any) => e.actualAction?.status === "executed").length,
        vetoedByGate: episodes.filter((e: any) => e.actualAction?.status === "vetoed_by_gate").length,
        shadowLogged: episodes.filter((e: any) => e.actualAction?.status === "shadow_logged").length,
      };

      return {
        headline: {
          ...summarize(allPnls),
          avgHoldMinutes: holdCount ? totalHoldMin / holdCount : 0,
        },
        bySource,
        bySymbol,
        byStrategy,
        brainQuality,
        equityCurve,
      };
    }),
});

export type PerformanceRouter = typeof performanceRouter;
