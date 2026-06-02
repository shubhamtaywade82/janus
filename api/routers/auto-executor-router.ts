import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { autoExecutorConfig, equitySnapshots } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import { globalAutoExecutor, autoExecutorEvents } from "../services/auto-executor";
import { globalKillSwitch, killSwitchEvents } from "../services/kill-switch";
import { computeMetrics } from "../services/performance-tracker";
import {
  getPaperWallet,
  resetPaperWallet,
  getPaperLedger,
  getPaperSnapshots,
  snapshotPaperWallet,
} from "../services/paper-wallet";
import { env } from "../lib/env";

export const autoExecutorRouter = createRouter({
  // ─── Get config ───
  getConfig: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(autoExecutorConfig)
        .where(eq(autoExecutorConfig.userId, input.userId))
        .limit(1);
      return rows[0] ?? null;
    }),

  // ─── Save / upsert config ───
  saveConfig: publicQuery
    .input(
      z.object({
        userId: z.number(),
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
        paperStartingBalance: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { userId, ...fields } = input;

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
      return { success: true };
    }),

  // ─── Runtime state (in-memory counters) ───
  status: publicQuery.query(() => ({
    ...globalAutoExecutor.state,
    killSwitch: {
      isActive: globalKillSwitch.isActive,
      state: globalKillSwitch.state,
    },
    isPaperMode: !env.placeOrders,
    isAutoExecuteEnabled: env.autoExecute,
  })),

  // ─── Paper wallet status (all primitive + derived metrics) ───
  paperWallet: publicQuery
    .input(z.object({ userId: z.number(), startingBalance: z.number().optional() }))
    .query(async ({ input }) => {
      return getPaperWallet(input.userId, input.startingBalance ?? 10_000);
    }),

  // ─── Reset paper wallet ───
  resetPaperWallet: publicQuery
    .input(z.object({ userId: z.number(), newBalance: z.number().default(10_000) }))
    .mutation(async ({ input }) => {
      await resetPaperWallet(input.userId, input.newBalance);
      return { success: true, balance: input.newBalance };
    }),

  // ─── Paper wallet ledger entries (audit trail) ───
  paperWalletLedger: publicQuery
    .input(z.object({ userId: z.number(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return getPaperLedger(input.userId, input.limit);
    }),

  // ─── Paper wallet snapshots (equity curve) ───
  paperWalletSnapshots: publicQuery
    .input(z.object({ userId: z.number(), limit: z.number().default(100) }))
    .query(async ({ input }) => {
      return getPaperSnapshots(input.userId, input.limit);
    }),

  // ─── Take a manual snapshot ───
  takePaperSnapshot: publicQuery
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      await snapshotPaperWallet(input.userId);
      return { success: true };
    }),

  // ─── Live stream of execution decisions ───
  activityStream: publicQuery
    .input(z.void())
    .subscription(() => {
      return observable((emit) => {
        const onDecision = (d: unknown) => emit.next(d);
        autoExecutorEvents.on("decision", onDecision);
        return () => autoExecutorEvents.off("decision", onDecision);
      });
    }),

  // ─── Kill switch ───
  killSwitch: publicQuery
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

  killSwitchStatus: publicQuery.query(() => ({
    isActive: globalKillSwitch.isActive,
    state: globalKillSwitch.state,
  })),

  // ─── Kill switch stream ───
  killSwitchStream: publicQuery
    .input(z.void())
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
  metrics: publicQuery
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return computeMetrics(input.userId);
    }),

  // ─── Equity curve (last N snapshots) ───
  equityCurve: publicQuery
    .input(z.object({ userId: z.number(), limit: z.number().default(200) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          snapshotAt: equitySnapshots.snapshotAt,
          totalEquityUsdt: equitySnapshots.totalEquityUsdt,
          unrealizedPnl: equitySnapshots.unrealizedPnl,
          openPositionCount: equitySnapshots.openPositionCount,
        })
        .from(equitySnapshots)
        .where(eq(equitySnapshots.userId, input.userId))
        .orderBy(desc(equitySnapshots.snapshotAt))
        .limit(input.limit)
        .then((r) => [...r].reverse()); // chronological
    }),
});
