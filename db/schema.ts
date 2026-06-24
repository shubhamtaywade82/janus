import { sql } from "drizzle-orm";
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
  uniqueIndex,
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
  "h6_momentum",
  "alpha_protocol",
]);
export const executionModeEnum = pgEnum("execution_mode", ["PAPER", "LIVE", "SHADOW"]);

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
  // ─── PTA extensions ───────────────────────────────────────────────────────
  session: varchar("session", { length: 10 }), // ASIA | LONDON | US | OVERLAP
  hoursToFunding: decimal("hours_to_funding", { precision: 5, scale: 2 }),
  binanceMarkPrice: decimal("binance_mark_price", { precision: 18, scale: 8 }),
  binanceIndexPrice: decimal("binance_index_price", { precision: 18, scale: 8 }),
  binanceFundingRate: decimal("binance_funding_rate", { precision: 12, scale: 8 }),
  binancePredictedRate: decimal("binance_predicted_rate", { precision: 12, scale: 8 }),
  openInterestUsd: decimal("open_interest_usd", { precision: 20, scale: 2 }),
  openInterestDelta: decimal("open_interest_delta", { precision: 20, scale: 2 }),
  volume24hUsd: decimal("volume_24h_usd", { precision: 20, scale: 2 }),
  atr14: decimal("atr_14", { precision: 18, scale: 8 }),
  atrPercent: decimal("atr_percent", { precision: 8, scale: 4 }),
  triggerDescription: text("trigger_description"),
  triggerMetadata: jsonb("trigger_metadata").default("{}"),
  disposition: varchar("disposition", { length: 30 }).default("PENDING"),
  // PENDING | ORDER_PLACED | REJECTED_FILTER | REJECTED_RISK | EXPIRED | DUPLICATE
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idxSignalsSession: index("idx_signals_session").on(table.session, table.createdAt),
}));

export type Signal = typeof signals.$inferSelect;

// ─── Kronos AI Signals (Foundation Model Predictions) ───
export const kronosSignals = pgTable("kronos_signals", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  interval: varchar("interval", { length: 10 }).notNull().default("1m"),
  directionSignal: decimal("direction_signal", { precision: 8, scale: 6 }).notNull(),
  volatilityForecast: decimal("volatility_forecast", { precision: 8, scale: 6 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  task: varchar("task", { length: 30 }).notNull().default("return_forecast"),
  horizon: integer("horizon").default(4).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  symbolTimeIdx: index("idx_kronos_signals_symbol_time").on(table.symbol, table.createdAt),
  symbolIntervalIdx: index("idx_kronos_signals_symbol_interval").on(table.symbol, table.interval),
}));

export type KronosSignal = typeof kronosSignals.$inferSelect;

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
    entryReason: text("entry_reason"),
    exitReason: text("exit_reason"),
    breakevenApplied: boolean("breakeven_applied").default(false).notNull(),
    extremePrice: decimal("extreme_price", { precision: 18, scale: 8 }),
    lastMarkPrice: decimal("last_mark_price", { precision: 18, scale: 8 }),
    openedAlertSent: boolean("opened_alert_sent").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    userIdStatusIdx: index("idx_positions_user_status").on(table.userId, table.status),
    symbolIdx: index("idx_positions_symbol").on(table.symbol),
    uqPositionsOpen: uniqueIndex("uq_positions_open")
      .on(table.userId, table.symbol, table.side)
      .where(sql`status = 'open'`),
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
    // ─── PTA extensions ──────────────────────────────────────────────────────
    strategyType: strategyTypeEnum("strategy_type").default("intraday"),
    stopLossPrice: decimal("stop_loss_price", { precision: 18, scale: 8 }),
    takeProfitPrice: decimal("take_profit_price", { precision: 18, scale: 8 }),
    trailingStopPct: decimal("trailing_stop_pct", { precision: 6, scale: 4 }),
    grossPnlUsdt: decimal("gross_pnl_usdt", { precision: 18, scale: 8 }),
    netPnlUsdt: decimal("net_pnl_usdt", { precision: 18, scale: 8 }),
    totalFeesUsdt: decimal("total_fees_usdt", { precision: 18, scale: 8 }),
    fundingPaidUsdt: decimal("funding_paid_usdt", { precision: 18, scale: 8 }).default("0"),
    mfePrice: decimal("mfe_price", { precision: 18, scale: 8 }),
    mfePct: decimal("mfe_pct", { precision: 8, scale: 4 }),
    maePrice: decimal("mae_price", { precision: 18, scale: 8 }),
    maePct: decimal("mae_pct", { precision: 8, scale: 4 }),
    exitReason: varchar("exit_reason", { length: 30 }),
    // TP_HIT | SL_HIT | TRAILING_STOP | MANUAL | LIQUIDATED | TIME_EXIT
    holdingPeriodSeconds: integer("holding_period_seconds"),
    binanceSignalPrice: decimal("binance_signal_price", { precision: 18, scale: 8 }),
    coindcxFillPrice: decimal("coindcx_fill_price", { precision: 18, scale: 8 }),
    slippageBps: decimal("slippage_bps", { precision: 10, scale: 4 }),
    executionMode: executionModeEnum("execution_mode").default("PAPER"),
    },
  (table) => ({
    userIdPositionIdIdx: index("idx_trades_user_position").on(table.userId, table.positionId),
    idxTradesSymbol: index("idx_trades_symbol").on(table.symbol, table.createdAt),
    idxTradesExitReason: index("idx_trades_exit_reason").on(table.exitReason),
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
  capitalAllocationPct: decimal("capital_allocation_pct", { precision: 5, scale: 3 }).default("0.250"), // fraction of free balance per trade, e.g. 0.250 = 25%
  useStrategyLeverage: boolean("use_strategy_leverage").default(true).notNull(), // true = use STRATEGY_CONFIGS[strategy].maxLeverage, false = use defaultLeverage
  paperStartingBalance: decimal("paper_starting_balance", { precision: 12, scale: 2 }).default("100000"),
  paperCurrency: marginCurrencyEnum("paper_currency").default("INR").notNull(),
  trailingStopEnabled: boolean("trailing_stop_enabled").default(true).notNull(),
  riskRewardRatio: decimal("risk_reward_ratio", { precision: 4, scale: 2 }).default("2.00").notNull(),
  // AI Brain participation in the autonomous loop
  brainDriverEnabled: boolean("brain_driver_enabled").default(false).notNull(), // brain autonomously proposes/opens trades
  brainGateEnabled: boolean("brain_gate_enabled").default(false).notNull(),     // brain acts as an extra confirmation gate on confluence signals
  brainShadowMode: boolean("brain_shadow_mode").default(true).notNull(),        // true = log only (governor skipped, no execution)
  useKronosFilter: boolean("use_kronos_filter").default(false).notNull(),
  kronosConfidenceThreshold: decimal("kronos_confidence_threshold", { precision: 5, scale: 4 }).default("0.5000").notNull(),
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

// ─── Risk Sessions (persisted daily trading state — survives restarts) ───
export const riskSessions = pgTable(
  "risk_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    tradingDay: varchar("trading_day", { length: 10 }).notNull(), // YYYY-MM-DD
    startingEquity: decimal("starting_equity", { precision: 18, scale: 4 }).notNull(),
    currentEquity: decimal("current_equity", { precision: 18, scale: 4 }).notNull(),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).default("0").notNull(),
    tradeCount: integer("trade_count").default(0).notNull(),
    consecutiveLosses: integer("consecutive_losses").default(0).notNull(),
    cooldownUntil: timestamp("cooldown_until"),
    maxDrawdownHit: boolean("max_drawdown_hit").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userDayIdx: unique("uq_risk_sessions_user_day").on(table.userId, table.tradingDay),
    userTimeIdx: index("idx_risk_sessions_user_time").on(table.userId, table.updatedAt),
  })
);

export type RiskSessionRow = typeof riskSessions.$inferSelect;

// ─── Market Regimes (shared context for Signal Engine, Brain, Reflection, Backtester) ───
export const marketRegimes = pgTable(
  "market_regimes",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    regime: varchar("regime", { length: 20 }).notNull(),       // trending | range | volatile
    direction: varchar("direction", { length: 20 }).notNull(), // bullish | bearish | neutral
    volatility: varchar("volatility", { length: 20 }).notNull(), // low | normal | high
    liquidity: varchar("liquidity", { length: 30 }),             // buy_side_targeted | sell_side_targeted | balanced
    funding: varchar("funding", { length: 20 }),                 // neutral | overheated_long | overheated_short
    marketStructure: varchar("market_structure", { length: 20 }), // continuation | reversal | accumulation
    confidence: decimal("confidence", { precision: 5, scale: 4 }).default("0.0000").notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => ({
    symbolTimeIdx: index("idx_market_regimes_symbol_time").on(table.symbol, table.timestamp),
  })
);

export type MarketRegime = typeof marketRegimes.$inferSelect;

// ─── Executor Decisions (structured, queryable, restart-surviving decision log) ───
// Every auto-executor decision (execute or gate-level skip) is persisted here so the
// frontend can show WHY the bot did or did not trade. Distinct from system_logs (free text).
export const executorDecisions = pgTable("executor_decisions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  action: varchar("action", { length: 16 }).notNull(), // "execute" | "skip"
  gate: varchar("gate", { length: 48 }),               // gate that produced the outcome (e.g. "risk", "llm", "dedup", "executed")
  reason: text("reason").notNull(),
  direction: varchar("direction", { length: 16 }),
  compositeScore: decimal("composite_score", { precision: 6, scale: 2 }),
  strategy: varchar("strategy", { length: 32 }),
  llmDecision: jsonb("llm_decision"),
  signalId: integer("signal_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => ({
  userTimeIdx: index("idx_executor_decisions_user_time").on(table.userId, table.createdAt),
  symbolTimeIdx: index("idx_executor_decisions_symbol_time").on(table.symbol, table.createdAt),
}));

export type ExecutorDecisionRow = typeof executorDecisions.$inferSelect;

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
  // ─── Decision Attribution (added for measurable Brain evaluation) ───
  signalSource: varchar("signal_source", { length: 50 }),     // "confluence" | "manual" | "brain"
  brainVerdict: varchar("brain_verdict", { length: 20 }),     // APPROVE | CAUTION | REDUCE_RISK | EXIT_NOW
  governorVerdict: varchar("governor_verdict", { length: 20 }), // approved | rejected
  governorGate: varchar("governor_gate", { length: 255 }),     // which gate triggered (if rejected)
  executionResult: varchar("execution_result", { length: 20 }), // executed | skipped | error
  positionId: integer("position_id"),                         // FK to positions (if executed)
  // NOTE: the pgvector `embedding` column is NOT modelled in Drizzle — it is managed
  // by migration (0014, docker ankane/pgvector) and queried via raw SQL in brain-memory.
  // Keeping it out of the ORM model means select() works on hosts without pgvector.
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

// ─── Kill Switch State (single-row table for atomic halt persistence across restarts) ───
export const killSwitchState = pgTable("kill_switch_state", {
  key: varchar("key", { length: 10 }).primaryKey().default("global"),
  isActive: boolean("is_active").default(false).notNull(),
  type: varchar("type", { length: 30 }),
  reason: text("reason"),
  triggeredAt: decimal("triggered_at", { precision: 16, scale: 0 }), // epoch ms
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type KillSwitchStateRow = typeof killSwitchState.$inferSelect;

// ─── Orders Table for Simulated/Paper Trading State Machine ───
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  clientOrderId: varchar("client_order_id", { length: 255 }).notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(), // 'BUY', 'SELL'
  orderType: varchar("order_type", { length: 20 }).notNull(), // 'MARKET', 'LIMIT'
  price: decimal("price", { precision: 18, scale: 8 }),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  filledQuantity: decimal("filled_quantity", { precision: 18, scale: 8 }).default("0.00000000").notNull(),
  status: varchar("status", { length: 20 }).notNull(), // 'PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED'
  leverage: integer("leverage").default(1).notNull(),
  stopLoss: decimal("stop_loss", { precision: 18, scale: 8 }),
  takeProfit: decimal("take_profit", { precision: 18, scale: 8 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  // ─── PTA extensions ────────────────────────────────────────────────────────
  executionMode: executionModeEnum("execution_mode").default("PAPER"),
  // PAPER | LIVE | SHADOW
  fillModel: varchar("fill_model", { length: 30 }),
  // MARK_PRICE | ORDERBOOK_WALK | SLIPPAGE_PENALTY | VWAP_ESTIMATE | WORST_CASE
  simulatedSlippageBps: decimal("simulated_slippage_bps", { precision: 10, scale: 4 }),
  binanceMarkPriceAtSend: decimal("binance_mark_price_at_send", { precision: 18, scale: 8 }),
  orderConstructedAt: timestamp("order_constructed_at"),
  orderSentAt: timestamp("order_sent_at"),
  orderAckedAt: timestamp("order_acked_at"),
  cancelReason: text("cancel_reason"),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export const liquidityZones = pgTable("liquidity_zones", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g. "B-BTC_USDT"
  timeframe: varchar("timeframe", { length: 5 }).notNull(), // "15m" | "1h"
  priceLevel: decimal("price_level", { precision: 28, scale: 8 }).notNull(),
  zoneType: varchar("zone_type", { length: 20 }).notNull(), // "SWING_HIGH" | "SWING_LOW" | "EQH" | "EQL"
  touches: integer("touches").default(1).notNull(),
  isSwept: boolean("is_swept").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LiquidityZone = typeof liquidityZones.$inferSelect;

