export type Side = "buy" | "sell";
export type PositionSide = "long" | "short";
export type OrderType = "market" | "limit" | "post_only" | "bracket";
export type OrderStatus =
  | "created"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected";

export type ExchangeId = "delta" | "coindcx";

export type Timestamp = number; // Unix epoch ms
