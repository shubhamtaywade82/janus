export const DomainEvents = {
  MARKET_ORDERBOOK_UPDATED: "market.orderbook.updated",
  MARKET_TRADE_TICK: "market.trade.tick",
  MARKET_CANDLE_CLOSED: "market.candle.closed",

  SIGNAL_GENERATED: "signal.generated",

  RISK_APPROVED: "risk.approved",
  RISK_REJECTED: "risk.rejected",

  ORDER_SUBMITTED: "order.submitted",
  ORDER_PARTIALLY_FILLED: "order.partially_filled",
  ORDER_FILLED: "order.filled",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_REJECTED: "order.rejected",

  FILL_RECEIVED: "fill.received",

  POSITION_UPDATED: "position.updated",
  PORTFOLIO_UPDATED: "portfolio.updated",
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];
