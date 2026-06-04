export interface FundingRate {
  symbol: string;
  exchange: string;
  rate: number;           // e.g. 0.0001 = 0.01%
  nextFundingTime: number; // Unix epoch ms
  ts: number;
}

export interface OpenInterest {
  symbol: string;
  exchange: string;
  openInterest: number;
  openInterestUsd: number;
  ts: number;
}

export interface MarkPrice {
  symbol: string;
  exchange: string;
  markPrice: number;
  indexPrice: number;
  ts: number;
}

/** Aggregated best bid/ask — fastest channel for NBBO tracking */
export interface BookTicker {
  symbol: string;
  exchange: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  ts: number;
}
