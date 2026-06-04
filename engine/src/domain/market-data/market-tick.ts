/**
 * MarketTick — normalized NBBO snapshot.
 * Strategies always consume MarketTick, never raw exchange payloads.
 */
export interface MarketTick {
  symbol: string;
  exchange: string;
  price: number;   // last traded price
  bid: number;
  ask: number;
  spread: number;
  midPrice: number;
  volume: number;  // 24h quote volume
  ts: number;
}

/** Aggressive trade — taker-initiated, used for aggressor flow analysis */
export interface AggTrade {
  id: string;
  symbol: string;
  exchange: string;
  price: number;
  quantity: number;
  side: "buy" | "sell"; // taker side
  firstTradeId: number;
  lastTradeId: number;
  ts: number;
}
