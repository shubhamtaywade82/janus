import { describe, it, expect, beforeEach } from "vitest";
import { OrderbookMaintainer } from "../market-data/orderbook-maintainer.js";
import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";

describe("OrderbookMaintainer", () => {
  let ob: OrderbookMaintainer;

  beforeEach(() => {
    ob = new OrderbookMaintainer("BTCUSDT", "binance");
  });

  const snapshot: OrderbookSnapshot = {
    symbol: "BTCUSDT",
    exchange: "binance",
    bids: [{ price: 50000, size: 1 }, { price: 49900, size: 2 }],
    asks: [{ price: 50100, size: 0.5 }, { price: 50200, size: 3 }],
    sequence: 100,
    ts: Date.now(),
  };

  it("applies snapshot correctly", () => {
    ob.applySnapshot(snapshot);
    expect(ob.bestBid()).toBe(50000);
    expect(ob.bestAsk()).toBe(50100);
    expect(ob.spread()).toBeCloseTo(100);
  });

  it("applies update to modify a level", () => {
    ob.applySnapshot(snapshot);
    ob.applyUpdate({ symbol: "BTCUSDT", exchange: "binance", side: "buy", price: 50000, size: 5, sequence: 101, ts: Date.now() });
    const top = ob.topLevels("bids", 1);
    expect(top[0].size).toBe(5);
  });

  it("removes a level when size=0", () => {
    ob.applySnapshot(snapshot);
    ob.applyUpdate({ symbol: "BTCUSDT", exchange: "binance", side: "buy", price: 50000, size: 0, sequence: 102, ts: Date.now() });
    expect(ob.bestBid()).toBe(49900);
  });

  it("rejects stale sequence numbers", () => {
    ob.applySnapshot(snapshot);
    const applied = ob.applyUpdate({
      symbol: "BTCUSDT", exchange: "binance", side: "buy", price: 50000, size: 99, sequence: 50, ts: Date.now(),
    });
    expect(applied).toBe(false);
    expect(ob.topLevels("bids", 1)[0].size).toBe(1); // unchanged
  });

  it("computes imbalance metrics", () => {
    ob.applySnapshot(snapshot);
    const m = ob.metrics(2);
    expect(m).not.toBeNull();
    expect(m!.imbalance).toBeLessThan(1);
    expect(m!.imbalance).toBeGreaterThan(-1);
    expect(m!.midPrice).toBeCloseTo(50050);
  });
});
