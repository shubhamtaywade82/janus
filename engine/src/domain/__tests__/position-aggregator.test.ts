import { describe, it, expect } from "vitest";
import { PositionAggregator } from "../positions/position-aggregator.js";
import type { Fill } from "../fills/fill.js";

const makeFill = (overrides: Partial<Fill> = {}): Fill => ({
  id: "f1",
  orderId: "o1",
  symbol: "BTCUSDT",
  exchange: "coindcx",
  side: "buy",
  price: 50000,
  quantity: 0.1,
  fee: 5,
  feeCurrency: "USDT",
  isMaker: false,
  ts: Date.now(),
  ...overrides,
});

describe("PositionAggregator", () => {
  it("returns null when fills net to zero", () => {
    const fills: Fill[] = [
      makeFill({ id: "f1", side: "buy", quantity: 0.1 }),
      makeFill({ id: "f2", side: "sell", quantity: 0.1 }),
    ];
    const pos = PositionAggregator.fromFills("BTCUSDT", "coindcx", fills, 50000);
    expect(pos).toBeNull();
  });

  it("builds a long position from buy fills", () => {
    const fills = [makeFill({ quantity: 0.5 })];
    const pos = PositionAggregator.fromFills("BTCUSDT", "coindcx", fills, 55000);
    expect(pos).not.toBeNull();
    expect(pos!.side).toBe("long");
    expect(pos!.netQuantity).toBeCloseTo(0.5);
    expect(pos!.averageEntryPrice).toBeCloseTo(50000);
    expect(pos!.unrealizedPnl).toBeCloseTo(2500); // (55000-50000)*0.5
  });

  it("builds a short position", () => {
    const fills: Fill[] = [
      makeFill({ id: "f1", side: "sell", price: 60000, quantity: 1 }),
    ];
    const pos = PositionAggregator.fromFills("BTCUSDT", "coindcx", fills, 55000);
    expect(pos!.side).toBe("short");
    expect(pos!.unrealizedPnl).toBeCloseTo(5000); // (60000-55000)*1
  });

  it("computes average entry from multiple fills", () => {
    const fills: Fill[] = [
      makeFill({ id: "f1", price: 40000, quantity: 1 }),
      makeFill({ id: "f2", price: 60000, quantity: 1 }),
    ];
    const pos = PositionAggregator.fromFills("BTCUSDT", "coindcx", fills, 50000);
    expect(pos!.averageEntryPrice).toBeCloseTo(50000);
  });
});
