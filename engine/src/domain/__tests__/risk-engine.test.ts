import { describe, it, expect } from "vitest";
import { RiskEngine } from "../../application/services/risk-engine.js";
import type { TradeSignal } from "../signals/trade-signal.js";
import type { Portfolio } from "../portfolio/portfolio.js";

const portfolio: Portfolio = {
  accountId: "test",
  exchange: "coindcx",
  cashBalance: 10000,
  equity: 10000,
  usedMargin: 0,
  freeMargin: 10000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  totalFees: 0,
  netProfit: 0,
  updatedAt: Date.now(),
};

const signal: TradeSignal = {
  id: "sig1",
  symbol: "BTCUSDT",
  exchange: "coindcx",
  side: "buy",
  confidence: 0.80,
  score: 80,
  quantity: 0.1,
  orderType: "limit",
  strategyId: "test",
  ts: Date.now(),
};

describe("RiskEngine", () => {
  const engine = new RiskEngine();

  it("approves a valid signal", () => {
    const decision = engine.evaluate(signal, portfolio, 0);
    expect(decision.approved).toBe(true);
  });

  it("rejects low-confidence signals", () => {
    const decision = engine.evaluate({ ...signal, confidence: 0.5 }, portfolio, 0);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("confidence");
  });

  it("rejects when max open positions reached", () => {
    const decision = engine.evaluate(signal, portfolio, 5);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("max open positions");
  });

  it("rejects when equity is zero", () => {
    const decision = engine.evaluate(signal, { ...portfolio, equity: 0 }, 0);
    expect(decision.approved).toBe(false);
  });
});
