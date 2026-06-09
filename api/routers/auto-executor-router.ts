import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { autoExecutorConfig, equitySnapshots, positions } from "@db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { globalAutoExecutor, autoExecutorEvents } from "../services/auto-executor";
import { globalKillSwitch, killSwitchEvents } from "../services/kill-switch";
import { computeMetrics } from "../services/performance-tracker";
import {
  resetPaperWallet,
  getPaperLedger,
  getPaperSnapshots,
  snapshotPaperWallet,
  getPaperWallet,
  depositPaperFunds,
} from "../services/paper-wallet";
import { env } from "../lib/env";
import { TRPCError } from "@trpc/server";

export const autoExecutorRouter = createRouter({
  // ─── Get config ───
  getConfig: authedQuery
    .query(async ({ ctx }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      return rows[0] ?? null;
    }),

  // ─── Save / upsert config ───
  saveConfig: authedQuery
    .input(
      z.object({
        enabled: z.boolean().optional(),
        targetSymbols: z.array(z.string()).optional(),
        defaultSizeUsdt: z.string().optional(),
        defaultLeverage: z.number().min(1).max(10).optional(),
        stopLossPct: z.string().optional(),
        tp1Pct: z.string().optional(),
        tp2Pct: z.string().optional(),
        useLlmAdvisor: z.boolean().optional(),
        llmConfidenceThreshold: z.number().min(0).max(100).optional(),
        maxPositionsPerSymbol: z.number().min(1).max(10).optional(),
        maxTotalPositions: z.number().min(1).max(20).optional(),
        capitalAllocationPct: z.string().optional(),   // "0.050" – "0.500"
        useStrategyLeverage: z.boolean().optional(),
        paperStartingBalance: z.string().optional(),
        paperCurrency: z.enum(["USDT", "INR"]).optional(),
        brainDriverEnabled: z.boolean().optional(),
        brainGateEnabled: z.boolean().optional(),
        brainShadowMode: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user.id;
      const fields = input;

      const existing = await db
        .select({ id: autoExecutorConfig.id })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(autoExecutorConfig)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(autoExecutorConfig.userId, userId));
      } else {
        await db.insert(autoExecutorConfig).values({ userId, ...fields });
      }
      // Make the running executor see the change on the next signal (no 30s cache lag).
      globalAutoExecutor.invalidateConfigCache();
      return { success: true };
    }),

  // ─── Runtime state (in-memory counters) ───
  status: authedQuery.query(() => ({
    ...globalAutoExecutor.state,
    killSwitch: {
      isActive: globalKillSwitch.isActive,
      state: globalKillSwitch.state,
    },
    tradingMode: env.tradingMode,
    isPaperMode: env.tradingMode === "paper",
    isMonitorMode: env.tradingMode === "live_monitor",
    isAutoExecuteEnabled: env.autoExecute,
  })),

  // ─── Paper wallet — computed fresh from DB on every call (no in-memory cache) ───
  paperWallet: authedQuery
    .query(async ({ ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
          paperStartingBalance: autoExecutorConfig.paperStartingBalance,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      const starting = configRows[0]?.paperStartingBalance
        ? parseFloat(configRows[0].paperStartingBalance)
        : 100000;
      return getPaperWallet(ctx.user.id, starting, currency);
    }),

  // ─── Reset paper wallet — updates starting balance and clears in-memory state ───
  resetPaperWallet: authedQuery
    .input(z.object({ newBalance: z.number().default(10_000) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      await resetPaperWallet(ctx.user.id, input.newBalance, currency);
      return { success: true, balance: input.newBalance };
    }),

  // ─── Deposit virtual funds into paper wallet ───
  depositPaperFunds: authedQuery
    .input(z.object({ amount: z.number().positive().min(100).max(10_000_000), note: z.string().max(120).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      try {
        await depositPaperFunds(ctx.user.id, input.amount, currency, input.note);
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message ?? "Deposit failed" });
      }
      return { success: true };
    }),

  // ─── Paper wallet ledger entries (audit trail) ───
  paperWalletLedger: authedQuery
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      return getPaperLedger(ctx.user.id, input.limit, currency);
    }),

  // ─── Paper wallet snapshots (equity curve) ───
  paperWalletSnapshots: authedQuery
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      return getPaperSnapshots(ctx.user.id, input.limit, currency);
    }),

  // ─── Take a manual snapshot ───
  takePaperSnapshot: authedQuery
    .mutation(async ({ ctx }) => {
      const db = getDb();
      const configRows = await db
        .select({
          paperCurrency: autoExecutorConfig.paperCurrency,
        })
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, ctx.user.id))
        .limit(1);
      const currency = configRows[0]?.paperCurrency ?? "INR";
      await snapshotPaperWallet(ctx.user.id, currency);
      return { success: true };
    }),

  // ─── Live stream of execution decisions ───
  activityStream: authedQuery
    .subscription(() => {
      return observable((emit) => {
        const onDecision = (d: unknown) => emit.next(d);
        autoExecutorEvents.on("decision", onDecision);
        return () => autoExecutorEvents.off("decision", onDecision);
      });
    }),

  // ─── Kill switch ───
  killSwitch: authedQuery
    .input(
      z.object({
        action: z.enum(["trigger", "reset"]),
        reason: z.string().default("Manual emergency stop"),
      })
    )
    .mutation(({ input }) => {
      if (input.action === "trigger") {
        globalKillSwitch.trigger("manual", input.reason);
      } else {
        globalKillSwitch.reset();
      }
      return { isActive: globalKillSwitch.isActive, state: globalKillSwitch.state };
    }),

  killSwitchStatus: authedQuery.query(() => ({
    isActive: globalKillSwitch.isActive,
    state: globalKillSwitch.state,
  })),

  // ─── Kill switch stream ───
  killSwitchStream: authedQuery
    .subscription(() => {
      return observable((emit) => {
        const onTriggered = (s: unknown) => emit.next({ event: "triggered", state: s });
        const onReset = (s: unknown) => emit.next({ event: "reset", prev: s });
        killSwitchEvents.on("triggered", onTriggered);
        killSwitchEvents.on("reset", onReset);
        return () => {
          killSwitchEvents.off("triggered", onTriggered);
          killSwitchEvents.off("reset", onReset);
        };
      });
    }),

  // ─── Performance metrics ───
  metrics: authedQuery
    .query(async ({ ctx }) => {
      return computeMetrics(ctx.user.id);
    }),

  // ─── Equity curve (last N snapshots) ───
  equityCurve: authedQuery
    .input(z.object({ limit: z.number().default(200) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      return db
        .select({
          snapshotAt: equitySnapshots.snapshotAt,
          totalEquityUsdt: equitySnapshots.totalEquityUsdt,
          unrealizedPnl: equitySnapshots.unrealizedPnl,
          openPositionCount: equitySnapshots.openPositionCount,
        })
        .from(equitySnapshots)
        .where(eq(equitySnapshots.userId, ctx.user.id))
        .orderBy(desc(equitySnapshots.snapshotAt))
        .limit(input.limit)
        .then((r) => [...r].reverse()); // chronological
    }),

  // ─── Realized PnL grouped by symbol (closed positions, current mode) ───
  pnlBySymbol: authedQuery
    .input(z.object({ isPaper: z.boolean().default(true) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      return db
        .select({
          symbol: positions.symbol,
          trades: sql<number>`count(*)::int`,
          realizedPnl: sql<string>`coalesce(sum(${positions.realizedPnl}), 0)`,
          wins: sql<number>`count(*) filter (where ${positions.realizedPnl} > 0)::int`,
        })
        .from(positions)
        .where(and(eq(positions.userId, ctx.user.id), eq(positions.status, "closed"), eq(positions.isPaper, input.isPaper)))
        .groupBy(positions.symbol)
        .orderBy(desc(sql`coalesce(sum(${positions.realizedPnl}), 0)`))
        .catch(() => []);
    }),

  // ─── Realized PnL grouped by strategy (closed positions, current mode) ───
  pnlByStrategy: authedQuery
    .input(z.object({ isPaper: z.boolean().default(true) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      return db
        .select({
          strategy: positions.strategyType,
          trades: sql<number>`count(*)::int`,
          realizedPnl: sql<string>`coalesce(sum(${positions.realizedPnl}), 0)`,
          wins: sql<number>`count(*) filter (where ${positions.realizedPnl} > 0)::int`,
        })
        .from(positions)
        .where(and(eq(positions.userId, ctx.user.id), eq(positions.status, "closed"), eq(positions.isPaper, input.isPaper)))
        .groupBy(positions.strategyType)
        .orderBy(desc(sql`coalesce(sum(${positions.realizedPnl}), 0)`))
        .catch(() => []);
    }),
});
