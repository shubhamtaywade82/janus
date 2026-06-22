import { describe, it, expect } from "vitest";
import { getPositionRecommendation } from "../ai-advisor";
import { PositionAction, type ManagedPosition, type MarketContext, type BiasResult } from "../types";

describe("Alpha Protocol - Asset Specific Exits", () => {
  const basePosition: ManagedPosition = {
    id: 1,
    userId: 1,
    exchange: "coindcx",
    symbol: "B-BTC_USDT",
    binanceSymbol: "BTCUSDT",
    side: "LONG",
    quantity: 1,
    entryPrice: 50000,
    markPrice: 50000,
    leverage: 10,
    margin: 5000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    roe: 0,
    liquidationPrice: 45000,
    stopLoss: 49000,
    takeProfit: 52000,
    source: "BOT",
    lifecycleState: "MANAGED",
    isPaper: true,
    marginCurrency: "USDT",
    openedAt: new Date(),
    updatedAt: new Date(),
    riskRewardRatio: null,
    slDistancePct: null,
    liqDistancePct: null,
    holdingMinutes: 10,
    breakevenApplied: false,
    extremePrice: null,
    lastMarkPrice: null,
    openedAlertSent: true,
    strategyType: "alpha_protocol",
  };

  const baseContext: MarketContext = {
    symbol: "BTCUSDT",
    timestamp: new Date(),
    trend: "BULLISH",
    volatilityRegime: "NORMAL",
    structure: "HH_HL",
    volumeProfile: "NORMAL",
    fundingBias: "NEUTRAL",
    rsi14: 60,
    ema20: 49000,
    ema50: 48000,
    ema200: 45000,
    atr14: 500,
    atrPct: 0.01,
    spreadPct: 0.001,
    bidAskImbalance: 0.1,
    cvdTrend: "bullish",
    fundingRate: 0.0001,
    openInterestChange: 0.02,
    confluenceScore: 80,
    confluenceDirection: "long",
    lastPrice: 50000,
    dailyTrend: "BULLISH",
    dailyTrendConfidence: 0.8,
    sma50Daily: 48000,
    sma200Daily: 45000,
    priceVsSma50DailyPct: 0.04,
    priceVsSma200DailyPct: 0.1,
  };

  const bias: BiasResult = {
    bias: "STRONG_BULLISH",
    score: 80,
    confidence: 0.9,
    factors: [],
  };

  const portfolio = {
    totalEquityUsdt: 10000,
    availableBalance: 10000,
    totalUnrealizedPnl: 0,
    openPositionCount: 1,
  };

  it("should trigger 50% partial exit for ETH at 1R profit", async () => {
    // 1R profit is 1000 since entry = 50000, sl = 49000
    const position = {
      ...basePosition,
      symbol: "B-ETH_USDT",
      binanceSymbol: "ETHUSDT",
      markPrice: 51000, // +1000 from entry
      stopLoss: 49000,
      realizedPnl: 0, // Has not scaled out yet
    };

    const ctx = { ...baseContext, lastPrice: 51000 };

    const rec = await getPositionRecommendation(position, ctx, bias, portfolio, false, 5000); // force code-based
    expect(rec.action).toBe(PositionAction.PARTIAL_EXIT);
    expect(rec.exitSizePct).toBe(0.5);
    expect(rec.reasoning).toContain("ETH hybrid scaling: 1R profit reached");
  });

  it("should not trail SL for XRP", async () => {
    const position = {
      ...basePosition,
      symbol: "B-XRP_USDT",
      binanceSymbol: "XRPUSDT",
      markPrice: 55000, // +5000 (10% move, ROE 100%)
      roe: 100, // Should trigger trailing for normal assets
    };

    const ctx = { ...baseContext, lastPrice: 55000 };

    const rec = await getPositionRecommendation(position, ctx, bias, portfolio, false, 5000);
    // XRP shouldn't trigger trailing stop (Rule 4), so it falls back toKEEP_OPEN or something else.
    // Assuming no other rules match, should be KEEP_OPEN
    expect(rec.action).not.toBe(PositionAction.TRAIL_SL);
  });
});
