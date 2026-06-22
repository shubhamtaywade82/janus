import { describe, it, expect } from "vitest";
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateRMI,
  calculateBollingerBands,
  calculateMACD,
  predictHighLow,
  evaluateGridStrategy,
  evaluateMomentumReversal,
  evaluateBBReversion,
  evaluateMLSizing,
  evaluateScalpingMicro,
  evaluateAlphaProtocol,
} from "../strategies";

describe("Technical Indicators", () => {
  it("should calculate SMA correctly", () => {
    const prices = [10, 11, 12, 13, 14, 15];
    const sma = calculateSMA(prices, 3);
    // Expected values:
    // (10+11+12)/3 = 11
    // (11+12+13)/3 = 12
    // (12+13+14)/3 = 13
    // (13+14+15)/3 = 14
    expect(sma).toEqual([11, 12, 13, 14]);
  });

  it("should calculate EMA correctly", () => {
    const prices = [10, 11, 12, 13, 14, 15];
    const ema = calculateEMA(prices, 3);
    // Period = 3. multiplier k = 2 / 4 = 0.5.
    // Initial EMA (SMA of first 3): (10+11+12)/3 = 11
    // Next EMA: 13 * 0.5 + 11 * 0.5 = 12
    // Next EMA: 14 * 0.5 + 12 * 0.5 = 13
    // Next EMA: 15 * 0.5 + 13 * 0.5 = 14
    expect(ema).toEqual([11, 12, 13, 14]);
  });

  it("should calculate RSI correctly", () => {
    const prices = [
      100, 102, 104, 103, 102, 101, 103, 105, 107, 106, 105, 104, 106, 108, 110,
    ];
    const rsi = calculateRSI(prices, 5);
    expect(rsi.length).toBeGreaterThan(0);
    rsi.forEach((val) => {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    });
  });

  it("should calculate RMI correctly", () => {
    const prices = [
      100, 102, 104, 103, 102, 101, 103, 105, 107, 106, 105, 104, 106, 108, 110,
    ];
    const rmi = calculateRMI(prices, 5, 2);
    expect(rmi.length).toBeGreaterThan(0);
    rmi.forEach((val) => {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    });
  });

  it("should calculate Bollinger Bands correctly", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const bands = calculateBollingerBands(prices, 20, 2);
    expect(bands.upper.length).toBe(11);
    expect(bands.middle.length).toBe(11);
    expect(bands.lower.length).toBe(11);
    for (let i = 0; i < bands.upper.length; i++) {
      expect(bands.upper[i]).toBeGreaterThan(bands.middle[i]);
      expect(bands.middle[i]).toBeGreaterThan(bands.lower[i]);
    }
  });

  it("should calculate MACD correctly", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + (i % 5));
    const macd = calculateMACD(prices, 12, 26, 9);
    expect(macd.macdLine.length).toBeGreaterThan(0);
    expect(macd.signalLine.length).toBe(macd.macdLine.length);
    expect(macd.histogram.length).toBe(macd.macdLine.length);
  });

  it("should predict high/low with linear regression OLS", () => {
    const closes = Array.from({ length: 35 }, (_, i) => 100 + i);
    const highs = Array.from({ length: 35 }, (_, i) => 102 + i);
    const lows = Array.from({ length: 35 }, (_, i) => 98 + i);
    const { predictedHigh, predictedLow } = predictHighLow(closes, highs, lows, 30);
    expect(predictedHigh).toBeGreaterThan(closes[closes.length - 1]);
    expect(predictedLow).toBeLessThan(closes[closes.length - 1]);
  });
});

describe("Strategy Rules Evaluation", () => {

  it("should evaluate Grid Strategy", () => {
    // Fill prices with range behavior: 90 to 110
    const prices = Array.from({ length: 40 }, (_, i) => 90 + (i % 21));
    const result = evaluateGridStrategy(91, prices, 60);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("direction");
    expect(result).toHaveProperty("isGated");
    expect(result.metadata.rangeLow).toBe(90);
    expect(result.metadata.rangeHigh).toBe(110);
  });

  it("should evaluate Momentum Reversal", () => {
    // Generating trend-following data
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const result = evaluateMomentumReversal(130, prices, 60);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("direction");
    expect(result).toHaveProperty("isGated");
  });

  it("should evaluate Bollinger Band Reversion", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const result = evaluateBBReversion(105, prices, 70);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("direction");
    expect(result.isGated).toBeTypeOf("boolean");
  });

  it("should evaluate ML Sizing", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 0.1);
    const highs = closes.map(c => c + 1);
    const lows = closes.map(c => c - 1);
    const result = evaluateMLSizing(105, closes, highs, lows, 70);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("direction");
    expect(result).toHaveProperty("metadata");
  });

  it("should evaluate Micro Scalping", () => {
    const orderBook = {
      bidDepth: 750,
      askDepth: 250,
      spread: 0.1,
      spreadPercent: 0.001,
      imbalance: 0.5,
      midPrice: 100,
    };
    const tradeTape = {
      buyVolume: 100,
      sellVolume: 50,
      delta: 50,
      makerRatio: 0.5,
      avgTradeSize: 10,
      tradeCount: 15,
    };
    const result = evaluateScalpingMicro(100, orderBook, tradeTape, 60);
    expect(result.direction).toBe("long");
    expect(result.isGated).toBe(true);
  });
  it("should evaluate Alpha Protocol - Squeeze", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1);
    const highs = prices.map(p => p + 1);
    const lows = prices.map(p => p - 1);
    const orderBook = { bidDepth: 100, askDepth: 100, spread: 0.1, spreadPercent: 0.1, imbalance: 0, midPrice: 100 };
    const tradeTape = { buyVolume: 100, sellVolume: 50, delta: 50, makerRatio: 0.5, avgTradeSize: 10, tradeCount: 15 };
    const extraMetrics = { fundingRate: -0.005, openInterestChange: 0.1 };
    
    const result = evaluateAlphaProtocol(105, prices, highs, lows, orderBook, tradeTape, extraMetrics, 75);
    expect(result.direction).toBe("long");
    expect(result.score).toBe(85);
    expect(result.metadata.activeTrigger).toBe("squeeze");
  });

  it("should evaluate Alpha Protocol - Breakout", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5); // Strong uptrend
    const highs = prices.map(p => p + 1);
    const lows = prices.map(p => p - 1);
    const orderBook = { bidDepth: 100, askDepth: 100, spread: 0.1, spreadPercent: 0.1, imbalance: 0, midPrice: 100 };
    const tradeTape = { buyVolume: 100, sellVolume: 100, delta: 0, makerRatio: 0.5, avgTradeSize: 10, tradeCount: 15 };
    
    // Set current price high enough to break out of recent high
    const result = evaluateAlphaProtocol(140, prices, highs, lows, orderBook, tradeTape, {}, 75);
    expect(result.direction).toBe("long");
    expect(result.score).toBe(80);
    expect(result.metadata.activeTrigger).toBe("breakout");
  });
});
