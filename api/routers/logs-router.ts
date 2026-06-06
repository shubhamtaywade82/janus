import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { systemLogs } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";

export const logsRouter = createRouter({
  // ─── Get system logs ───
  list: authedQuery
    .input(
      z.object({
        level: z.enum(["info", "warn", "error", "critical", "debug"]).optional(),
        component: z.string().optional(),
        limit: z.number().default(100),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.level) conditions.push(eq(systemLogs.level, input.level));
      if (input.component) conditions.push(eq(systemLogs.component, input.component));

      const query = db
        .select()
        .from(systemLogs)
        .orderBy(desc(systemLogs.createdAt))
        .limit(input.limit);

      if (conditions.length > 0) {
        return query.where(and(...conditions));
      }
      return query;
    }),

  // ─── Create a log entry ───
  create: authedQuery
    .input(
      z.object({
        level: z.enum(["info", "warn", "error", "critical", "debug"]).default("info"),
        component: z.string(),
        event: z.string(),
        message: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(systemLogs).values({
        level: input.level,
        component: input.component,
        event: input.event,
        message: input.message,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
      return { success: true, ...input };
    }),

  // ─── Get log statistics ───
  stats: authedQuery.query(async () => {
    const db = getDb();
    const allLogs = await db
      .select()
      .from(systemLogs)
      .orderBy(desc(systemLogs.createdAt))
      .limit(1000);

    const byLevel = {
      info: allLogs.filter((l) => l.level === "info").length,
      warn: allLogs.filter((l) => l.level === "warn").length,
      error: allLogs.filter((l) => l.level === "error").length,
      critical: allLogs.filter((l) => l.level === "critical").length,
      debug: allLogs.filter((l) => l.level === "debug").length,
    };

    const byComponent: Record<string, number> = {};
    for (const log of allLogs) {
      byComponent[log.component] = (byComponent[log.component] || 0) + 1;
    }

    return {
      total: allLogs.length,
      byLevel,
      byComponent,
      recentErrors: allLogs
        .filter((l) => l.level === "error" || l.level === "critical")
        .slice(0, 10),
    };
  }),

  // ─── Get recent logs for a component ───
  component: authedQuery
    .input(
      z.object({
        component: z.string(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(systemLogs)
        .where(eq(systemLogs.component, input.component))
        .orderBy(desc(systemLogs.createdAt))
        .limit(input.limit);
    }),
});
