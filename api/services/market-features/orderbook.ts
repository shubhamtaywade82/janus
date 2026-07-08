import { InstrumentState } from "../market-state";
import { OrderBookFeature } from "./types";

export function computeOrderBook(state: InstrumentState): OrderBookFeature {
  const defaultFeature: OrderBookFeature = {
    spread: 0,
    spreadPercent: 0,
    bidDepth: 0,
    askDepth: 0,
    imbalance: 0,
    depthImbalanceState: "BALANCED",
  };

  const ob = state.orderBook;
  if (!ob) {
    // Check if state.metrics has some values we can use
    if (state.metrics && state.metrics.spread > 0) {
      const imb = state.metrics.imbalance;
      let depthImbalanceState: OrderBookFeature["depthImbalanceState"] = "BALANCED";
      if (imb > 0.2) depthImbalanceState = "BIDS_HEAVY";
      else if (imb < -0.2) depthImbalanceState = "ASKS_HEAVY";

      return {
        spread: state.metrics.spread,
        spreadPercent: state.metrics.spreadPercent,
        bidDepth: state.metrics.bidDepth,
        askDepth: state.metrics.askDepth,
        imbalance: imb,
        depthImbalanceState,
      };
    }
    return defaultFeature;
  }

  // Calculate from active orderBook snapshot
  const bids = ob.bids;
  const asks = ob.asks;
  if (bids.length === 0 || asks.length === 0) {
    return defaultFeature;
  }

  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];
  const spread = bestAsk - bestBid;
  const midPrice = (bestAsk + bestBid) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  // Let's sum top 10 levels for bidDepth and askDepth
  let bidDepth = 0;
  let askDepth = 0;
  const levels = Math.min(10, bids.length, asks.length);
  for (let i = 0; i < levels; i++) {
    bidDepth += bids[i][1];
    askDepth += asks[i][1];
  }

  const imbalance = (bidDepth + askDepth) > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;

  let depthImbalanceState: OrderBookFeature["depthImbalanceState"] = "BALANCED";
  if (imbalance > 0.2) {
    depthImbalanceState = "BIDS_HEAVY";
  } else if (imbalance < -0.2) {
    depthImbalanceState = "ASKS_HEAVY";
  }

  return {
    spread,
    spreadPercent,
    bidDepth,
    askDepth,
    imbalance,
    depthImbalanceState,
  };
}
