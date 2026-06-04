import { describe, it, expect, beforeEach } from "vitest";
import { CandleStore, MultiTimeframeCandleStore } from "../analysis/candle-store.js";
import type { Candle } from "../../domain/market-data/candle.js";

function makeCandle(close: number, openTime: number): Candle {
  return {
    symbol: "BTCUSDT",
    exchange: "test",
    interval: "1m",
    openTime,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100,
    quoteVolume: 0,
    trades: 0,
    closed: true,
  };
}

describe("CandleStore", () => {
  let store: CandleStore;

  beforeEach(() => { store = new CandleStore("1m"); });

  it("starts empty", () => {
    expect(store.size).toBe(0);
    expect(store.candles).toHaveLength(0);
  });

  it("inserts a new candle", () => {
    store.upsert(makeCandle(100, 1000));
    expect(store.size).toBe(1);
  });

  it("updates an existing candle by openTime (live update)", () => {
    store.upsert(makeCandle(100, 1000));
    store.upsert(makeCandle(105, 1000)); // same openTime → update
    expect(store.size).toBe(1);
    expect(store.latest()?.close).toBe(105);
  });

  it("evicts oldest when capacity is exceeded", () => {
    const small = new CandleStore("1m", 3);
    small.upsert(makeCandle(100, 1000));
    small.upsert(makeCandle(101, 2000));
    small.upsert(makeCandle(102, 3000));
    small.upsert(makeCandle(103, 4000)); // should evict 100
    expect(small.size).toBe(3);
    expect(small.candles[0].close).toBe(101); // oldest is now 101
  });

  it("returns candles sorted oldest-first", () => {
    store.upsert(makeCandle(103, 3000));
    store.upsert(makeCandle(101, 1000));
    store.upsert(makeCandle(102, 2000));
    const sorted = store.candles;
    expect(sorted[0].openTime).toBe(1000);
    expect(sorted[1].openTime).toBe(2000);
    expect(sorted[2].openTime).toBe(3000);
  });

  it("seeds bulk candles correctly", () => {
    const bulk = Array.from({ length: 10 }, (_, i) => makeCandle(100 + i, i * 60_000));
    store.seed(bulk);
    expect(store.size).toBe(10);
  });
});

describe("MultiTimeframeCandleStore", () => {
  it("isolates candles per timeframe", () => {
    const mtf = new MultiTimeframeCandleStore();
    mtf.upsert("1m", makeCandle(100, 1000));
    mtf.upsert("5m", makeCandle(200, 1000));
    expect(mtf.candles("1m")).toHaveLength(1);
    expect(mtf.candles("5m")).toHaveLength(1);
    expect(mtf.candles("1m")[0].close).toBe(100);
    expect(mtf.candles("5m")[0].close).toBe(200);
  });

  it("returns empty array for unknown timeframe", () => {
    const mtf = new MultiTimeframeCandleStore();
    expect(mtf.candles("4h")).toHaveLength(0);
  });

  it("lists known timeframes", () => {
    const mtf = new MultiTimeframeCandleStore();
    mtf.upsert("1m", makeCandle(100, 1000));
    mtf.upsert("1h", makeCandle(100, 1000));
    const tfs = mtf.timeframes();
    expect(tfs).toContain("1m");
    expect(tfs).toContain("1h");
  });
});
