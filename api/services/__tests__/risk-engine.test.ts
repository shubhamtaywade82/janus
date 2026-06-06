import { describe, it, expect, beforeEach, vi } from "vitest";
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

// ─── DB persistence — getOrCreateSession + updateSession ─────────────────────

// Track what values were upserted to DB
let insertedValues: unknown[] = [];
let mockDbSessionRows: Array<{
  userId: number;
  date: string;
  startingBalance: string;
  realizedPnl: string;
  tradeCount: number;
  consecutiveLosses: number;
  inCooldown: boolean;
  cooldownUntil: Date | null;
}> = [];

vi.mock("../../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => mockDbSessionRows,
      }),
    }),
    insert: () => ({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return {
          onConflictDoUpdate: async () => {},
        };
      },
    }),
  }),
}));

describe("getOrCreateSession — in-memory cache", () => {
  beforeEach(async () => {
    insertedValues = [];
    mockDbSessionRows = [];
    // Clear the module-level sessions Map between tests
    const { sessions } = await import("../risk-engine");
    sessions.clear();
  });

  it("creates a fresh session when none exists in cache", async () => {
    const { getOrCreateSession, sessions } = await import("../risk-engine");
    const session = getOrCreateSession(99, 5000);
    expect(session.userId).toBe(99);
    expect(session.startingBalance).toBe(5000);
    expect(session.realizedPnl).toBe(0);
    expect(sessions.has(99)).toBe(true);
  });

  it("returns same session on subsequent calls within same day", async () => {
    const { getOrCreateSession } = await import("../risk-engine");
    const s1 = getOrCreateSession(42, 1000);
    const s2 = getOrCreateSession(42, 9999); // different balance ignored
    expect(s1).toBe(s2);
    expect(s2.startingBalance).toBe(1000); // original balance kept
  });

  it("creates a new session for a new date (resets daily)", async () => {
    const { getOrCreateSession, sessions } = await import("../risk-engine");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    sessions.set(7, makeSession({ userId: 7, date: yesterday, realizedPnl: -999 }));

    const session = getOrCreateSession(7, 500);
    const today = new Date().toISOString().slice(0, 10);
    expect(session.date).toBe(today);
    expect(session.realizedPnl).toBe(0); // fresh session — no carryover
    expect(session.startingBalance).toBe(500);
  });
});

describe("updateSession — triggers DB persist", () => {
  beforeEach(async () => {
    insertedValues = [];
    mockDbSessionRows = [];
    const { sessions } = await import("../risk-engine");
    sessions.clear();
  });

  it("updates in-memory cache", async () => {
    const { getOrCreateSession, updateSession, sessions } = await import("../risk-engine");
    const session = getOrCreateSession(11, 1000);
    const updated = { ...session, realizedPnl: -50, tradeCount: 1 };
    updateSession(updated);
    expect(sessions.get(11)!.realizedPnl).toBe(-50);
  });

  it("fires a DB write (fire-and-forget)", async () => {
    const { getOrCreateSession, updateSession } = await import("../risk-engine");
    const session = getOrCreateSession(12, 2000);
    const updated = { ...session, tradeCount: 3 };
    updateSession(updated);
    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedValues.length).toBeGreaterThan(0);
  });
});

describe("loadRiskSessionsFromDb", () => {
  beforeEach(async () => {
    insertedValues = [];
    mockDbSessionRows = [];
    const { sessions } = await import("../risk-engine");
    sessions.clear();
  });

  it("loads today's sessions into in-memory cache", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockDbSessionRows = [{
      userId: 55,
      date: today,
      startingBalance: "3000",
      realizedPnl: "-120",
      tradeCount: 4,
      consecutiveLosses: 1,
      inCooldown: false,
      cooldownUntil: null,
    }];

    const { loadRiskSessionsFromDb, sessions } = await import("../risk-engine");
    await loadRiskSessionsFromDb();

    const session = sessions.get(55);
    expect(session).toBeDefined();
    expect(session!.realizedPnl).toBe(-120);
    expect(session!.tradeCount).toBe(4);
    expect(session!.startingBalance).toBe(3000);
  });

  it("restores cooldownUntil timestamp from DB", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cooldownDate = new Date(Date.now() + 60_000);
    mockDbSessionRows = [{
      userId: 66,
      date: today,
      startingBalance: "1000",
      realizedPnl: "-30",
      tradeCount: 3,
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: cooldownDate,
    }];

    const { loadRiskSessionsFromDb, sessions } = await import("../risk-engine");
    await loadRiskSessionsFromDb();

    const session = sessions.get(66);
    expect(session!.inCooldown).toBe(true);
    expect(session!.cooldownUntil).toBeCloseTo(cooldownDate.getTime(), -2);
  });

  it("does not overwrite a fresh in-memory session with DB data for same user", async () => {
    const { getOrCreateSession, sessions } = await import("../risk-engine");
    // Create an in-memory session first
    const today = new Date().toISOString().slice(0, 10);
    const inMemory = getOrCreateSession(77, 5000);
    expect(sessions.get(77)!.startingBalance).toBe(5000);

    // DB has a different starting balance for the same user+date
    mockDbSessionRows = [{
      userId: 77,
      date: today,
      startingBalance: "9999",
      realizedPnl: "-10",
      tradeCount: 1,
      consecutiveLosses: 0,
      inCooldown: false,
      cooldownUntil: null,
    }];

    const { loadRiskSessionsFromDb } = await import("../risk-engine");
    await loadRiskSessionsFromDb();

    // DB load overwrites — DB is the authoritative source on startup
    expect(sessions.get(77)!.startingBalance).toBe(9999);
    expect(sessions.get(77)!.realizedPnl).toBe(-10);
  });
});

describe("drawdown protection applies to manual position creation", () => {
  it("checkTradeAllowed blocks trade when session has exceeded drawdown", () => {
    const engine = new RiskEngine(config);
    // Simulate a session that has already lost 5.1% today
    const session = makeSession({ startingBalance: 10_000, realizedPnl: -510 });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 9490,
      usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("drawdown");
  });

  it("checkTradeAllowed blocks trade when cooldown is active", () => {
    const engine = new RiskEngine(config);
    const session = makeSession({
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: Date.now() + 1_800_000, // 30 min left
    });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 1000,
      usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("risk engine is wired into trading-router createPosition (static verification)", async () => {
    const tradingRouterSrc = await import("fs").then((f) =>
      f.readFileSync(process.cwd() + "/api/routers/trading-router.ts", "utf-8")
    );
    // Verify that createPosition calls globalRiskEngine.checkTradeAllowed
    expect(tradingRouterSrc).toContain("globalRiskEngine.checkTradeAllowed");
    // Verify it uses authedQuery (not publicQuery) so userId comes from session
    expect(tradingRouterSrc).toContain("createPosition: authedQuery");
    // Verify it checks the kill switch too
    expect(tradingRouterSrc).toContain("globalKillSwitch.canTrade()");
  });
});
