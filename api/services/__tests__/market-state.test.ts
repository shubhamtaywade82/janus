import { describe, it, expect, beforeEach } from "vitest";
import { RingBuffer } from "../ring-buffer";
import { MarketStateManager, calculateLiquidityDelta } from "../market-state";

describe("RingBuffer", () => {
  it("should initialize with correct capacity and size 0", () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.size()).toBe(0);
    expect(buffer.values()).toEqual([]);
  });

  it("should accept items and return them in order", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.size()).toBe(2);
    expect(buffer.values()).toEqual([1, 2]);
  });

  it("should overwrite oldest items when capacity is exceeded", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4); // Overwrites 1
    expect(buffer.size()).toBe(3);
    expect(buffer.values()).toEqual([2, 3, 4]);

    buffer.push(5); // Overwrites 2
    expect(buffer.values()).toEqual([3, 4, 5]);
  });

  it("should clear items", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.values()).toEqual([]);
  });
});

describe("calculateLiquidityDelta", () => {
  it("should return zero deltas if previous book is null", () => {
    const curr = {
      bids: [[100, 10] as [number, number]],
      asks: [[101, 10] as [number, number]],
      timestamp: 1000,
    };
    const delta = calculateLiquidityDelta(null, curr);
    expect(delta.bidAdded).toBe(0);
    expect(delta.bidRemoved).toBe(0);
    expect(delta.askAdded).toBe(0);
    expect(delta.askRemoved).toBe(0);
    expect(delta.level).toBe(100.5);
  });

  it("should calculate delta when levels are added, removed, or changed", () => {
    const prev = {
      bids: [
        [100, 10],
        [99, 5],
      ] as [number, number][],
      asks: [
        [101, 10],
        [102, 5],
      ] as [number, number][],
      timestamp: 1000,
    };

    const curr = {
      bids: [
        [100, 12], // +2 qty added
        [99, 3],  // -2 qty removed
        [98, 4],  // brand new level: +4 qty added
      ] as [number, number][],
      asks: [
        [101, 8],  // -2 qty removed
        // 102 level missing: -5 qty removed
        [103, 6],  // brand new level: +6 qty added
      ] as [number, number][],
      timestamp: 1100,
    };

    const delta = calculateLiquidityDelta(prev, curr);
    // Bids:
    // 100: 10 -> 12 (+2 added)
    // 99: 5 -> 3 (-2 removed)
    // 98: new 4 (+4 added)
    expect(delta.bidAdded).toBe(6); // 2 + 4
    expect(delta.bidRemoved).toBe(2);

    // Asks:
    // 101: 10 -> 8 (-2 removed)
    // 102: removed completely (-5 removed)
    // 103: new 6 (+6 added)
    expect(delta.askAdded).toBe(6);
    expect(delta.askRemoved).toBe(7); // 2 + 5
  });
});

describe("MarketStateManager", () => {
  let manager: MarketStateManager;
  const symbol = "BTCUSDT";

  beforeEach(() => {
    manager = new MarketStateManager();
  });

  it("should initialize instrument state lazily", () => {
    const state = manager.getOrInitializeState(symbol);
    expect(state.symbol).toBe(symbol);
    expect(state.ltp).toBe(0);
    expect(state.metrics.spread).toBe(0);
  });

  it("should track LTP updates", () => {
    manager.updateLtp(symbol, 50000, 1000);
    let state = manager.get(symbol)!;
    expect(state.ltp).toBe(50000);
    expect(state.previousLtp).toBe(50000); // First update sets both
    expect(state.ltpWindow.values()).toEqual([{ price: 50000, timestamp: 1000 }]);

    manager.updateLtp(symbol, 50100, 1100);
    state = manager.get(symbol)!;
    expect(state.ltp).toBe(50100);
    expect(state.previousLtp).toBe(50000);
    expect(state.ltpWindow.values()).toEqual([
      { price: 50000, timestamp: 1000 },
      { price: 50100, timestamp: 1100 },
    ]);
  });

  it("should track trades", () => {
    manager.updateTrade(symbol, {
      id: 1,
      price: 50000,
      quantity: 0.5,
      side: "BUY",
      timestamp: 1000,
    });
    const state = manager.get(symbol)!;
    expect(state.tradeWindow.size()).toBe(1);
    expect(state.tradeWindow.values()[0]).toEqual({
      id: 1,
      price: 50000,
      quantity: 0.5,
      side: "BUY",
      timestamp: 1000,
    });
    expect(state.cumulativeCvd).toBe(25000);
    expect(state.cvdWindow.values()[0]).toEqual({
      delta: 25000,
      cumulative: 25000,
      price: 50000,
      timestamp: 1000,
    });
  });

  it("should track open interest snapshots", () => {
    manager.updateOpenInterest(symbol, {
      openInterest: 123456.78,
      quoteOI: 987654.32,
      timestamp: 1000,
    });

    const state = manager.get(symbol)!;
    expect(state.latestOpenInterest).toEqual({
      openInterest: 123456.78,
      quoteOI: 987654.32,
      timestamp: 1000,
    });
    expect(state.openInterestWindow.values()).toEqual([state.latestOpenInterest]);
  });

  it("should calculate order book and derived metrics", () => {
    // Inject some trades first so sweep/absorption score can be calculated
    for (let i = 1; i <= 15; i++) {
      manager.updateTrade(symbol, {
        id: i,
        price: 50000 + i * 2,
        quantity: 1.0,
        side: "BUY",
        timestamp: 1000 + i * 10,
      });
      // also feed LTP ticks to trigger volatility calculations
      manager.updateLtp(symbol, 50000 + i * 2, 1000 + i * 10);
    }

    const bids: [number, number][] = [
      [50000, 10],
      [49990, 20],
    ];
    const asks: [number, number][] = [
      [50010, 15],
      [50020, 25],
    ];

    manager.updateOrderBook(symbol, { bids, asks, timestamp: 2000 });
    const state = manager.get(symbol)!;

    expect(state.metrics.midPrice).toBe(50005);
    expect(state.metrics.spread).toBe(10);
    expect(state.metrics.spreadPercent).toBeCloseTo((10 / 50005) * 100);
    expect(state.metrics.bidDepth).toBe(30);
    expect(state.metrics.askDepth).toBe(40);
    expect(state.metrics.imbalance).toBe((30 - 40) / 70);

    // Derived scores
    expect(state.metrics.sweepScore).toBeGreaterThan(0);
    expect(state.metrics.absorptionScore).toBeGreaterThan(0);
    expect(state.metrics.bidAskImbalance).toBeCloseTo((30 - 40) / 70);
    expect(state.metrics.volatilityRegime).toBeDefined();
  });
});
