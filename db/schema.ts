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
export const strategyTypeEnum = pgEnum("strategy_type", [
  "scalping",
  "intraday",
  "swing",
  "grid",
  "momentum_reversal",
  "bb_reversion",
  "ml_sizing",
  "scalping_micro",
]);

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
  telegramLiquidityAlertsEnabled: boolean("telegram_liquidity_alerts_enabled").default(true).notNull(),
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
export const signalOutcomeEnum = pgEnum("signal_outcome", [
  "tp_hit",
  "sl_hit",
  "manual_close",
  "liquidated",
  "timeout",
  "open",
]);

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
  outcome: signalOutcomeEnum("outcome"), // set when linked position is closed
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
    isPaper: boolean("is_paper").default(false).notNull(),
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
  // Extended wallet fields synced from CoinDCX
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
  maintenanceMargin: decimal("maintenance_margin", { precision: 18, scale: 8 }).default("0").notNull(),
  initialMargin: decimal("initial_margin", { precision: 18, scale: 8 }).default("0").notNull(),
  liquidationValue: decimal("liquidation_value", { precision: 18, scale: 8 }).default("0").notNull(),
  accountType: varchar("account_type", { length: 20 }).default("cross").notNull(),
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

// ─── LLM API Keys (Ollama / OpenAI / Anthropic with rotation) ───
export const llmApiKeys = pgTable("llm_api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 30 }).notNull().default("ollama"),
  endpoint: varchar("endpoint", { length: 500 }).notNull(),
  apiKey: varchar("api_key", { length: 500 }).default(""),
  model: varchar("model", { length: 100 }).notNull().default("llama3"),
  priority: integer("priority").notNull().default(1),
  isActive: boolean("is_active").default(true).notNull(),
  requestCount: integer("request_count").default(0).notNull(),
  errorCount: integer("error_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LlmApiKey = typeof llmApiKeys.$inferSelect;

// ─── Auto-Executor Config (per user) ───
export const autoExecutorConfig = pgTable("auto_executor_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  targetSymbols: jsonb("target_symbols").$type<string[]>().default(["BTCUSDT", "ETHUSDT"]),
  defaultSizeUsdt: decimal("default_size_usdt", { precision: 12, scale: 2 }).default("50"),
  defaultLeverage: integer("default_leverage").default(3),
  stopLossPct: decimal("stop_loss_pct", { precision: 5, scale: 3 }).default("0.015"),
  tp1Pct: decimal("tp1_pct", { precision: 5, scale: 3 }).default("0.015"),
  tp2Pct: decimal("tp2_pct", { precision: 5, scale: 3 }).default("0.030"),
  useLlmAdvisor: boolean("use_llm_advisor").default(true).notNull(),
  llmConfidenceThreshold: integer("llm_confidence_threshold").default(70),
  maxPositionsPerSymbol: integer("max_positions_per_symbol").default(1),
  maxTotalPositions: integer("max_total_positions").default(3),
  capitalAllocationPct: decimal("capital_allocation_pct", { precision: 5, scale: 3 }).default("0.100"), // fraction of free balance per trade, e.g. 0.100 = 10%
  useStrategyLeverage: boolean("use_strategy_leverage").default(true).notNull(), // true = use STRATEGY_CONFIGS[strategy].maxLeverage, false = use defaultLeverage
  paperStartingBalance: decimal("paper_starting_balance", { precision: 12, scale: 2 }).default("10000"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AutoExecutorConfig = typeof autoExecutorConfig.$inferSelect;

// ─── Equity Snapshots (for equity curve + performance metrics) ───
export const equitySnapshots = pgTable("equity_snapshots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  totalEquityUsdt: decimal("total_equity_usdt", { precision: 18, scale: 4 }).notNull(),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 4 }).default("0"),
  realizedPnlToday: decimal("realized_pnl_today", { precision: 18, scale: 4 }).default("0"),
  openPositionCount: integer("open_position_count").default(0),
  metadata: jsonb("metadata"),
},
(table) => ({
  userSnapshotIdx: index("idx_equity_snapshots_user_time").on(table.userId, table.snapshotAt),
}));

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;

// ─── Trading Accounts (unified live/paper/backtest wallet model) ───
export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    // live | paper | backtest — only execution provider changes
    mode: varchar("mode", { length: 20 }).default("paper").notNull(),
    currency: marginCurrencyEnum("currency").default("USDT").notNull(),
    initialBalance: decimal("initial_balance", { precision: 18, scale: 8 }).notNull(),
    // walletBalance = initialBalance + cumulative realized PnL + deposits - withdrawals
    walletBalance: decimal("wallet_balance", { precision: 18, scale: 8 }).notNull(),
    // availableBalance = equity - lockedMargin
    availableBalance: decimal("available_balance", { precision: 18, scale: 8 }).notNull(),
    lockedMargin: decimal("locked_margin", { precision: 18, scale: 8 }).default("0").notNull(),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    // equity = walletBalance + unrealizedPnl
    equity: decimal("equity", { precision: 18, scale: 8 }).notNull(),
    usedMargin: decimal("used_margin", { precision: 18, scale: 8 }).default("0").notNull(),
    freeMargin: decimal("free_margin", { precision: 18, scale: 8 }).default("0").notNull(),
    peakEquity: decimal("peak_equity", { precision: 18, scale: 8 }).notNull(),
    drawdown: decimal("drawdown", { precision: 18, scale: 8 }).default("0").notNull(),
    totalFeesPaid: decimal("total_fees_paid", { precision: 18, scale: 8 }).default("0").notNull(),
    totalFundingPaid: decimal("total_funding_paid", { precision: 18, scale: 8 }).default("0").notNull(),
    tradeCount: integer("trade_count").default(0).notNull(),
    winCount: integer("win_count").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userModeIdx: index("idx_trading_accounts_user_mode").on(table.userId, table.mode),
  })
);

export type TradingAccount = typeof tradingAccounts.$inferSelect;

// ─── Account Ledger (event-driven audit trail — identical for live and paper) ───
export const accountLedger = pgTable(
  "account_ledger",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => tradingAccounts.id).notNull(),
    // deposit | reserve_margin | release_margin | fill | fee | funding | pnl_realization | withdrawal | reset
    eventType: varchar("event_type", { length: 30 }).notNull(),
    debit: decimal("debit", { precision: 18, scale: 8 }).default("0").notNull(),
    credit: decimal("credit", { precision: 18, scale: 8 }).default("0").notNull(),
    balanceBefore: decimal("balance_before", { precision: 18, scale: 8 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 18, scale: 8 }).notNull(),
    // order | position | manual | adjustment
    referenceType: varchar("reference_type", { length: 20 }),
    referenceId: integer("reference_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    accountLedgerIdx: index("idx_account_ledger_account").on(table.accountId, table.createdAt),
  })
);

export type AccountLedgerEntry = typeof accountLedger.$inferSelect;

// ─── Account Snapshots (periodic state captures for dashboard + backtesting) ───
export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => tradingAccounts.id).notNull(),
    equity: decimal("equity", { precision: 18, scale: 8 }).notNull(),
    availableBalance: decimal("available_balance", { precision: 18, scale: 8 }).notNull(),
    lockedMargin: decimal("locked_margin", { precision: 18, scale: 8 }).notNull(),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).notNull(),
    unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).notNull(),
    openPositionsCount: integer("open_positions_count").default(0).notNull(),
    drawdown: decimal("drawdown", { precision: 18, scale: 8 }).default("0").notNull(),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  },
  (table) => ({
    accountSnapshotIdx: index("idx_account_snapshots_account_time").on(table.accountId, table.snapshotAt),
  })
);

export type AccountSnapshot = typeof accountSnapshots.$inferSelect;

// ─── Open Interest Data (Binance Futures, polled every 30s) ───
export const openInterestData = pgTable(
  "open_interest_data",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    openInterest: decimal("open_interest", { precision: 24, scale: 4 }).notNull(),
    quoteOI: decimal("quote_oi", { precision: 24, scale: 4 }),
    timestamp: timestamp("timestamp").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    symbolTimestampIdx: index("idx_oi_symbol_timestamp").on(table.symbol, table.timestamp),
  })
);

export type OpenInterestData = typeof openInterestData.$inferSelect;

// ─── Funding Rate History (persisted from @markPrice WS stream) ───
export const fundingRateHistory = pgTable(
  "funding_rate_history",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    fundingRate: decimal("funding_rate", { precision: 18, scale: 8 }).notNull(),
    markPrice: decimal("mark_price", { precision: 18, scale: 8 }).notNull(),
    nextFundingTime: timestamp("next_funding_time").notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => ({
    symbolTimestampIdx: index("idx_funding_symbol_timestamp").on(table.symbol, table.timestamp),
  })
);

export type FundingRateHistory = typeof fundingRateHistory.$inferSelect;

// ─── Liquidation Events (persisted from @forceOrder WS stream) ───
export const liquidationEvents = pgTable(
  "liquidation_events",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: varchar("side", { length: 10 }).notNull(), // BUY = short liq, SELL = long liq
    price: decimal("price", { precision: 18, scale: 8 }).notNull(),
    quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
    filledQty: decimal("filled_qty", { precision: 18, scale: 8 }),
    status: varchar("status", { length: 20 }),
    tradeTime: timestamp("trade_time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    symbolTradeTimeIdx: index("idx_liquidation_symbol_time").on(table.symbol, table.tradeTime),
  })
);

export type LiquidationEvent = typeof liquidationEvents.$inferSelect;
// ─── User Alert Rules (replaces localStorage "janus_alert_rules") ───
export const userAlertRules = pgTable(
  "user_alert_rules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    // price | sweep | absorption | imbalance | volatility
    type: varchar("type", { length: 30 }).notNull(),
    // ">" | "<" — null for event-based types (volatility, sweep, absorption)
    operator: varchar("operator", { length: 5 }),
    value: decimal("value", { precision: 18, scale: 8 }),
    isActive: boolean("is_active").default(true).notNull(),
    cooldownSeconds: integer("cooldown_seconds").default(60).notNull(),
    notifyTelegram: boolean("notify_telegram").default(true).notNull(),
    notifyWebhook: text("notify_webhook"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userAlertRulesUserIdx: index("idx_user_alert_rules_user").on(table.userId, table.isActive),
  })
);

export type UserAlertRule = typeof userAlertRules.$inferSelect;
export type InsertUserAlertRule = typeof userAlertRules.$inferInsert;

// ─── User Alert Logs (replaces localStorage "janus_alert_logs") ───
export const userAlertLogs = pgTable(
  "user_alert_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    ruleId: integer("rule_id").references(() => userAlertRules.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    type: varchar("type", { length: 30 }).notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  },
  (table) => ({
    userAlertLogsUserIdx: index("idx_user_alert_logs_user_time").on(table.userId, table.triggeredAt),
  })
);

export type UserAlertLog = typeof userAlertLogs.$inferSelect;

// ─── System Alert Logs (backend-generated indicator/SMC/KNN events) ───
export const systemAlertLogs = pgTable(
  "system_alert_logs",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    // bos | choch | fvg_fill | liq_sweep | ema_cross | bb_breakout | supertrend_flip
    // rsi_extreme | knn_bias_flip | knn_rejection | knn_regime_change | direction_flip | gated_flip
    type: varchar("type", { length: 30 }).notNull(),
    direction: varchar("direction", { length: 10 }),
    interval: varchar("interval", { length: 10 }),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  },
  (table) => ({
    systemAlertLogsSymbolIdx: index("idx_system_alert_logs_symbol_time").on(table.symbol, table.triggeredAt),
  })
);

export type SystemAlertLog = typeof systemAlertLogs.$inferSelect;

// ─── Alert Delivery Failures (webhook retry log) ───────────────────────────
export const alertDeliveryFailures = pgTable(
  "alert_delivery_failures",
  {
    id: serial("id").primaryKey(),
    ruleId: integer("rule_id").references(() => userAlertRules.id),
    url: text("url").notNull(),
    payload: text("payload").notNull(),
    error: text("error").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    alertDeliveryFailuresIdx: index("idx_alert_delivery_failures_rule").on(table.ruleId, table.createdAt),
  })
);

export type AlertDeliveryFailure = typeof alertDeliveryFailures.$inferSelect;

// ─── Brain Episodes ───
export const brainEpisodes = pgTable("brain_episodes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  sessionId: varchar("session_id", { length: 100 }),
  triggerType: varchar("trigger_type", { length: 50 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  marketSymbol: varchar("market_symbol", { length: 20 }).notNull(),
  observation: jsonb("observation").notNull(),
  reasoning: text("reasoning"),
  proposedAction: jsonb("proposed_action"),
  governorJson: jsonb("governor_json"),
  actualAction: jsonb("actual_action"),
  outcomePnl: decimal("outcome_pnl", { precision: 16, scale: 8 }),
  outcomeTime: timestamp("outcome_time"),
  reflection: text("reflection"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BrainEpisode = typeof brainEpisodes.$inferSelect;

// ─── Brain Strategies ───
export const brainStrategies = pgTable("brain_strategies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  promptTemplate: text("prompt_template"),
  parameters: jsonb("parameters").notNull(),
  sharpRatio: decimal("sharp_ratio", { precision: 8, scale: 4 }).default("0.0000").notNull(),
  totalPnl: decimal("total_pnl", { precision: 16, scale: 8 }).default("0.00000000").notNull(),
  winRate: decimal("win_rate", { precision: 5, scale: 2 }).default("0.00").notNull(),
  active: boolean("active").default(false).notNull(),
  lastEvaluated: timestamp("last_evaluated"),
});

export type BrainStrategy = typeof brainStrategies.$inferSelect;

// ─── Brain Reflections ───
export const brainReflections = pgTable("brain_reflections", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => brainEpisodes.id, { onDelete: "cascade" }).notNull(),
  lesson: text("lesson").notNull(),
  ruleCreated: text("rule_created").notNull(),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
});

export type BrainReflection = typeof brainReflections.$inferSelect;

// ─── Brain Candidate Rules ───
export const brainCandidateRules = pgTable("brain_candidate_rules", {
  id: serial("id").primaryKey(),
  ruleText: text("rule_text").notNull(),
  sourceEpisodeId: integer("source_episode_id").references(() => brainEpisodes.id, { onDelete: "cascade" }).notNull(),
  occurrences: integer("occurrences").default(1).notNull(),
  backtestScore: decimal("backtest_score", { precision: 8, scale: 4 }).default("0.0000").notNull(),
  status: varchar("status", { length: 20 }).default("candidate").notNull(), // candidate, approved, rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BrainCandidateRule = typeof brainCandidateRules.$inferSelect;

// ─── Brain Actions ───
export const brainActions = pgTable("brain_actions", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => brainEpisodes.id, { onDelete: "cascade" }).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  toolName: varchar("tool_name", { length: 100 }).notNull(),
  requestJson: jsonb("request_json"),
  responseJson: jsonb("response_json"),
  status: varchar("status", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BrainAction = typeof brainActions.$inferSelect;

// ─── Brain Tools ───
export const brainTools = pgTable("brain_tools", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description").notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  inputSchema: jsonb("input_schema"),
  outputSchema: jsonb("output_schema"),
  costEstimate: integer("cost_estimate").default(1).notNull(),
  isDestructive: boolean("is_destructive").default(false).notNull(),
});

export type BrainTool = typeof brainTools.$inferSelect;

// ─── Paper Accounts ───
export const paperAccounts = pgTable("paper_accounts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  startingBalance: decimal("starting_balance", { precision: 16, scale: 8 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 16, scale: 8 }).notNull(),
  equity: decimal("equity", { precision: 16, scale: 8 }).notNull(),
  marginUsed: decimal("margin_used", { precision: 16, scale: 8 }).default("0.00000000").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PaperAccount = typeof paperAccounts.$inferSelect;

// ─── Paper Positions ───
export const paperPositions = pgTable("paper_positions", {
  id: varchar("id", { length: 100 }).primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 16, scale: 8 }).notNull(),
  quantity: decimal("quantity", { precision: 16, scale: 8 }).notNull(),
  leverage: integer("leverage").default(1).notNull(),
  margin: decimal("margin", { precision: 16, scale: 8 }).notNull(),
  stopLoss: decimal("stop_loss", { precision: 16, scale: 8 }),
  takeProfit: decimal("take_profit", { precision: 16, scale: 8 }),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
});

export type PaperPosition = typeof paperPositions.$inferSelect;

// ─── Paper Trades ───
export const paperTrades = pgTable("paper_trades", {
  id: serial("id").primaryKey(),
  positionId: varchar("position_id", { length: 100 }).references(() => paperPositions.id, { onDelete: "cascade" }).notNull(),
  entryPrice: decimal("entry_price", { precision: 16, scale: 8 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 16, scale: 8 }).notNull(),
  pnl: decimal("pnl", { precision: 16, scale: 8 }).notNull(),
  fees: decimal("fees", { precision: 16, scale: 8 }).notNull(),
  rMultiple: decimal("r_multiple", { precision: 8, scale: 4 }).notNull(),
});

export type PaperTrade = typeof paperTrades.$inferSelect;

// ─── Paper Equity Snapshots ───
export const paperEquitySnapshots = pgTable("paper_equity_snapshots", {
  id: serial("id").primaryKey(),
  equity: decimal("equity", { precision: 16, scale: 8 }).notNull(),
  balance: decimal("balance", { precision: 16, scale: 8 }).notNull(),
  drawdown: decimal("drawdown", { precision: 8, scale: 4 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export type PaperEquitySnapshot = typeof paperEquitySnapshots.$inferSelect;
