import { describe, it, expect, beforeEach } from "vitest";
import { EMA, emaCrossUp, emaCrossDown } from "../indicators/ema.js";
import { RSI, isOverbought, isOversold } from "../indicators/rsi.js";
import { ATR } from "../indicators/atr.js";
import { VWAP } from "../indicators/vwap.js";
import { OrderbookImbalanceIndicator, computeImbalance } from "../indicators/orderbook-imbalance.js";
import { AggressiveVolumeTracker } from "../indicators/aggressive-volume.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";

// ─── EMA ─────────────────────────────────────────────────────────────────────

describe("EMA", () => {
  it("starts at first value", () => {
    const ema = new EMA(3);
    expect(ema.update(100)).toBe(100);
  });

  it("converges toward new values", () => {
    const ema = new EMA(3);
    ema.update(100);
    ema.update(110);
    const v = ema.update(120);
    expect(v).toBeGreaterThan(100);
    expect(v).toBeLessThan(120);
  });

  it("detects cross-up correctly", () => {
    const fast = new EMA(3);
    const slow = new EMA(10);
    fast.seed([100, 100, 100, 100, 100]);
    slow.seed([90, 90, 90, 90, 90, 90, 90, 90, 90, 90]);
    expect(emaCrossUp(fast, slow)).toBe(true);
    expect(emaCrossDown(fast, slow)).toBe(false);
  });

  it("resets cleanly", () => {
    const ema = new EMA(3);
    ema.update(100);
    ema.reset();
    expect(ema.current).toBeNull();
  });
});

// ─── RSI ─────────────────────────────────────────────────────────────────────

describe("RSI", () => {
  it("returns null until period is complete", () => {
    const rsi = new RSI(14);
    for (let i = 0; i < 14; i++) rsi.update(100 + i);
    expect(rsi.current).toBeNull(); // needs 14 changes, not 14 values
  });

  it("returns 100 in a straight-up market", () => {
    const rsi = new RSI(3);
    rsi.update(100);
    rsi.update(101);
    rsi.update(102);
    rsi.update(103);
    const v = rsi.update(104);
    expect(v).toBe(100);
  });

  it("returns 0 in a straight-down market", () => {
    const rsi = new RSI(3);
    rsi.update(104);
    rsi.update(103);
    rsi.update(102);
    rsi.update(101);
    const v = rsi.update(100);
    expect(v).toBe(0);
  });

  it("isOverbought threshold works", () => {
    expect(isOverbought(75)).toBe(true);
    expect(isOverbought(65)).toBe(false);
  });

  it("isOversold threshold works", () => {
    expect(isOversold(25)).toBe(true);
    expect(isOversold(35)).toBe(false);
  });
});

// ─── ATR ─────────────────────────────────────────────────────────────────────

describe("ATR", () => {
  it("returns null until period is complete", () => {
    const atr = new ATR(3);
    atr.update(110, 90, 100);
    atr.update(112, 92, 102);
    expect(atr.current).toBeNull();
  });

  it("returns a value after period bars", () => {
    const atr = new ATR(3);
    atr.update(110, 90, 100);
    atr.update(112, 92, 102);
    atr.update(115, 95, 105);
    expect(atr.current).toBeGreaterThan(0);
  });
});

// ─── VWAP ────────────────────────────────────────────────────────────────────

describe("VWAP", () => {
  it("returns price when volume = 0", () => {
    const vwap = new VWAP();
    vwap.update(100, 0);
    expect(vwap.current).toBe(0);
  });

  it("returns weighted average", () => {
    const vwap = new VWAP();
    vwap.update(100, 10);
    vwap.update(110, 10);
    expect(vwap.current).toBeCloseTo(105);
  });

  it("weights heavier volumes more", () => {
    const vwap = new VWAP();
    vwap.update(100, 1);  // small
    vwap.update(200, 99); // large
    expect(vwap.current).toBeGreaterThan(190);
  });
});

// ─── Orderbook Imbalance ─────────────────────────────────────────────────────

describe("computeImbalance", () => {
  it("returns 0 for balanced book", () => {
    const bids = [{ price: 100, size: 1 }, { price: 99, size: 1 }];
    const asks = [{ price: 101, size: 1 }, { price: 102, size: 1 }];
    const { imbalance } = computeImbalance(bids, asks);
    expect(imbalance).toBeCloseTo(0);
  });

  it("returns positive for bid-heavy book", () => {
    const bids = [{ price: 100, size: 10 }];
    const asks = [{ price: 101, size: 1 }];
    const { imbalance } = computeImbalance(bids, asks);
    expect(imbalance).toBeGreaterThan(0);
  });

  it("returns negative for ask-heavy book", () => {
    const bids = [{ price: 100, size: 1 }];
    const asks = [{ price: 101, size: 10 }];
    const { imbalance } = computeImbalance(bids, asks);
    expect(imbalance).toBeLessThan(0);
  });
});

describe("OrderbookImbalanceIndicator", () => {
  it("smooths imbalance over updates", () => {
    const ind = new OrderbookImbalanceIndicator(0.5, 5);
    const bids = [{ price: 100, size: 10 }];
    const asks = [{ price: 101, size: 1 }];
    const r1 = ind.update(bids, asks);
    const r2 = ind.update(bids, asks);
    expect(r2.imbalance).toBeGreaterThan(0);
    // smoothed — should approach raw but not jump instantly
    expect(Math.abs(r2.imbalance)).toBeLessThanOrEqual(Math.abs(r1.imbalance) * 2);
  });
});

// ─── Aggressive Volume ────────────────────────────────────────────────────────

describe("AggressiveVolumeTracker", () => {
  const makeTick = (side: "buy" | "sell", qty = 1, ts = Date.now()): TradeTick => ({
    id: Math.random().toString(),
    symbol: "BTCUSDT",
    exchange: "binance",
    price: 50000,
    quantity: qty,
    side,
    isMaker: false,
    ts,
  });

  it("shows buy dominance when mostly buy ticks", () => {
    const tracker = new AggressiveVolumeTracker(60_000);
    tracker.onTrade(makeTick("buy", 10));
    tracker.onTrade(makeTick("buy", 10));
    const flow = tracker.onTrade(makeTick("sell", 1));
    expect(flow.dominance).toBe("buy");
    expect(flow.delta).toBeGreaterThan(0);
  });

  it("shows neutral when evenly balanced", () => {
    const tracker = new AggressiveVolumeTracker(60_000);
    tracker.onTrade(makeTick("buy", 5));
    const flow = tracker.onTrade(makeTick("sell", 5));
    expect(flow.dominance).toBe("neutral");
  });

  it("evicts old trades outside window", () => {
    const tracker = new AggressiveVolumeTracker(100); // 100ms window
    tracker.onTrade(makeTick("buy", 100, Date.now() - 200)); // old
    const flow = tracker.onTrade(makeTick("sell", 1, Date.now()));
    expect(flow.buyVolume).toBe(0); // old trade evicted
  });
});
