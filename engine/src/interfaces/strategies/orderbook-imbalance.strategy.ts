import { nanoid } from "nanoid";
import type { Strategy } from "../../application/services/strategy-runner.js";
import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { TradeSignal } from "../../domain/signals/trade-signal.js";
import type { ExchangeId } from "../../domain/common/types.js";

/**
 * Example strategy: trade when orderbook imbalance exceeds threshold.
 * Buy when bid depth heavily dominates, sell when ask depth dominates.
 */
export function createOrderbookImbalanceStrategy(
  symbols: string[],
  exchange: ExchangeId,
  config = { imbalanceThreshold: 0.35, minConfidence: 0.72 }
): Strategy {
  return {
    id: "orderbook-imbalance-v1",
    name: "Orderbook Imbalance",
    symbols,

    onOrderbook(snapshot: OrderbookSnapshot): TradeSignal | null {
      const depth = 10;
      const topBids = snapshot.bids.slice(0, depth);
      const topAsks = snapshot.asks.slice(0, depth);

      const bidDepth = topBids.reduce((s, l) => s + l.size, 0);
      const askDepth = topAsks.reduce((s, l) => s + l.size, 0);
      const total = bidDepth + askDepth;
      if (total === 0) return null;

      const imbalance = (bidDepth - askDepth) / total; // [-1, 1]
      const absImbalance = Math.abs(imbalance);

      if (absImbalance < config.imbalanceThreshold) return null;

      const side = imbalance > 0 ? "buy" : "sell";
      const bestBid = snapshot.bids[0]?.price ?? 0;
      const bestAsk = snapshot.asks[0]?.price ?? 0;
      const entryPrice = side === "buy" ? bestAsk : bestBid;
      const confidence = Math.min(0.5 + absImbalance * 0.5, 0.98);

      if (confidence < config.minConfidence) return null;

      return {
        id: nanoid(),
        symbol: snapshot.symbol,
        exchange,
        side,
        confidence,
        score: confidence * 100,
        entryPrice,
        quantity: 0.001, // placeholder — RiskEngine will resize
        orderType: "limit",
        strategyId: "orderbook-imbalance-v1",
        ts: snapshot.ts,
        meta: { imbalance, bidDepth, askDepth },
      };
    },
  };
}
