export const DomainEvents = {
  // Market data
  MARKET_ORDERBOOK_UPDATED: "market.orderbook.updated",
  MARKET_ORDERBOOK_SNAPSHOT: "market.orderbook.snapshot",
  MARKET_TRADE_TICK: "market.trade.tick",
  MARKET_AGG_TRADE: "market.agg_trade",
  MARKET_CANDLE_CLOSED: "market.candle.closed",
  MARKET_CANDLE_UPDATED: "market.candle.updated",
  MARKET_BOOK_TICKER: "market.book_ticker",
  MARKET_MARK_PRICE: "market.mark_price",
  MARKET_FUNDING_RATE: "market.funding_rate",
  MARKET_OPEN_INTEREST: "market.open_interest",
  MARKET_TICK: "market.tick",

  // Signals
  SIGNAL_GENERATED: "signal.generated",

  // Risk
  RISK_APPROVED: "risk.approved",
  RISK_REJECTED: "risk.rejected",

  // Orders
  ORDER_SUBMITTED: "order.submitted",
  ORDER_PARTIALLY_FILLED: "order.partially_filled",
  ORDER_FILLED: "order.filled",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_REJECTED: "order.rejected",

  // Fills
  FILL_RECEIVED: "fill.received",

  // Positions / portfolio
  POSITION_UPDATED: "position.updated",
  PORTFOLIO_UPDATED: "portfolio.updated",

  // System
  HEARTBEAT: "system.heartbeat",
  EXCHANGE_CONNECTED: "system.exchange.connected",
  EXCHANGE_DISCONNECTED: "system.exchange.disconnected",
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];
