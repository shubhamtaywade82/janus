export interface OrderLevel {
  price: number;
  size: number;
}

export interface OrderbookSnapshot {
  symbol: string;
  exchange: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  sequence: number;
  ts: number;
}

export interface OrderbookUpdate {
  symbol: string;
  exchange: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  sequence: number;
  ts: number;
}

export interface OrderbookMetrics {
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  midPrice: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number; // (bidDepth - askDepth) / (bidDepth + askDepth), range [-1, 1]
}
