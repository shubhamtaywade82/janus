import { RingBuffer } from "./ring-buffer";

// ─── Interfaces ───

export interface LtpTick {
  price: number;
  timestamp: number;
}

export interface TradeTick {
  id: number;
  price: number;
  quantity: number;
  side: "BUY" | "SELL";
  timestamp: number;
}

export interface OrderBookSnapshot {
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][]; // [price, quantity]
  timestamp: number;
}

export interface LiquidityDelta {
  level: number;
  bidRemoved: number;
  askRemoved: number;
  bidAdded: number;
  askAdded: number;
  timestamp: number;
}

export interface MarketMetrics {
  spread: number;
  spreadPercent: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  midPrice: number;

  // Derived rolling metrics
  bidAskImbalance: number;
  liquidityRemoved: number;
  liquidityAdded: number;
  absorptionScore: number;
  sweepScore: number;
  volatilityRegime: "LOW" | "NORMAL" | "HIGH";
}

export interface InstrumentState {
  symbol: string;

  ltp: number;
  previousLtp: number;

  orderBook: OrderBookSnapshot | null;
  previousOrderBook: OrderBookSnapshot | null;

  ltpWindow: RingBuffer<LtpTick>;
  tradeWindow: RingBuffer<TradeTick>;
  bookWindow: RingBuffer<OrderBookSnapshot>;
  deltaWindow: RingBuffer<LiquidityDelta>;

  metrics: MarketMetrics;
  updatedAt: number;
  sequenceNo: number;
}

// ─── Liquidity Delta Helper ───

export function calculateLiquidityDelta(
  prev: OrderBookSnapshot | null,
  curr: OrderBookSnapshot
): LiquidityDelta {
  let bidRemoved = 0;
  let bidAdded = 0;
  let askRemoved = 0;
  let askAdded = 0;

  const bestBid = curr.bids[0]?.[0] || 0;
  const bestAsk = curr.asks[0]?.[0] || 0;
  const mid = (bestBid + bestAsk) / 2;

  if (!prev) {
    return {
      level: mid,
      bidRemoved,
      bidAdded,
      askRemoved,
      askAdded,
      timestamp: curr.timestamp,
    };
  }

  const prevBids = new Map<number, number>(prev.bids);
  const currBids = new Map<number, number>(curr.bids);
  const prevAsks = new Map<number, number>(prev.asks);
  const currAsks = new Map<number, number>(curr.asks);

  // Compare bids
  for (const [p, q] of prevBids) {
    const qNew = currBids.get(p);
    if (qNew !== undefined) {
      const diff = qNew - q;
      if (diff > 0) bidAdded += diff;
      else if (diff < 0) bidRemoved += Math.abs(diff);
    } else {
      bidRemoved += q;
    }
  }
  for (const [p, q] of currBids) {
    if (!prevBids.has(p)) {
      bidAdded += q;
    }
  }

  // Compare asks
  for (const [p, q] of prevAsks) {
    const qNew = currAsks.get(p);
    if (qNew !== undefined) {
      const diff = qNew - q;
      if (diff > 0) askAdded += diff;
      else if (diff < 0) askRemoved += Math.abs(diff);
    } else {
      askRemoved += q;
    }
  }
  for (const [p, q] of currAsks) {
    if (!prevAsks.has(p)) {
      askAdded += q;
    }
  }

  return {
    level: mid,
    bidRemoved,
    bidAdded,
    askRemoved,
    askAdded,
    timestamp: curr.timestamp,
  };
}

// ─── State Manager Class ───

export class MarketStateManager {
  private readonly instruments = new Map<string, InstrumentState>();

  /**
   * Retrieves the state for a symbol, initializing it if not present.
   */
  getOrInitializeState(symbol: string): InstrumentState {
    let state = this.instruments.get(symbol);
    if (!state) {
      state = {
        symbol,
        ltp: 0,
        previousLtp: 0,
        orderBook: null,
        previousOrderBook: null,
        ltpWindow: new RingBuffer<LtpTick>(200),
        tradeWindow: new RingBuffer<TradeTick>(1000),
        bookWindow: new RingBuffer<OrderBookSnapshot>(50),
        deltaWindow: new RingBuffer<LiquidityDelta>(500),
        metrics: {
          spread: 0,
          spreadPercent: 0,
          bidDepth: 0,
          askDepth: 0,
          imbalance: 0,
          midPrice: 0,
          bidAskImbalance: 0,
          liquidityRemoved: 0,
          liquidityAdded: 0,
          absorptionScore: 0,
          sweepScore: 0,
          volatilityRegime: "NORMAL",
        },
        updatedAt: Date.now(),
        sequenceNo: 0,
      };
      this.instruments.set(symbol, state);
    }
    return state;
  }

  /**
   * Get the current state of a symbol.
   */
  get(symbol: string): InstrumentState | undefined {
    return this.instruments.get(symbol);
  }

  /**
   * Update the Last Traded Price (LTP).
   */
  updateLtp(symbol: string, price: number, timestamp: number = Date.now()): void {
    const state = this.getOrInitializeState(symbol);
    state.previousLtp = state.ltp > 0 ? state.ltp : price;
    state.ltp = price;
    state.ltpWindow.push({ price, timestamp });
    state.updatedAt = timestamp;
    state.sequenceNo++;
  }

  /**
   * Update the trade tape.
   */
  updateTrade(
    symbol: string,
    tradeInput: { id: number; price: number; quantity: number; side: "BUY" | "SELL"; timestamp?: number }
  ): void {
    const state = this.getOrInitializeState(symbol);
    const timestamp = tradeInput.timestamp ?? Date.now();
    const trade: TradeTick = {
      id: tradeInput.id,
      price: tradeInput.price,
      quantity: tradeInput.quantity,
      side: tradeInput.side,
      timestamp,
    };
    state.tradeWindow.push(trade);
    state.updatedAt = timestamp;
    state.sequenceNo++;
  }

  /**
   * Update the order book depth and compute indicators.
   */
  updateOrderBook(
    symbol: string,
    snapshotInput: { bids: [number, number][]; asks: [number, number][]; timestamp?: number }
  ): void {
    const timestamp = snapshotInput.timestamp ?? Date.now();
    const state = this.getOrInitializeState(symbol);

    const snapshot: OrderBookSnapshot = {
      bids: snapshotInput.bids,
      asks: snapshotInput.asks,
      timestamp,
    };

    state.previousOrderBook = state.orderBook;
    state.orderBook = snapshot;
    state.bookWindow.push(snapshot);

    // 1. Basic metrics
    const bestBid = snapshot.bids[0]?.[0] || 0;
    const bestAsk = snapshot.asks[0]?.[0] || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = Math.max(0, bestAsk - bestBid);
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const bidDepth = snapshot.bids.reduce((sum, [, qty]) => sum + qty, 0);
    const askDepth = snapshot.asks.reduce((sum, [, qty]) => sum + qty, 0);
    const totalDepth = bidDepth + askDepth;
    const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    state.metrics.spread = spread;
    state.metrics.spreadPercent = spreadPercent;
    state.metrics.bidDepth = bidDepth;
    state.metrics.askDepth = askDepth;
    state.metrics.imbalance = imbalance;
    state.metrics.midPrice = midPrice;

    // 2. Liquidity Delta
    const delta = calculateLiquidityDelta(state.previousOrderBook, snapshot);
    state.deltaWindow.push(delta);

    // 3. Derived metrics: Bid-Ask Imbalance over book window
    const books = state.bookWindow.values();
    let totalImbalance = 0;
    for (const book of books) {
      const bD = book.bids.reduce((sum, [, qty]) => sum + qty, 0);
      const aD = book.asks.reduce((sum, [, qty]) => sum + qty, 0);
      const tot = bD + aD;
      totalImbalance += tot > 0 ? (bD - aD) / tot : 0;
    }
    state.metrics.bidAskImbalance = books.length > 0 ? totalImbalance / books.length : 0;

    // 4. Derived metrics: Liquidity added/removed
    const deltas = state.deltaWindow.values();
    let rollingAdded = 0;
    let rollingRemoved = 0;
    for (const d of deltas) {
      rollingAdded += d.bidAdded + d.askAdded;
      rollingRemoved += d.bidRemoved + d.askRemoved;
    }
    state.metrics.liquidityAdded = rollingAdded;
    state.metrics.liquidityRemoved = rollingRemoved;

    // 5. Volatility regime classification
    const ltpTicks = state.ltpWindow.values();
    if (ltpTicks.length >= 20) {
      const prices = ltpTicks.map((t) => t.price);
      const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);
      const stdDevPct = avg > 0 ? (stdDev / avg) * 100 : 0;

      if (stdDevPct < 0.02) {
        state.metrics.volatilityRegime = "LOW";
      } else if (stdDevPct > 0.15) {
        state.metrics.volatilityRegime = "HIGH";
      } else {
        state.metrics.volatilityRegime = "NORMAL";
      }
    } else {
      state.metrics.volatilityRegime = "NORMAL";
    }

    // 6. Sweep and Absorption score calculations
    const trades = state.tradeWindow.values();
    const recentTrades = trades.slice(-200);
    let aggressiveBuyVol = 0;
    let aggressiveSellVol = 0;
    for (const t of recentTrades) {
      if (t.side === "BUY") aggressiveBuyVol += t.quantity;
      else aggressiveSellVol += t.quantity;
    }
    const totalAggressiveVol = aggressiveBuyVol + aggressiveSellVol;

    if (recentTrades.length >= 10 && midPrice > 0) {
      const startPrice = recentTrades[0].price;
      const endPrice = recentTrades[recentTrades.length - 1].price;
      const priceDiff = Math.abs(endPrice - startPrice);
      const priceChangePct = (priceDiff / midPrice) * 100;

      // Sweep Score: goes up with price movement & volume
      state.metrics.sweepScore = Math.min(
        100,
        priceChangePct * 500 * Math.log1p(totalAggressiveVol)
      );

      // Absorption Score: goes up with high volume & small price movement
      const epsilon = 0.005; // avoid division by zero or super inflation
      state.metrics.absorptionScore = Math.min(
        100,
        (Math.log1p(totalAggressiveVol) * 10) / (priceChangePct + epsilon)
      );
    } else {
      state.metrics.sweepScore = 0;
      state.metrics.absorptionScore = 0;
    }

    state.updatedAt = timestamp;
    state.sequenceNo++;
  }
}

// Export a singleton instance
export const marketStateManager = new MarketStateManager();
