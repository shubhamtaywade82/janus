// ─── Position Manager DB Tables (separate schema — do not modify db/schema.ts)
// Add to db/relations.ts if you need Drizzle relations.
// Run: npx drizzle-kit push --config drizzle.config.ts

import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// ─── AI Position Assessments ───
export const aiAssessments = pgTable(
  "ai_assessments",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    lifecycleState: varchar("lifecycle_state", { length: 20 }).notNull(),
    biasScore: decimal("bias_score", { precision: 6, scale: 2 }).notNull(),
    biasLabel: varchar("bias_label", { length: 20 }).notNull(),
    biasConfidence: decimal("bias_confidence", { precision: 5, scale: 4 }).notNull(),
    recommendedAction: varchar("recommended_action", { length: 30 }).notNull(),
    policyAction: varchar("policy_action", { length: 30 }).notNull(),
    policyApproved: boolean("policy_approved").default(true).notNull(),
    confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }).notNull(),
    aiSource: varchar("ai_source", { length: 10 }).notNull().default("CODE"),
    reasoning: text("reasoning").notNull(),
    opportunityCostVerdict: varchar("opportunity_cost_verdict", { length: 10 }),
    marketContextSnapshot: jsonb("market_context_snapshot"),
    assessedAt: timestamp("assessed_at").defaultNow().notNull(),
  },
  (table) => ({
    positionAssessedIdx: index("idx_ai_assessments_position").on(table.positionId, table.assessedAt),
    symbolAssessedIdx: index("idx_ai_assessments_symbol").on(table.symbol, table.assessedAt),
  })
);

export type AiAssessment = typeof aiAssessments.$inferSelect;

// ─── Position Snapshots ───
export const positionSnapshots = pgTable(
  "position_snapshots",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    markPrice: decimal("mark_price", { precision: 18, scale: 8 }).notNull(),
    unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).notNull(),
    roe: decimal("roe", { precision: 8, scale: 4 }).notNull(),
    stopLoss: decimal("stop_loss", { precision: 18, scale: 8 }),
    takeProfit: decimal("take_profit", { precision: 18, scale: 8 }),
    lifecycleState: varchar("lifecycle_state", { length: 20 }).notNull(),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  },
  (table) => ({
    positionSnapshotIdx: index("idx_position_snapshots_position").on(table.positionId, table.snapshotAt),
  })
);

export type PositionSnapshot = typeof positionSnapshots.$inferSelect;

// ─── Position Actions Log ───
export const positionActionLogs = pgTable(
  "position_action_logs",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    action: varchar("action", { length: 30 }).notNull(),
    source: varchar("source", { length: 10 }).notNull().default("CODE"),
    confidence: decimal("confidence", { precision: 5, scale: 4 }),
    reasoning: text("reasoning"),
    result: varchar("result", { length: 10 }).notNull().default("ok"),
    detail: text("detail"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => ({
    positionActionIdx: index("idx_position_action_logs_position").on(table.positionId, table.executedAt),
  })
);

export type PositionActionLog = typeof positionActionLogs.$inferSelect;
