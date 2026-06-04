import { describe, it, expect } from "vitest";
import { SymbolRegistry, DEFAULT_SYMBOL_MAPPINGS } from "../instruments/symbol-mapping.js";
import { buildVenueSnapshot, isDriftExcessive } from "../../application/ports/venue-snapshot.port.js";

describe("SymbolRegistry", () => {
  const registry = new SymbolRegistry(DEFAULT_SYMBOL_MAPPINGS);

  it("looks up by strategy symbol", () => {
    const m = registry.fromStrategy("BTCUSDT");
    expect(m).toBeDefined();
    expect(m!.coindcxSymbol).toBe("B-BTC_USDT");
    expect(m!.deltaSymbol).toBe("BTCUSDT");
  });

  it("looks up by Binance WS symbol (lowercase)", () => {
    const m = registry.fromBinance("ethusdt");
    expect(m?.strategySymbol).toBe("ETHUSDT");
  });

  it("looks up by CoinDCX pair", () => {
    const m = registry.fromCoinDCX("B-SOL_USDT");
    expect(m?.strategySymbol).toBe("SOLUSDT");
  });

  it("returns undefined for unknown symbol", () => {
    expect(registry.fromStrategy("UNKNOWN")).toBeUndefined();
  });

  it("returns all mappings", () => {
    expect(registry.all().length).toBe(DEFAULT_SYMBOL_MAPPINGS.length);
  });
});

describe("VenueSnapshot", () => {
  it("computes drift correctly", () => {
    const snap = buildVenueSnapshot("BTCUSDT", 50000, 50100, 50080, 50180);
    const dataMid = (50000 + 50100) / 2;  // 50050
    const execMid = (50080 + 50180) / 2;  // 50130
    expect(snap.drift).toBeCloseTo(execMid - dataMid);
    expect(snap.driftBps).toBeGreaterThan(0);
  });

  it("isDriftExcessive returns true when drift > threshold", () => {
    const snap = buildVenueSnapshot("BTCUSDT", 50000, 50100, 50200, 50300);
    // drift ≈ 200 bps
    expect(isDriftExcessive(snap, 10)).toBe(true);
    expect(isDriftExcessive(snap, 1000)).toBe(false);
  });

  it("isDriftExcessive returns false for zero drift", () => {
    const snap = buildVenueSnapshot("BTCUSDT", 50000, 50100, 50000, 50100);
    expect(isDriftExcessive(snap, 5)).toBe(false);
  });
});
