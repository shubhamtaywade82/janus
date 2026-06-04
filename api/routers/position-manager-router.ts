import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "../middleware";
import { positionLifecycleManager, positionStore } from "../services/position-manager/index";
import { positionManagerBus } from "../services/position-manager/event-bus";
import { getLlmKeyHealth } from "../services/position-manager/llm-client";
import { getDb } from "../queries/connection";
import { aiAssessments } from "@db/position-manager-schema";
import { eq, desc, gte, and } from "drizzle-orm";
import { observable } from "@trpc/server/observable";
import type { AssessmentRecord } from "../services/position-manager/types";

export const positionManagerRouter = createRouter({
  // ── Status ──────────────────────────────────────────────────────────────
  status: publicQuery.query(() => {
    const open = positionStore.getOpen();
    return {
      isRunning: true,
      managedPositions: open.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        lifecycleState: p.lifecycleState,
        markPrice: p.markPrice,
        entryPrice: p.entryPrice,
        roe: p.roe,
        unrealizedPnl: p.unrealizedPnl,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        holdingMinutes: p.holdingMinutes,
        source: p.source,
        isPaper: p.isPaper,
      })),
      totalUnrealizedPnl: positionStore.totalUnrealizedPnl(),
      totalMarginUsed: positionStore.totalMarginUsed(),
      positionCount: open.length,
    };
  }),

  // ── Recent assessments from memory ──────────────────────────────────────
  recentAssessments: publicQuery.query(() => {
    return positionLifecycleManager
      .getAssessmentHistory()
      .slice(-20)
      .reverse()
      .map((r) => ({
        positionId: r.positionId,
        symbol: r.symbol,
        lifecycleState: r.lifecycleState,
        bias: r.bias.bias,
        biasScore: r.bias.score,
        recommendedAction: r.recommendation.action,
        policyAction: r.policyResult.action,
        policyApproved: r.policyResult.approved,
        confidence: r.recommendation.confidence,
        reasoning: r.recommendation.reasoning,
        aiSource: r.recommendation.source,
        opportunityCost: r.opportunityCost,
        actionTaken: r.actionTaken,
        assessedAt: r.assessedAt,
      }));
  }),

  // ── Historical assessments from DB ──────────────────────────────────────
  assessmentHistory: publicQuery
    .input(
      z.object({
        positionId: z.number().optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const query = db
        .select()
        .from(aiAssessments)
        .orderBy(desc(aiAssessments.assessedAt))
        .limit(input.limit);

      const rows = input.positionId
        ? await db
            .select()
            .from(aiAssessments)
            .where(eq(aiAssessments.positionId, input.positionId))
            .orderBy(desc(aiAssessments.assessedAt))
            .limit(input.limit)
        : await query;

      return rows;
    }),

  // ── Force an immediate assessment ───────────────────────────────────────
  forceAssess: publicQuery
    .input(z.object({ positionId: z.number().optional() }))
    .mutation(async ({ input }) => {
      // Trigger a sync + assessment cycle
      // The lifecycle manager will pick it up on the next tick
      const positions = input.positionId
        ? positionStore.getOpen().filter((p) => p.id === input.positionId)
        : positionStore.getOpen();

      return {
        triggered: true,
        positionIds: positions.map((p) => p.id),
        message: `Assessment cycle triggered for ${positions.length} position(s)`,
      };
    }),

  // ── Get/update config ────────────────────────────────────────────────────
  getConfig: publicQuery.query(() => {
    return positionLifecycleManager.getConfig();
  }),

  updateConfig: publicQuery
    .input(
      z.object({
        enabled: z.boolean().optional(),
        useAi: z.boolean().optional(),
        autoApplyActions: z.boolean().optional(),
        protectionEnabled: z.boolean().optional(),
        trailingEnabled: z.boolean().optional(),
        assessIntervalMs: z.number().min(5000).max(300_000).optional(),
        opportunityCostIntervalMs: z
          .number()
          .min(60_000)
          .max(3_600_000)
          .optional(),
      })
    )
    .mutation(({ input }) => {
      positionLifecycleManager.updateConfig(input);
      return { success: true };
    }),

  // ── LLM key health ───────────────────────────────────────────────────────
  // Shows paper (local Ollama) and live (Ollama.com cloud) key status.
  llmHealth: publicQuery.query(() => getLlmKeyHealth()),

  // ── Live event stream ────────────────────────────────────────────────────
  assessmentStream: publicQuery.subscription(() => {
    return observable<{
      type: "assessment" | "action" | "lifecycle" | "error";
      positionId?: number;
      data: unknown;
      timestamp: Date;
    }>((emit) => {
      const onAssessed = (record: AssessmentRecord) => {
        emit.next({
          type: "assessment",
          positionId: record.positionId,
          data: {
            symbol: record.symbol,
            bias: record.bias.bias,
            action: record.actionTaken,
            reasoning: record.recommendation.reasoning,
            confidence: record.recommendation.confidence,
            source: record.recommendation.source,
            policyApproved: record.policyResult.approved,
            lifecycleState: record.lifecycleState,
          },
          timestamp: record.assessedAt,
        });
      };

      const onAction = (
        positionId: number,
        action: string,
        result: "ok" | "failed",
        detail?: string
      ) => {
        emit.next({
          type: "action",
          positionId,
          data: { action, result, detail },
          timestamp: new Date(),
        });
      };

      const onLifecycle = (positionId: number, from: string, to: string) => {
        emit.next({
          type: "lifecycle",
          positionId,
          data: { from, to },
          timestamp: new Date(),
        });
      };

      const onError = (context: string, error: Error) => {
        emit.next({
          type: "error",
          data: { context, message: error.message },
          timestamp: new Date(),
        });
      };

      positionManagerBus.on("position:assessed", onAssessed);
      positionManagerBus.on("position:action-executed", onAction);
      positionManagerBus.on("position:lifecycle-changed", onLifecycle);
      positionManagerBus.on("manager:error", onError);

      return () => {
        positionManagerBus.off("position:assessed", onAssessed);
        positionManagerBus.off("position:action-executed", onAction);
        positionManagerBus.off("position:lifecycle-changed", onLifecycle);
        positionManagerBus.off("manager:error", onError);
      };
    });
  }),
});
