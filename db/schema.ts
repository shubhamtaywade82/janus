import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  int,
  json,
  boolean,
} from "drizzle-orm/mysql-core";

// ─── Users Table (Auth) ───
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Market Data (OHLC Candlesticks) ───
export const marketData = mysqlTable("market_data", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., B-BTC_USDT
  timeframe: varchar("timeframe", { length: 10 }).notNull(), // 1m, 5m, 15m, 1h, 4h, 1d
  timestamp: timestamp("timestamp").notNull(),
  open: decimal("open", { precision: 18, scale: 8 }).notNull(),
  high: decimal("high", { precision: 18, scale: 8 }).notNull(),
  low: decimal("low", { precision: 18, scale: 8 }).notNull(),
  close: decimal("close", { precision: 18, scale: 8 }).notNull(),
  volume: decimal("volume", { precision: 24, scale: 8 }).notNull(),
  quoteVolume: decimal("quote_volume", { precision: 24, scale: 8 }).notNull(),
  tradeCount: int("trade_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MarketData = typeof marketData.$inferSelect;

// ─── Signals (Confluence Scores) ───
export const signals = mysqlTable("signals", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  microScore: decimal("micro_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  intraScore: decimal("intra_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  swingScore: decimal("swing_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  compositeScore: decimal("composite_score", { precision: 5, scale: 2 }).notNull(), // weighted sum
  threshold: decimal("threshold", { precision: 5, scale: 2 }).default("75.00").notNull(),
  isGated: boolean("is_gated").default(false).notNull(), // true if composite >= threshold
  direction: mysqlEnum("direction", ["long", "short", "neutral"]).default("neutral").notNull(),
  metadata: json("metadata"), // store indicator values
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Signal = typeof signals.$inferSelect;

// ─── Positions (Open Trades) ───
export const positions = mysqlTable("positions", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal("current_price", { precision: 18, scale: 8 }).notNull(),
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  leverage: int("leverage").default(1).notNull(),
  margin: decimal("margin", { precision: 18, scale: 8 }).notNull(),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
  liquidationPrice: decimal("liquidation_price", { precision: 18, scale: 8 }),
  stopLoss: decimal("stop_loss", { precision: 18, scale: 8 }),
  takeProfit: decimal("take_profit", { precision: 18, scale: 8 }),
  status: mysqlEnum("status", ["open", "closed", "liquidated"]).default("open").notNull(),
  exchangeOrderId: varchar("exchange_order_id", { length: 255 }),
  signalId: int("signal_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

export type Position = typeof positions.$inferSelect;

// ─── Trades (Trade History / Executions) ───
export const trades = mysqlTable("trades", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  positionId: int("position_id"),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  orderType: mysqlEnum("order_type", ["market", "limit", "stop"]).default("market").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  leverage: int("leverage").default(1).notNull(),
  fee: decimal("fee", { precision: 18, scale: 8 }).default("0").notNull(),
  total: decimal("total", { precision: 18, scale: 8 }).notNull(),
  status: mysqlEnum("status", ["pending", "filled", "partial", "cancelled", "rejected"]).default("pending").notNull(),
  exchangeOrderId: varchar("exchange_order_id", { length: 255 }),
  clientOrderId: varchar("client_order_id", { length: 255 }),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;

// ─── Order Book Snapshots ───
export const orderBookSnapshots = mysqlTable("order_book_snapshots", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  bids: json("bids").notNull(), // array of [price, size]
  asks: json("asks").notNull(),
  midPrice: decimal("mid_price", { precision: 18, scale: 8 }).notNull(),
  spread: decimal("spread", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OrderBookSnapshot = typeof orderBookSnapshots.$inferSelect;

// ─── System Logs (Audit Trail) ───
export const systemLogs = mysqlTable("system_logs", {
  id: serial("id").primaryKey(),
  level: mysqlEnum("level", ["info", "warn", "error", "critical", "debug"]).default("info").notNull(),
  component: varchar("component", { length: 50 }).notNull(), // e.g., "binance-ingestor", "confluence-engine"
  event: varchar("event", { length: 100 }).notNull(),
  message: text("message").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SystemLog = typeof systemLogs.$inferSelect;

// ─── Exchange Credentials (Encrypted) ───
export const exchangeCredentials = mysqlTable("exchange_credentials", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  exchange: mysqlEnum("exchange", ["coindcx", "binance"]).notNull(),
  apiKey: varchar("api_key", { length: 255 }).notNull(),
  apiSecret: varchar("api_secret", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ExchangeCredential = typeof exchangeCredentials.$inferSelect;

// ─── Recent Ticks (for trade tape) ───
export const recentTicks = mysqlTable("recent_ticks", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  isMaker: boolean("is_maker").default(false),
  tradeTime: timestamp("trade_time").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RecentTick = typeof recentTicks.$inferSelect;
