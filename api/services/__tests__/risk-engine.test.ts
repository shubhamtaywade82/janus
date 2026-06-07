import { describe, it, expect, beforeEach } from "vitest";
import { RiskEngine, type RiskSession } from "../risk-engine";

function makeSession(overrides: Partial<RiskSession> = {}): RiskSession {
  return {
    userId: 1,
    date: new Date().toISOString().slice(0, 10),
    startingBalance: 1000,
    realizedPnl: 0,
    tradeCount: 0,
    consecutiveLosses: 0,
    inCooldown: false,
    cooldownUntil: null,
    ...overrides,
  };
}

const config = {
  maxPositionPct: 0.20,
  dailyDrawdownPct: 0.05,
  maxConsecutiveLosses: 3,
  cooldownMs: 30 * 60 * 1000,
  marginHealthHaltPct: 0.85,
};

describe("RiskEngine.checkTradeAllowed", () => {
  let engine: RiskEngine;

  beforeEach(() => { engine = new RiskEngine(config); });

  it("approves trade within all limits", () => {
    const session = makeSession({ startingBalance: 1000 });
    const result = engine.checkTradeAllowed(session, {
      notional: 200,   // exactly 20%
      walletBalance: 1000,
      usedMargin: 0,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when notional exceeds 20% of balance", () => {
    const session = makeSession({ startingBalance: 1000 });
    const result = engine.checkTradeAllowed(session, {
      notional: 300,   // 30% — over limit
      walletBalance: 1000,
      usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("position size");
    expect(result.maxAllowedNotional).toBe(200);
  });

  it("rejects when daily drawdown >= 5%", () => {
    const session = makeSession({ startingBalance: 1000, realizedPnl: -51 });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 949,
      usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("drawdown");
  });

  it("approves when drawdown is just under 5%", () => {
    const session = makeSession({ startingBalance: 1000, realizedPnl: -49 });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 951,
      usedMargin: 0,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects active cooldown", () => {
    const session = makeSession({
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: Date.now() + 60_000,
    });
    const result = engine.checkTradeAllowed(session, {
      notional: 100, walletBalance: 1000, usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("allows trading when cooldown has expired", () => {
    const session = makeSession({
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: Date.now() - 1000,
    });
    const result = engine.checkTradeAllowed(session, {
      notional: 100, walletBalance: 1000, usedMargin: 0,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when margin usage >= 85%", () => {
    const session = makeSession();
    // walletBalance=150, usedMargin=900 → total=1050 → 900/1050=85.7% > 85%
    // notional=20 passes the 20% position size check (20 <= 150*0.20=30)
    const result = engine.checkTradeAllowed(session, {
      notional: 20,
      walletBalance: 150,
      usedMargin: 900,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("margin");
  });

  it("bypasses all checks when isManualOverride=true", () => {
    const session = makeSession({ realizedPnl: -1000, inCooldown: true, cooldownUntil: Date.now() + 99_999 });
    const result = engine.checkTradeAllowed(session, {
      notional: 9999,
      walletBalance: 1,
      usedMargin: 9999,
      isManualOverride: true,
    });
    expect(result.approved).toBe(true);
  });
});

describe("RiskEngine.recordTrade", () => {
  let engine: RiskEngine;

  beforeEach(() => { engine = new RiskEngine(config); });

  it("increments consecutiveLosses on losing trade", () => {
    const session = makeSession();
    const updated = engine.recordTrade(session, { pnl: -50 });
    expect(updated.consecutiveLosses).toBe(1);
    expect(updated.realizedPnl).toBe(-50);
    expect(updated.tradeCount).toBe(1);
  });

  it("resets consecutiveLosses to 0 on winning trade", () => {
    const session = makeSession({ consecutiveLosses: 2 });
    const updated = engine.recordTrade(session, { pnl: 10 });
    expect(updated.consecutiveLosses).toBe(0);
    expect(updated.inCooldown).toBe(false);
  });

  it("sets inCooldown after 3 consecutive losses", () => {
    let session = makeSession();
    session = engine.recordTrade(session, { pnl: -10 });
    session = engine.recordTrade(session, { pnl: -10 });
    session = engine.recordTrade(session, { pnl: -10 });
    expect(session.inCooldown).toBe(true);
    expect(session.cooldownUntil).not.toBeNull();
    expect(session.cooldownUntil!).toBeGreaterThan(Date.now());
  });

  it("accumulates realizedPnl across trades", () => {
    let session = makeSession();
    session = engine.recordTrade(session, { pnl: 20 });
    session = engine.recordTrade(session, { pnl: -5 });
    session = engine.recordTrade(session, { pnl: 15 });
    expect(session.realizedPnl).toBe(30);
    expect(session.tradeCount).toBe(3);
  });
});
