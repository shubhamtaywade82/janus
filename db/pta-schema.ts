// ─── PTA-only tables ─────────────────────────────────────────────────────────
// These tables do not duplicate any existing schema.
// trade_price_ticks  → MFE/MAE sampling (no existing table covers this)
// funding_events     → 8h funding settlements per trade (new concept)
// system_events      → infra/operational health (system_logs is app logs, not infra)
//
// ⚠ Derived layer (VIEW / materialized views) lives in
//   `db/migrations/0027_pta_derived_layer.sql` and is re-applied via
//   `psql < db/migrations/0027_pta_derived_layer.sql` when needed.
// This file ONLY exposes Drizzle-tracked tables so `db:push` does not
// introspect non-table objects as drift.

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
  uuid,
  bigint,
  unique,
} from "drizzle-orm/pg-core";

// ─── Trade Price Ticks ───────────────────────────────────────────────────────
// High-frequency price samples while a trade is open.
export const tradePriceTicks = pgTable(
  "trade_price_ticks",
  {
    id: serial("id").primaryKey(),
    tradeId: uuid("trade_id").notNull(), // matches pta_trades.id (UUID) once wired; nullable until then
    observedAt: timestamp("observed_at").notNull(),
    markPrice: decimal("mark_price", { precision: 18, scale: 8 }).notNull(),
    indexPrice: decimal("index_price", { precision: 18, scale: 8 }),
    fundingRate: decimal("funding_rate", { precision: 12, scale: 8 }),
    pnlPctFromEntry: decimal("pnl_pct_from_entry", { precision: 8, scale: 4 }),
  },
  (table) => ({
    idxTicksTradeTime: index("idx_ticks_trade_time").on(table.tradeId, table.observedAt),
  })
);

export type TradePriceTick = typeof tradePriceTicks.$inferSelect;

// ─── Funding Events ──────────────────────────────────────────────────────────
export const fundingEvents = pgTable(
  "funding_events",
  {
    id: serial("id").primaryKey(),
    tradeId: uuid("trade_id").notNull(),
    instrumentId: integer("instrument_id").notNull(),
    settledAt: timestamp("settled_at").notNull(),
    fundingRate: decimal("funding_rate", { precision: 12, scale: 8 }).notNull(),
    positionSize: decimal("position_size", { precision: 18, scale: 8 }).notNull(),
    amountUsdt: decimal("amount_usdt", { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idxFundingTrade: index("idx_funding_trade").on(table.tradeId, table.settledAt),
  })
);

export type FundingEvent = typeof fundingEvents.$inferSelect;

// ─── System Events ───────────────────────────────────────────────────────────
export const systemEvents = pgTable(
  "system_events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    component: varchar("component", { length: 50 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull().default("INFO"),
    symbol: varchar("symbol", { length: 20 }),
    message: text("message").notNull(),
    metadata: jsonb("metadata").default("{}"),
  },
  (table) => ({
    idxSysEventsTime: index("idx_sys_events_time").on(table.occurredAt),
    idxSysEventsComponent: index("idx_sys_events_component").on(table.component, table.occurredAt),
  })
);

export type SystemEvent = typeof systemEvents.$inferSelect;
