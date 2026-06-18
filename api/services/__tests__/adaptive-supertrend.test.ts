import { describe, expect, it } from "vitest";
import {
  classifyErRegime,
  klinesToAdaptiveCandles,
  runAdaptiveSupertrendEngine,
  type AdaptiveCandle,
} from "../../../src/lib/adaptive-supertrend";

function makeTrendCandles(n: number, start = 100, step = 0.5): AdaptiveCandle[] {
  const candles: AdaptiveCandle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + step;
    candles.push({
      i,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      vol: 1000,
    });
    price = close;
  }
  return candles;
}

describe("adaptive-supertrend engine", () => {
  it("converts kline strings to numeric candles", () => {
    const candles = klinesToAdaptiveCandles([
      { open: "100", high: "105", low: "99", close: "104", volume: "1200" },
    ]);
    expect(candles[0]).toMatchObject({
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      vol: 1200,
    });
  });

  it("produces aligned series on candle input", () => {
    const candles = makeTrendCandles(80);
    const result = runAdaptiveSupertrendEngine(candles, {
      atrPeriod: 10,
      erLength: 14,
      smoothLength: 5,
      minFactor: 1.5,
      maxFactor: 4.5,
    });

    expect(result.stLine.length).toBe(candles.length);
    expect(result.direction.length).toBe(candles.length);
    expect(result.equityCurve.length).toBe(candles.length);
    expect(result.stLine.some((v) => !Number.isNaN(v))).toBe(true);
  });

  it("classifies ER regimes", () => {
    expect(classifyErRegime(0.7)).toBe("Trending");
    expect(classifyErRegime(0.4)).toBe("Mixed");
    expect(classifyErRegime(0.1)).toBe("Choppy");
  });
});
