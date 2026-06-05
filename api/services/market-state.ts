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

export interface LiquidationTick {
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  timestamp: number;
}

export interface FundingTick {
  fundingRate: number;
  markPrice: number;
  timestamp: number;
}

export interface OpenInterestTick {
  openInterest: number;
  quoteOI?: number;
  timestamp: number;
}

export interface CvdTick {
  delta: number;
  cumulative: number;
  price: number;
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
  liquidationWindow: RingBuffer<LiquidationTick>;
  openInterestWindow: RingBuffer<OpenInterestTick>;
  cvdWindow: RingBuffer<CvdTick>;
  latestFunding: FundingTick | null;
  latestOpenInterest: OpenInterestTick | null;
  cumulativeCvd: number;

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
        liquidationWindow: new RingBuffer<LiquidationTick>(1000),
        openInterestWindow: new RingBuffer<OpenInterestTick>(500),
        cvdWindow: new RingBuffer<CvdTick>(1000),
        latestFunding: null,
        latestOpenInterest: null,
        cumulativeCvd: 0,
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
   * Update Funding Rate and Mark Price
   */
  updateFunding(symbol: string, fundingInput: { fundingRate: string; markPrice: string; nextFundingTime: number }): void {
    const state = this.getOrInitializeState(symbol);
    state.latestFunding = {
      fundingRate: parseFloat(fundingInput.fundingRate),
      markPrice: parseFloat(fundingInput.markPrice),
      timestamp: fundingInput.nextFundingTime
    };
    state.updatedAt = Date.now();
    state.sequenceNo++;
  }

  /**
   * Update Liquidations
   */
  updateLiquidation(symbol: string, liqInput: { side: string; price: number; originalQuantity: string; orderTradeTime: number }): void {
    const state = this.getOrInitializeState(symbol);
    const liq: LiquidationTick = {
      side: liqInput.side as "BUY" | "SELL",
      price: liqInput.price,
      quantity: parseFloat(liqInput.originalQuantity),
      timestamp: liqInput.orderTradeTime
    };
    state.liquidationWindow.push(liq);
    state.updatedAt = Date.now();
    state.sequenceNo++;
  }

  /**
   * Update Open Interest snapshots from REST polling.
   */
  updateOpenInterest(symbol: string, oiInput: { openInterest: number; quoteOI?: number; timestamp?: number }): void {
    const state = this.getOrInitializeState(symbol);
    const tick: OpenInterestTick = {
      openInterest: oiInput.openInterest,
      quoteOI: oiInput.quoteOI,
      timestamp: oiInput.timestamp ?? Date.now(),
    };
    state.latestOpenInterest = tick;
    state.openInterestWindow.push(tick);
    state.updatedAt = tick.timestamp;
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

    const delta = trade.side === "BUY"
      ? trade.quantity * trade.price
      : -trade.quantity * trade.price;
    state.cumulativeCvd += delta;
    state.cvdWindow.push({
      delta,
      cumulative: state.cumulativeCvd,
      price: trade.price,
      timestamp,
    });

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

  /**
   * Analyze CVD for a symbol: detect divergences between price and cumulative volume delta.
   */
  analyzeCvd(symbol: string): {
    trend: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | "CONFIRMING" | "NEUTRAL";
    signalStrength: "STRONG" | "MODERATE" | "WEAK";
    current: number;
    sessionDelta: number;
  } {
    const state = this.instruments.get(symbol);
    if (!state || state.cvdWindow.size() < 10) {
      return { trend: "NEUTRAL", signalStrength: "WEAK", current: 0, sessionDelta: 0 };
    }

    const points = state.cvdWindow.values();
    const recent = points.slice(-20);
    const sessionStart = points.length > 100 ? points[points.length - 100] : points[0];

    const priceValues = recent.map((p) => p.price);
    const cvdValues = recent.map((p) => p.cumulative);

    const half = Math.floor(recent.length / 2);
    const priceLow1 = Math.min(...priceValues.slice(0, half));
    const priceLow2 = Math.min(...priceValues.slice(half));
    const cvdLow1 = Math.min(...cvdValues.slice(0, half));
    const cvdLow2 = Math.min(...cvdValues.slice(half));
    const priceHigh1 = Math.max(...priceValues.slice(0, half));
    const priceHigh2 = Math.max(...priceValues.slice(half));
    const cvdHigh1 = Math.max(...cvdValues.slice(0, half));
    const cvdHigh2 = Math.max(...cvdValues.slice(half));

    let trend: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | "CONFIRMING" | "NEUTRAL" = "NEUTRAL";
    let signalStrength: "STRONG" | "MODERATE" | "WEAK" = "WEAK";

    if (priceLow2 < priceLow1 && cvdLow2 > cvdLow1) {
      trend = "BULLISH_DIVERGENCE";
      signalStrength = "STRONG";
    } else if (priceHigh2 > priceHigh1 && cvdHigh2 < cvdHigh1) {
      trend = "BEARISH_DIVERGENCE";
      signalStrength = "STRONG";
    } else if (state.cumulativeCvd > (sessionStart.cumulative ?? 0)) {
      trend = "CONFIRMING";
      signalStrength = "MODERATE";
    }

    return {
      trend,
      signalStrength,
      current: state.cumulativeCvd,
      sessionDelta: state.cumulativeCvd - (sessionStart.cumulative ?? 0),
    };
  }
}

// Export a singleton instance
export const marketStateManager = new MarketStateManager();
