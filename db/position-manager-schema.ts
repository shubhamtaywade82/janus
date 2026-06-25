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

// ─── Position Transaction Ledger ───
// Immutable record of every material change to a position.
// Used for audit trails, tax reporting, PnL attribution, and cost-basis tracking.

export const positionTransactions = pgTable(
  "position_transactions",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id").notNull(),
    userId: integer("user_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // OPEN, SCALE_IN, PARTIAL_EXIT, FULL_EXIT, SL_UPDATE, TP_UPDATE, LIQUIDATED
    side: varchar("side", { length: 10 }).notNull(), // long, short
    quantityBefore: decimal("quantity_before", { precision: 18, scale: 8 }).default("0"),
    quantityAfter: decimal("quantity_after", { precision: 18, scale: 8 }).default("0"),
    quantityDelta: decimal("quantity_delta", { precision: 18, scale: 8 }).default("0"), // + = added, - = removed
    price: decimal("price", { precision: 18, scale: 8 }), // entry/exit price for this transaction
    avgEntryPrice: decimal("avg_entry_price", { precision: 18, scale: 8 }), // weighted avg after this tx
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0"),
    fee: decimal("fee", { precision: 18, scale: 8 }).default("0"),
    marginBefore: decimal("margin_before", { precision: 18, scale: 8 }).default("0"),
    marginAfter: decimal("margin_after", { precision: 18, scale: 8 }).default("0"),
    metadata: jsonb("metadata"), // { oldSl, newSl, oldTp, newTp, reason, exchangeOrderId, etc. }
    // ─── PTA extensions ──────────────────────────────────────────────────────
    orderId: integer("order_id"), // FK to existing orders table
    liquiditySide: varchar("liquidity_side", { length: 10 }),
    // MAKER | TAKER
    fillModel: varchar("fill_model", { length: 30 }),
    // MARK_PRICE | ORDERBOOK_WALK | SLIPPAGE_PENALTY | VWAP_ESTIMATE | WORST_CASE
    simulatedSlippageBps: decimal("simulated_slippage_bps", { precision: 10, scale: 4 }),
    fillLatencyMs: integer("fill_latency_ms"),
    // ─── PTA execution mode ──────────────────────────────────────────────────
    executionMode: varchar("execution_mode", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    positionTxIdx: index("idx_position_transactions_position").on(table.positionId, table.createdAt),
    userTxIdx: index("idx_position_transactions_user").on(table.userId, table.createdAt),
    symbolTxIdx: index("idx_position_transactions_symbol").on(table.symbol, table.createdAt),
    orderTxIdx: index("idx_position_transactions_order").on(table.orderId),
  })
);

export type PositionTransaction = typeof positionTransactions.$inferSelect;
