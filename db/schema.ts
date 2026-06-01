import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
  jsonb,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";

// ─── Enums (PostgreSQL custom types) ───
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const directionEnum = pgEnum("direction", ["long", "short", "neutral"]);
export const positionSideEnum = pgEnum("position_side", ["long", "short"]);
export const positionStatusEnum = pgEnum("position_status", ["open", "closed", "liquidated"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit", "stop"]);
export const tradeStatusEnum = pgEnum("trade_status", ["pending", "filled", "partial", "cancelled", "rejected"]);
export const logLevelEnum = pgEnum("log_level", ["info", "warn", "error", "critical", "debug"]);
export const exchangeEnum = pgEnum("exchange", ["coindcx", "binance"]);
export const marginModeEnum = pgEnum("margin_mode", ["isolated", "cross"]);
export const marginCurrencyEnum = pgEnum("margin_currency", ["USDT", "INR"]);
export const strategyTypeEnum = pgEnum("strategy_type", ["scalping", "intraday", "swing"]);

// ─── Users Table (Auth) ───
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
  telegramBotToken: varchar("telegram_bot_token", { length: 255 }),
  telegramChatId: varchar("telegram_chat_id", { length: 50 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Market Data (OHLC Candlesticks) ───
export const marketData = pgTable(
  "market_data",
  {
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
    tradeCount: integer("trade_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    symbolTimeframeTimestampIdx: index("idx_market_data_lookup").on(table.symbol, table.timeframe, table.timestamp),
    uqMarketData: unique("uq_market_data").on(table.symbol, table.timeframe, table.timestamp),
  })
);

export type MarketData = typeof marketData.$inferSelect;

// ─── Signals (Confluence Scores) ───
export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  microScore: decimal("micro_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  intraScore: decimal("intra_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  swingScore: decimal("swing_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  compositeScore: decimal("composite_score", { precision: 5, scale: 2 }).notNull(), // weighted sum
  threshold: decimal("threshold", { precision: 5, scale: 2 }).default("75.00").notNull(),
  isGated: boolean("is_gated").default(false).notNull(), // true if composite >= threshold
  direction: directionEnum("direction").default("neutral").notNull(),
  metadata: jsonb("metadata"), // store indicator values
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Signal = typeof signals.$inferSelect;

// ─── Positions (Open Trades) ───
export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: positionSideEnum("side").notNull(),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    currentPrice: decimal("current_price", { precision: 18, scale: 8 }).notNull(),
    size: decimal("size", { precision: 18, scale: 8 }).notNull(),
    leverage: integer("leverage").default(1).notNull(),
    margin: decimal("margin", { precision: 18, scale: 8 }).notNull(),
    unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    liquidationPrice: decimal("liquidation_price", { precision: 18, scale: 8 }),
    stopLoss: decimal("stop_loss", { precision: 18, scale: 8 }),
    takeProfit: decimal("take_profit", { precision: 18, scale: 8 }),
    status: positionStatusEnum("status").default("open").notNull(),
    exchangeOrderId: varchar("exchange_order_id", { length: 255 }),
    signalId: integer("signal_id"),
    // ─── CoinDCX Futures Margin Fields ───
    lockedMargin: decimal("locked_margin", { precision: 18, scale: 8 }),
    maintenanceMargin: decimal("maintenance_margin", { precision: 18, scale: 8 }),
    lockedOrderMargin: decimal("locked_order_margin", { precision: 18, scale: 8 }),
    crossUserMargin: decimal("cross_user_margin", { precision: 18, scale: 8 }),
    crossOrderMargin: decimal("cross_order_margin", { precision: 18, scale: 8 }),
    marginMode: marginModeEnum("margin_mode").default("isolated"),
    marginCurrency: marginCurrencyEnum("margin_currency").default("USDT"),
    settlementCurrencyConversionPrice: decimal("settlement_currency_conversion_price", { precision: 18, scale: 8 }),
    settlementCurrencyAvgPrice: decimal("settlement_currency_avg_price", { precision: 18, scale: 8 }),
    priceInInr: decimal("price_in_inr", { precision: 18, scale: 8 }),
    strategyType: strategyTypeEnum("strategy_type").default("intraday"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    userIdStatusIdx: index("idx_positions_user_status").on(table.userId, table.status),
    symbolIdx: index("idx_positions_symbol").on(table.symbol),
  })
);

export type Position = typeof positions.$inferSelect;

// ─── Trades (Trade History / Executions) ───
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    positionId: integer("position_id"),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: tradeSideEnum("side").notNull(),
    orderType: orderTypeEnum("order_type").default("market").notNull(),
    price: decimal("price", { precision: 18, scale: 8 }).notNull(),
    size: decimal("size", { precision: 18, scale: 8 }).notNull(),
    leverage: integer("leverage").default(1).notNull(),
    fee: decimal("fee", { precision: 18, scale: 8 }).default("0").notNull(),
    tdsDeducted: decimal("tds_deducted", { precision: 18, scale: 8 }).default("0").notNull(),
    total: decimal("total", { precision: 18, scale: 8 }).notNull(),
    status: tradeStatusEnum("status").default("pending").notNull(),
    exchangeOrderId: varchar("exchange_order_id", { length: 255 }),
    clientOrderId: varchar("client_order_id", { length: 255 }),
    executedAt: timestamp("executed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdPositionIdIdx: index("idx_trades_user_position").on(table.userId, table.positionId),
  })
);

export type Trade = typeof trades.$inferSelect;

// ─── Order Book Snapshots ───
export const orderBookSnapshots = pgTable("order_book_snapshots", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  bids: jsonb("bids").notNull(), // array of [price, size]
  asks: jsonb("asks").notNull(),
  midPrice: decimal("mid_price", { precision: 18, scale: 8 }).notNull(),
  spread: decimal("spread", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OrderBookSnapshot = typeof orderBookSnapshots.$inferSelect;

// ─── System Logs (Audit Trail) ───
export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  level: logLevelEnum("level").default("info").notNull(),
  component: varchar("component", { length: 50 }).notNull(), // e.g., "binance-ingestor", "confluence-engine"
  event: varchar("event", { length: 100 }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SystemLog = typeof systemLogs.$inferSelect;

// ─── Exchange Credentials (Encrypted) ───
export const exchangeCredentials = pgTable("exchange_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  exchange: exchangeEnum("exchange").notNull(),
  apiKey: varchar("api_key", { length: 255 }).notNull(),
  apiSecret: varchar("api_secret", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ExchangeCredential = typeof exchangeCredentials.$inferSelect;

// ─── Recent Ticks (for trade tape) ───
export const recentTicks = pgTable(
  "recent_ticks",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    price: decimal("price", { precision: 18, scale: 8 }).notNull(),
    size: decimal("size", { precision: 18, scale: 8 }).notNull(),
    side: tradeSideEnum("side").notNull(),
    isMaker: boolean("is_maker").default(false),
    tradeTime: timestamp("trade_time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    symbolTradeTimeIdx: index("idx_recent_ticks_lookup").on(table.symbol, table.tradeTime),
  })
);

export type RecentTick = typeof recentTicks.$inferSelect;

// ─── Futures Wallets (CoinDCX INR/USDT Margined) ───
export const futuresWallets = pgTable("futures_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  exchange: exchangeEnum("exchange").notNull(),
  marginCurrency: marginCurrencyEnum("margin_currency").default("USDT").notNull(),
  balance: decimal("balance", { precision: 18, scale: 8 }).default("0").notNull(),
  lockedBalance: decimal("locked_balance", { precision: 18, scale: 8 }).default("0").notNull(),
  totalAccountEquity: decimal("total_account_equity", { precision: 18, scale: 8 }).default("0").notNull(),
  availableBalanceCross: decimal("available_balance_cross", { precision: 18, scale: 8 }).default("0").notNull(),
  marginRatioCross: decimal("margin_ratio_cross", { precision: 5, scale: 4 }).default("0").notNull(),
  withdrawableBalance: decimal("withdrawable_balance", { precision: 18, scale: 8 }).default("0").notNull(),
  crossUserMargin: decimal("cross_user_margin", { precision: 18, scale: 8 }).default("0").notNull(),
  crossOrderMargin: decimal("cross_order_margin", { precision: 18, scale: 8 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FuturesWallet = typeof futuresWallets.$inferSelect;

// ─── Transactions (Audit Trail & PnL Ledger) ───
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  positionId: integer("position_id").references(() => positions.id),
  symbol: varchar("symbol", { length: 20 }),
  stage: varchar("stage", { length: 20 }), // Funding, Exit, Liquidation, etc.
  amount: decimal("amount", { precision: 18, scale: 8 }), // PnL amount
  feeAmount: decimal("fee_amount", { precision: 18, scale: 8 }),
  priceReference: decimal("price_reference", { precision: 18, scale: 8 }),
  source: varchar("source", { length: 10 }), // 'user' or 'system'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
