import { describe, it, expect } from "vitest";
import { classifyRegime, regimeToStrategy, type RegimeInput } from "../regime-detector";

function makeInput(overrides: Partial<RegimeInput> = {}): RegimeInput {
  return {
    adx1h: 15,
    atrPct1h: 0.3,
    ema20_1h: 100,
    ema50_1h: 100,
    ema50_4h: 100,
    ema200_4h: 100,
    spreadPct: 0.05,
    rsi1h: 50,
    ...overrides,
  };
}

describe("classifyRegime", () => {
  it("returns ranging_tight when ADX<15 and spread<0.02%", () => {
    expect(classifyRegime(makeInput({ adx1h: 12, spreadPct: 0.01 }))).toBe("ranging_tight");
  });

  it("returns ranging when ADX<20 and spread>=0.02%", () => {
    expect(classifyRegime(makeInput({ adx1h: 18, spreadPct: 0.05 }))).toBe("ranging");
  });

  it("returns high_volatility when ATR>2% — overrides ADX", () => {
    expect(classifyRegime(makeInput({ adx1h: 35, atrPct1h: 2.5 }))).toBe("high_volatility");
    expect(classifyRegime(makeInput({ adx1h: 10, atrPct1h: 3.0 }))).toBe("high_volatility");
  });

  it("returns swing_trend when ADX>30", () => {
    expect(classifyRegime(makeInput({ adx1h: 32, atrPct1h: 0.8 }))).toBe("swing_trend");
  });

  it("returns reversal when ADX>=20 and RSI<30", () => {
    expect(classifyRegime(makeInput({ adx1h: 22, rsi1h: 25 }))).toBe("reversal");
  });

  it("returns reversal when ADX>=20 and RSI>70", () => {
    expect(classifyRegime(makeInput({ adx1h: 25, rsi1h: 75 }))).toBe("reversal");
  });

  it("returns intraday_trend when ADX 20-30 and RSI normal", () => {
    expect(classifyRegime(makeInput({ adx1h: 24, rsi1h: 50 }))).toBe("intraday_trend");
  });

  it("high_volatility has highest priority even with low ADX", () => {
    expect(classifyRegime(makeInput({ adx1h: 12, atrPct1h: 2.1, spreadPct: 0.01 }))).toBe("high_volatility");
  });

  it("swing_trend requires ADX>30 but not high volatility", () => {
    expect(classifyRegime(makeInput({ adx1h: 31, atrPct1h: 0.9 }))).toBe("swing_trend");
  });
});

describe("regimeToStrategy", () => {
  it("ranging_tight → grid", () => {
    expect(regimeToStrategy("ranging_tight")).toBe("grid");
  });
  it("ranging → bb_reversion", () => {
    expect(regimeToStrategy("ranging")).toBe("bb_reversion");
  });
  it("reversal → momentum_reversal", () => {
    expect(regimeToStrategy("reversal")).toBe("momentum_reversal");
  });
  it("intraday_trend → intraday", () => {
    expect(regimeToStrategy("intraday_trend")).toBe("intraday");
  });
  it("swing_trend → swing", () => {
    expect(regimeToStrategy("swing_trend")).toBe("swing");
  });
  it("high_volatility → intraday", () => {
    expect(regimeToStrategy("high_volatility")).toBe("intraday");
  });
});
