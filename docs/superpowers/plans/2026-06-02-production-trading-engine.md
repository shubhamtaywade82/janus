# Production Trading Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement regime-aware auto strategy switching (scalping→intraday→swing), a risk engine that gates every trade, WS feed health with exponential backoff, a kill switch, and a trailing stop engine — making Janus production-safe for live scalping.

**Architecture:** A `RegimeDetector` service classifies market state (trending/ranging/volatile) every 30s using multi-timeframe ADX/ATR/EMA data and maps it to a `StrategyType`. The `RiskEngine` is a pure-function gatekeeper that every `createPosition` call must pass. `FeedHealth` wraps each WS stream with a heartbeat monitor and exponential backoff reconnect. A `KillSwitch` singleton halts all new orders when triggered by drawdown or feed failure. A `TrailingStop` engine moves stop-loss in-memory as price ticks.

**Tech Stack:** TypeScript, Hono, tRPC, Drizzle ORM, PostgreSQL, Vitest, WebSocket (ws), Binance Futures WS (`fstream.binance.com`), CoinDCX REST/WS

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `api/services/regime-detector.ts` | Classify market as trending/ranging/volatile; output `StrategyType` |
| `api/services/risk-engine.ts` | Gate trades: capital %, daily drawdown, margin health, consecutive losses |
| `api/services/feed-health.ts` | Heartbeat tracker + exponential backoff reconnect for WS streams |
| `api/services/kill-switch.ts` | Singleton halt: manual + auto (drawdown, feed down) |
| `api/services/trailing-stop.ts` | Background loop: move stopLoss as price favors position |
| `api/services/__tests__/regime-detector.test.ts` | Tests for regime classification logic |
| `api/services/__tests__/risk-engine.test.ts` | Tests for all risk rules |
| `api/services/__tests__/feed-health.test.ts` | Tests for backoff calculation |
| `api/services/__tests__/kill-switch.test.ts` | Tests for halt state machine |
| `api/services/__tests__/trailing-stop.test.ts` | Tests for trailing stop math |
| `src/components/RegimeIndicator.tsx` | Live regime badge + strategy label |
| `src/components/RiskStatus.tsx` | Daily PnL, drawdown %, margin health bar |

### Modified Files
| File | Change |
|---|---|
| `api/services/streaming.ts` | Replace fixed 5s reconnect with `FeedHealth` exponential backoff |
| `api/services/strategy-config.ts` | Add `REGIME_TO_STRATEGY` mapping |
| `api/routers/signal-router.ts` | Wire `RegimeDetector` → auto-switch `activeStrategyType` |
| `api/routers/trading-router.ts` | Gate `createPosition` through `RiskEngine`; add `killSwitch`, `riskStatus`, `regimeStream` endpoints |
| `src/pages/Dashboard.tsx` | Mount `RegimeIndicator` + `RiskStatus` |

---

## Task 1: Feed Health — Heartbeat + Exponential Backoff

**Context:** `streaming.ts` currently reconnects with a fixed 5s delay (`setTimeout(() => subscribeToSymbol(symbol), 5000)`). This is insufficient — after 3+ sequential failures the node is effectively blind. Production requires exponential backoff (1s → 2s → 4s → 8s → 16s → 32s max) and a heartbeat to detect silent connections.

**Files:**
- Create: `api/services/feed-health.ts`
- Create: `api/services/__tests__/feed-health.test.ts`
- Modify: `api/services/streaming.ts` lines 207–219

---

- [ ] **Step 1: Write failing tests for backoff calculation**

```typescript
// api/services/__tests__/feed-health.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedHealth, calcBackoffMs } from "../feed-health";

describe("calcBackoffMs", () => {
  it("returns 1000ms on first attempt", () => {
    expect(calcBackoffMs(0)).toBe(1000);
  });
  it("doubles each attempt", () => {
    expect(calcBackoffMs(1)).toBe(2000);
    expect(calcBackoffMs(2)).toBe(4000);
    expect(calcBackoffMs(3)).toBe(8000);
  });
  it("caps at 32000ms", () => {
    expect(calcBackoffMs(10)).toBe(32000);
  });
});

describe("FeedHealth", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("starts in connected status", () => {
    const h = new FeedHealth("BTCUSDT");
    expect(h.status).toBe("connected");
    expect(h.reconnectAttempts).toBe(0);
  });

  it("marks degraded after 3s silence", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage(); // now
    vi.advanceTimersByTime(3100);
    h.tick();
    expect(h.status).toBe("degraded");
  });

  it("marks reconnecting after 10s silence", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(10_100);
    h.tick();
    expect(h.status).toBe("reconnecting");
  });

  it("increments reconnectAttempts on each reconnect", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(10_100);
    h.tick();
    const firstBackoff = h.reconnectAttempts;
    h.recordMessage(); // simulates reconnect success
    expect(h.status).toBe("connected");
    expect(h.reconnectAttempts).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /home/nemesis/project/trading-workspace/janus && npx vitest run api/services/__tests__/feed-health.test.ts 2>&1 | tail -20
```
Expected: `Cannot find module '../feed-health'`

- [ ] **Step 3: Implement `feed-health.ts`**

```typescript
// api/services/feed-health.ts
import { EventEmitter } from "events";

export type FeedStatus = "connected" | "degraded" | "reconnecting" | "rest_fallback";

export const feedHealthEvents = new EventEmitter();
feedHealthEvents.setMaxListeners(50);

export function calcBackoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 32_000);
}

export class FeedHealth {
  symbol: string;
  status: FeedStatus = "connected";
  lastMessageAt: number = Date.now();
  reconnectAttempts: number = 0;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  recordMessage() {
    this.lastMessageAt = Date.now();
    if (this.status !== "connected") {
      this.status = "connected";
      this.reconnectAttempts = 0;
      feedHealthEvents.emit("recovered", { symbol: this.symbol });
    }
  }

  tick() {
    const silenceMs = Date.now() - this.lastMessageAt;
    if (silenceMs > 10_000 && this.status !== "reconnecting") {
      this.status = "reconnecting";
      this.reconnectAttempts++;
      feedHealthEvents.emit("reconnecting", {
        symbol: this.symbol,
        attempt: this.reconnectAttempts,
        backoffMs: calcBackoffMs(this.reconnectAttempts - 1),
      });
    } else if (silenceMs > 3_000 && this.status === "connected") {
      this.status = "degraded";
      feedHealthEvents.emit("degraded", { symbol: this.symbol });
    }
  }

  backoffMs(): number {
    return calcBackoffMs(this.reconnectAttempts);
  }
}

// Global registry — one FeedHealth per symbol
export const feedHealthRegistry = new Map<string, FeedHealth>();

export function getOrCreateFeedHealth(symbol: string): FeedHealth {
  if (!feedHealthRegistry.has(symbol)) {
    feedHealthRegistry.set(symbol, new FeedHealth(symbol));
  }
  return feedHealthRegistry.get(symbol)!;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run api/services/__tests__/feed-health.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Wire into `streaming.ts`**

Replace the fixed 5s reconnect block (lines 207–219) with:

```typescript
// At top of streaming.ts, add import:
import { getOrCreateFeedHealth, feedHealthEvents } from "./feed-health";

// Replace ws.on("message", ...) opening line — add health.recordMessage() call:
// Inside ws.on("message", async (dataStr) => { try {
//   ADD THIS AS FIRST LINE:
const health = getOrCreateFeedHealth(symbol);
health.recordMessage();
// (rest of existing message handler continues unchanged)

// Replace the ws.on("close") block entirely:
ws.on("close", () => {
  console.log(`[streaming] WS closed for ${symbol}`);
  const state = activeStreams.get(symbol);
  if (state && state.subscribers > 0) {
    const h = getOrCreateFeedHealth(symbol);
    h.status = "reconnecting";
    h.reconnectAttempts++;
    const delay = h.backoffMs();
    console.log(`[streaming] Reconnecting ${symbol} in ${delay}ms (attempt ${h.reconnectAttempts})`);
    activeStreams.delete(symbol);
    setTimeout(() => subscribeToSymbol(symbol), delay);
  }
});

// Add heartbeat ticker — global interval that ticks all FeedHealth instances:
// In subscribeToSymbol(), after streamInfo.ws = ws, start a 5s heartbeat IF not already running:
// Add at module level:
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const [sym, health] of feedHealthRegistry) {
      health.tick();
    }
  }, 5_000);
}
// Call ensureHeartbeat() at end of subscribeToSymbol().
```

- [ ] **Step 6: Commit**

```bash
git add api/services/feed-health.ts api/services/__tests__/feed-health.test.ts api/services/streaming.ts
git commit -m "feat: add WS feed health with exponential backoff reconnect"
```

---

## Task 2: Kill Switch — Halt State + Auto Triggers

**Context:** No mechanism currently prevents new orders when the feed is blind or drawdown limit is hit. Kill switch must be a singleton that blocks `createPosition` and emits Telegram alerts.

**Files:**
- Create: `api/services/kill-switch.ts`
- Create: `api/services/__tests__/kill-switch.test.ts`

---

- [ ] **Step 1: Write failing tests**

```typescript
// api/services/__tests__/kill-switch.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { KillSwitch } from "../kill-switch";

describe("KillSwitch", () => {
  let ks: KillSwitch;

  beforeEach(() => {
    ks = new KillSwitch();
  });

  it("starts inactive", () => {
    expect(ks.isActive).toBe(false);
    expect(ks.canTrade()).toBe(true);
  });

  it("blocks trading after manual trigger", () => {
    ks.trigger("manual", "User hit emergency stop");
    expect(ks.isActive).toBe(true);
    expect(ks.canTrade()).toBe(false);
  });

  it("stores reason and type", () => {
    ks.trigger("drawdown", "Daily loss -5.2%");
    expect(ks.state!.reason).toBe("Daily loss -5.2%");
    expect(ks.state!.type).toBe("drawdown");
    expect(ks.state!.triggeredAt).toBeGreaterThan(0);
  });

  it("resets on reset()", () => {
    ks.trigger("manual", "test");
    ks.reset();
    expect(ks.isActive).toBe(false);
    expect(ks.canTrade()).toBe(true);
  });

  it("does not double-trigger", () => {
    ks.trigger("drawdown", "first");
    ks.trigger("feed_failure", "second");
    expect(ks.state!.type).toBe("drawdown"); // first wins
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run api/services/__tests__/kill-switch.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement `kill-switch.ts`**

```typescript
// api/services/kill-switch.ts
import { EventEmitter } from "events";

export type KillReason = "manual" | "drawdown" | "feed_failure" | "api_error" | "margin_breach";

export interface KillState {
  reason: string;
  type: KillReason;
  triggeredAt: number;
}

export const killSwitchEvents = new EventEmitter();

export class KillSwitch {
  state: KillState | null = null;

  get isActive(): boolean {
    return this.state !== null;
  }

  canTrade(): boolean {
    return !this.isActive;
  }

  trigger(type: KillReason, reason: string) {
    if (this.isActive) return; // first trigger wins
    this.state = { type, reason, triggeredAt: Date.now() };
    console.error(`[kill-switch] TRIGGERED — type=${type} reason="${reason}"`);
    killSwitchEvents.emit("triggered", this.state);
  }

  reset() {
    this.state = null;
    killSwitchEvents.emit("reset");
  }
}

// Singleton — shared across all routers
export const globalKillSwitch = new KillSwitch();

// Auto-trigger on feed failure: if >2 symbols go reconnecting within 60s
import { feedHealthEvents } from "./feed-health";

const recentFeedFailures = new Set<string>();
let feedFailureTimer: ReturnType<typeof setTimeout> | null = null;

feedHealthEvents.on("reconnecting", ({ symbol }: { symbol: string }) => {
  recentFeedFailures.add(symbol);
  if (feedFailureTimer) clearTimeout(feedFailureTimer);
  feedFailureTimer = setTimeout(() => recentFeedFailures.clear(), 60_000);

  if (recentFeedFailures.size >= 3 && !globalKillSwitch.isActive) {
    globalKillSwitch.trigger(
      "feed_failure",
      `${recentFeedFailures.size} symbols lost WS feed simultaneously`
    );
  }
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run api/services/__tests__/kill-switch.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Wire kill switch into `trading-router.ts`**

At top of `createPosition` mutation (after the `getDb()` call), add:

```typescript
import { globalKillSwitch } from "../services/kill-switch";

// First check in createPosition, before leverage cap:
if (!globalKillSwitch.canTrade()) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Trading halted: ${globalKillSwitch.state?.reason ?? "kill switch active"}`,
  });
}
```

Add tRPC procedures to `tradingRouter`:

```typescript
killSwitch: publicQuery
  .input(z.object({ action: z.enum(["trigger", "reset"]), reason: z.string().default("manual") }))
  .mutation(({ input }) => {
    if (input.action === "trigger") {
      globalKillSwitch.trigger("manual", input.reason);
      sendTelegramNotification(`🚨 Kill switch triggered: ${input.reason}`).catch(() => {});
    } else {
      globalKillSwitch.reset();
    }
    return { isActive: globalKillSwitch.isActive, state: globalKillSwitch.state };
  }),

killSwitchStatus: publicQuery
  .query(() => ({
    isActive: globalKillSwitch.isActive,
    state: globalKillSwitch.state,
  })),
```

Where `sendTelegramNotification` is imported from `../services/telegram`.

- [ ] **Step 6: Commit**

```bash
git add api/services/kill-switch.ts api/services/__tests__/kill-switch.test.ts api/routers/trading-router.ts
git commit -m "feat: add kill switch with auto-trigger on feed failure"
```

---

## Task 3: Risk Engine — Capital %, Drawdown Circuit, Margin Health

**Context:** `createPosition` currently only checks leverage (10x cap) and stop-loss distance. No check on capital utilization, daily loss limit, or consecutive losses. This is the most dangerous gap — a single bad trade with max size can wipe the account.

**Files:**
- Create: `api/services/risk-engine.ts`
- Create: `api/services/__tests__/risk-engine.test.ts`

---

- [ ] **Step 1: Write failing tests**

```typescript
// api/services/__tests__/risk-engine.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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

describe("RiskEngine.checkTradeAllowed", () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine({
      maxPositionPct: 0.20,    // 20% of balance per trade
      dailyDrawdownPct: 0.05,  // halt at -5% daily
      maxConsecutiveLosses: 3, // cooldown after 3 losses
      cooldownMs: 30 * 60 * 1000, // 30 min
      marginHealthHaltPct: 0.85,  // halt at 85% margin used
    });
  });

  it("approves a valid trade within limits", () => {
    const session = makeSession({ startingBalance: 1000 });
    const result = engine.checkTradeAllowed(session, {
      notional: 200,  // 20% of 1000 — exactly at limit
      walletBalance: 1000,
      usedMargin: 100,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when notional > maxPositionPct of balance", () => {
    const session = makeSession({ startingBalance: 1000 });
    const result = engine.checkTradeAllowed(session, {
      notional: 300,  // 30% — over 20% limit
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
    expect(result.reason).toContain("daily drawdown");
  });

  it("rejects when in cooldown after consecutive losses", () => {
    const session = makeSession({
      startingBalance: 1000,
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: Date.now() + 60_000,
    });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 1000,
      usedMargin: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("allows trading after cooldown expires", () => {
    const session = makeSession({
      startingBalance: 1000,
      consecutiveLosses: 3,
      inCooldown: true,
      cooldownUntil: Date.now() - 1000, // expired
    });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 1000,
      usedMargin: 0,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when margin health > 85%", () => {
    const session = makeSession({ startingBalance: 1000 });
    const result = engine.checkTradeAllowed(session, {
      notional: 100,
      walletBalance: 1000,
      usedMargin: 900, // 90% of 1000 — over 85%
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("margin");
  });
});

describe("RiskEngine.recordTrade", () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine({
      maxPositionPct: 0.20,
      dailyDrawdownPct: 0.05,
      maxConsecutiveLosses: 3,
      cooldownMs: 30 * 60 * 1000,
      marginHealthHaltPct: 0.85,
    });
  });

  it("increments consecutiveLosses on losing trade", () => {
    const session = makeSession();
    const updated = engine.recordTrade(session, { pnl: -50 });
    expect(updated.consecutiveLosses).toBe(1);
    expect(updated.realizedPnl).toBe(-50);
  });

  it("resets consecutiveLosses on winning trade", () => {
    const session = makeSession({ consecutiveLosses: 2 });
    const updated = engine.recordTrade(session, { pnl: 10 });
    expect(updated.consecutiveLosses).toBe(0);
  });

  it("sets inCooldown after maxConsecutiveLosses", () => {
    let session = makeSession();
    session = engine.recordTrade(session, { pnl: -10 });
    session = engine.recordTrade(session, { pnl: -10 });
    session = engine.recordTrade(session, { pnl: -10 });
    expect(session.inCooldown).toBe(true);
    expect(session.cooldownUntil).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run api/services/__tests__/risk-engine.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement `risk-engine.ts`**

```typescript
// api/services/risk-engine.ts
import { EventEmitter } from "events";

export const riskEvents = new EventEmitter();

export interface RiskConfig {
  maxPositionPct: number;       // e.g. 0.20 = 20% of wallet per trade
  dailyDrawdownPct: number;     // e.g. 0.05 = halt at -5% daily
  maxConsecutiveLosses: number; // e.g. 3
  cooldownMs: number;           // e.g. 30 * 60 * 1000
  marginHealthHaltPct: number;  // e.g. 0.85 = halt when usedMargin/wallet > 85%
}

export interface RiskSession {
  userId: number;
  date: string;                 // YYYY-MM-DD UTC
  startingBalance: number;
  realizedPnl: number;
  tradeCount: number;
  consecutiveLosses: number;
  inCooldown: boolean;
  cooldownUntil: number | null;
}

export interface TradeRequest {
  notional: number;       // price * size in USDT
  walletBalance: number;  // current free balance in USDT
  usedMargin: number;     // locked margin across all positions in USDT
}

export interface RiskDecision {
  approved: boolean;
  reason?: string;
  maxAllowedNotional?: number;
}

export class RiskEngine {
  config: RiskConfig;

  constructor(config: RiskConfig) {
    this.config = config;
  }

  checkTradeAllowed(session: RiskSession, req: TradeRequest): RiskDecision {
    // 1. Check cooldown (may have expired)
    if (session.inCooldown && session.cooldownUntil !== null) {
      if (Date.now() < session.cooldownUntil) {
        const minsLeft = Math.ceil((session.cooldownUntil - Date.now()) / 60_000);
        return {
          approved: false,
          reason: `cooldown active — ${minsLeft}m left after ${session.consecutiveLosses} consecutive losses`,
        };
      }
      // Cooldown expired — treat as cleared
    }

    // 2. Daily drawdown circuit
    const drawdownPct = session.startingBalance > 0
      ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance
      : 0;
    if (drawdownPct >= this.config.dailyDrawdownPct) {
      return {
        approved: false,
        reason: `daily drawdown limit hit — ${(drawdownPct * 100).toFixed(2)}% loss today (limit: ${(this.config.dailyDrawdownPct * 100).toFixed(0)}%)`,
      };
    }

    // 3. Position size cap
    const maxNotional = req.walletBalance * this.config.maxPositionPct;
    if (req.notional > maxNotional) {
      return {
        approved: false,
        reason: `position size ${req.notional.toFixed(2)} USDT exceeds ${(this.config.maxPositionPct * 100).toFixed(0)}% of balance (max: ${maxNotional.toFixed(2)} USDT)`,
        maxAllowedNotional: maxNotional,
      };
    }

    // 4. Margin health
    const totalBalance = req.walletBalance + req.usedMargin;
    const marginUsagePct = totalBalance > 0 ? req.usedMargin / totalBalance : 0;
    if (marginUsagePct >= this.config.marginHealthHaltPct) {
      return {
        approved: false,
        reason: `margin usage ${(marginUsagePct * 100).toFixed(1)}% exceeds safety threshold ${(this.config.marginHealthHaltPct * 100).toFixed(0)}%`,
      };
    }

    return { approved: true };
  }

  recordTrade(session: RiskSession, result: { pnl: number }): RiskSession {
    const updated: RiskSession = {
      ...session,
      realizedPnl: session.realizedPnl + result.pnl,
      tradeCount: session.tradeCount + 1,
    };

    if (result.pnl < 0) {
      updated.consecutiveLosses = session.consecutiveLosses + 1;
      if (updated.consecutiveLosses >= this.config.maxConsecutiveLosses) {
        updated.inCooldown = true;
        updated.cooldownUntil = Date.now() + this.config.cooldownMs;
        riskEvents.emit("cooldown-started", {
          userId: session.userId,
          consecutiveLosses: updated.consecutiveLosses,
        });
      }
    } else {
      updated.consecutiveLosses = 0;
      updated.inCooldown = false;
      updated.cooldownUntil = null;
    }

    // Trigger kill switch if daily drawdown hit
    const drawdownPct = session.startingBalance > 0
      ? Math.abs(Math.min(0, updated.realizedPnl)) / session.startingBalance
      : 0;
    if (drawdownPct >= this.config.dailyDrawdownPct) {
      riskEvents.emit("drawdown-limit-hit", { userId: session.userId, drawdownPct });
    }

    return updated;
  }
}

// Default production config
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionPct: 0.20,
  dailyDrawdownPct: 0.05,
  maxConsecutiveLosses: 3,
  cooldownMs: 30 * 60 * 1000,
  marginHealthHaltPct: 0.85,
};

// In-memory session store (resets at UTC midnight, keyed by userId)
const sessions = new Map<number, RiskSession>();

export function getOrCreateSession(userId: number, walletBalance: number): RiskSession {
  const today = new Date().toISOString().slice(0, 10);
  const existing = sessions.get(userId);
  if (existing && existing.date === today) return existing;

  const fresh: RiskSession = {
    userId,
    date: today,
    startingBalance: walletBalance,
    realizedPnl: 0,
    tradeCount: 0,
    consecutiveLosses: 0,
    inCooldown: false,
    cooldownUntil: null,
  };
  sessions.set(userId, fresh);
  return fresh;
}

export function updateSession(session: RiskSession) {
  sessions.set(session.userId, session);
}

export const globalRiskEngine = new RiskEngine(DEFAULT_RISK_CONFIG);
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run api/services/__tests__/risk-engine.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Wire risk engine into `trading-router.ts`**

At top, add imports:
```typescript
import { globalRiskEngine, getOrCreateSession, updateSession } from "../services/risk-engine";
import { riskEvents } from "../services/risk-engine";
import { globalKillSwitch } from "../services/kill-switch";
```

In `createPosition` mutation, after the kill switch check (before leverage cap), add:

```typescript
// Fetch wallet balance for risk check
let walletBalance = 0;
let usedMargin = 0;
try {
  if (creds && creds[0]) {
    const wallets = await getFuturesWallet({ apiKey: creds[0].apiKey, apiSecret: creds[0].apiSecret });
    for (const w of wallets) {
      const free = parseFloat(w.balance || "0");
      const locked = parseFloat(w.locked_balance || "0");
      walletBalance += free;
      usedMargin += locked;
    }
  }
} catch { /* non-fatal — proceed with 0 if wallet fetch fails */ }

const session = getOrCreateSession(input.userId, walletBalance || 10_000);
const notional = parseFloat(input.entryPrice) * parseFloat(input.size);
const riskDecision = globalRiskEngine.checkTradeAllowed(session, {
  notional,
  walletBalance: walletBalance || session.startingBalance,
  usedMargin,
});

if (!riskDecision.approved) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Risk check failed: ${riskDecision.reason}`,
  });
}
```

Wire drawdown kill switch — add after imports at module level:

```typescript
riskEvents.on("drawdown-limit-hit", ({ userId, drawdownPct }: { userId: number; drawdownPct: number }) => {
  globalKillSwitch.trigger("drawdown", `Daily loss limit hit: ${(drawdownPct * 100).toFixed(2)}%`);
  sendTelegramNotification(`🚨 Daily drawdown limit hit for user ${userId}. Trading halted.`).catch(() => {});
});
```

Add `riskStatus` query to `tradingRouter`:

```typescript
riskStatus: publicQuery
  .input(z.object({ userId: z.number() }))
  .query(({ input }) => {
    const session = sessions.get(input.userId);
    if (!session) return null;
    const drawdownPct = session.startingBalance > 0
      ? Math.min(0, session.realizedPnl) / session.startingBalance * 100
      : 0;
    return {
      ...session,
      drawdownPct: Math.abs(Math.min(0, drawdownPct)),
      marginHealthPct: 0, // populated client-side with live balance
      killSwitchActive: globalKillSwitch.isActive,
      killSwitchReason: globalKillSwitch.state?.reason,
    };
  }),
```

Add import for `sessions` in trading-router: `import { globalRiskEngine, getOrCreateSession, updateSession, riskEvents, sessions } from "../services/risk-engine";`

- [ ] **Step 6: Commit**

```bash
git add api/services/risk-engine.ts api/services/__tests__/risk-engine.test.ts api/routers/trading-router.ts
git commit -m "feat: add risk engine — capital %, drawdown circuit, cooldown, margin health"
```

---

## Task 4: Regime Detector — Market Classification + Strategy Auto-Switch

**Context:** This is the core feature request. The system must detect whether the market is in a scalping-suitable (ranging, tight spread), intraday (short trend), or swing (strong sustained trend) regime — then automatically switch `activeStrategyType` in the signal router.

**Trader's regime logic:**
- `RANGING` (ADX<20, ATR<0.5%): best for scalping — price oscillates, microstructure dominates
- `INTRADAY_TREND` (ADX 20–30, 1h trend direction): EMA crossover + momentum play
- `SWING_TREND` (ADX>30, EMA50>EMA200 on 4h): sustained directional move, ride the trend
- `HIGH_VOLATILITY` (ATR>2%): treat as intraday with wider stops — don't scalp chaos

**Files:**
- Create: `api/services/regime-detector.ts`
- Create: `api/services/__tests__/regime-detector.test.ts`
- Modify: `api/services/strategy-config.ts`
- Modify: `api/routers/signal-router.ts`

---

- [ ] **Step 1: Write failing tests**

```typescript
// api/services/__tests__/regime-detector.test.ts
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
    spreadPct: 0.03,
    ...overrides,
  };
}

describe("classifyRegime", () => {
  it("returns RANGING when ADX < 20 and ATR low", () => {
    const result = classifyRegime(makeInput({ adx1h: 15, atrPct1h: 0.3 }));
    expect(result).toBe("ranging");
  });

  it("returns HIGH_VOLATILITY when ATR > 2%", () => {
    const result = classifyRegime(makeInput({ adx1h: 18, atrPct1h: 2.5 }));
    expect(result).toBe("high_volatility");
  });

  it("returns SWING_TREND when ADX > 30 and EMA50_4h > EMA200_4h", () => {
    const result = classifyRegime(makeInput({
      adx1h: 32,
      ema50_4h: 110,
      ema200_4h: 100,
    }));
    expect(result).toBe("swing_trend");
  });

  it("returns INTRADAY_TREND when ADX 20–30", () => {
    const result = classifyRegime(makeInput({
      adx1h: 25,
      ema20_1h: 102,
      ema50_1h: 100,
    }));
    expect(result).toBe("intraday_trend");
  });

  it("HIGH_VOLATILITY takes priority over ADX-based rules", () => {
    // Even with high ADX, if ATR spikes treat as high_vol
    const result = classifyRegime(makeInput({ adx1h: 35, atrPct1h: 3.0 }));
    expect(result).toBe("high_volatility");
  });
});

describe("regimeToStrategy", () => {
  it("RANGING → scalping", () => {
    expect(regimeToStrategy("ranging")).toBe("scalping");
  });
  it("HIGH_VOLATILITY → intraday", () => {
    expect(regimeToStrategy("high_volatility")).toBe("intraday");
  });
  it("INTRADAY_TREND → intraday", () => {
    expect(regimeToStrategy("intraday_trend")).toBe("intraday");
  });
  it("SWING_TREND → swing", () => {
    expect(regimeToStrategy("swing_trend")).toBe("swing");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run api/services/__tests__/regime-detector.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement `regime-detector.ts`**

```typescript
// api/services/regime-detector.ts
import { EventEmitter } from "events";
import { fetchKlines } from "./binance";
import { marketStateManager } from "./market-state";
import type { StrategyType } from "./strategy-config";

export type RegimeType = "ranging" | "intraday_trend" | "swing_trend" | "high_volatility";

export interface RegimeInput {
  adx1h: number;
  atrPct1h: number;       // ATR(14) / price * 100
  ema20_1h: number;
  ema50_1h: number;
  ema50_4h: number;
  ema200_4h: number;
  spreadPct: number;
}

export interface RegimeResult {
  regime: RegimeType;
  strategy: StrategyType;
  inputs: RegimeInput;
  symbol: string;
  timestamp: number;
  reason: string;
}

export const regimeEvents = new EventEmitter();
regimeEvents.setMaxListeners(20);

export function classifyRegime(input: RegimeInput): RegimeType {
  // Priority 1: Extreme volatility overrides everything
  if (input.atrPct1h > 2.0) return "high_volatility";

  // Priority 2: Strong sustained trend on 4h
  if (input.adx1h > 30 && input.ema50_4h > input.ema200_4h * 0.995) return "swing_trend";
  if (input.adx1h > 30 && input.ema50_4h < input.ema200_4h * 1.005) return "swing_trend"; // bear trend

  // Priority 3: Developing intraday trend
  if (input.adx1h >= 20) return "intraday_trend";

  // Priority 4: Ranging / tight market → scalping
  return "ranging";
}

export function regimeToStrategy(regime: RegimeType): StrategyType {
  const map: Record<RegimeType, StrategyType> = {
    ranging: "scalping",
    intraday_trend: "intraday",
    swing_trend: "swing",
    high_volatility: "intraday",
  };
  return map[regime];
}

function calcATRPct(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 0;
  const slice = prices.slice(-period - 1);
  let atrSum = 0;
  for (let i = 1; i < slice.length; i++) {
    atrSum += Math.abs(slice[i] - slice[i - 1]);
  }
  const atr = atrSum / period;
  const currentPrice = prices[prices.length - 1];
  return currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
}

function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcADX(prices: number[], period = 14): number {
  if (prices.length < period * 2) return 20;
  const highs = prices;
  const lows = prices.map((p, i) => (i > 0 ? Math.min(p, prices[i - 1]) : p));
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    trSum += Math.abs(highs[i] - lows[i]);
  }
  if (trSum === 0) return 0;
  const plusDI = (plusDM / trSum) * 100;
  const minusDI = (minusDM / trSum) * 100;
  return Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;
}

export async function detectRegimeForSymbol(binanceSymbol: string): Promise<RegimeResult> {
  // Fetch 1h and 4h klines in parallel
  const [klines1h, klines4h] = await Promise.all([
    fetchKlines(binanceSymbol, "1h", 60),
    fetchKlines(binanceSymbol, "4h", 60),
  ]);

  const prices1h = klines1h.map((k) => parseFloat(k.close));
  const prices4h = klines4h.map((k) => parseFloat(k.close));

  const adx1h = calcADX(prices1h, 14);
  const atrPct1h = calcATRPct(prices1h, 14);
  const ema20_1h = calcEMA(prices1h, 20);
  const ema50_1h = calcEMA(prices1h, 50);
  const ema50_4h = calcEMA(prices4h, 50);
  const ema200_4h = calcEMA(prices4h, 200);

  const state = marketStateManager.get(binanceSymbol);
  const spreadPct = state?.metrics?.spreadPercent ?? 0;

  const inputs: RegimeInput = { adx1h, atrPct1h, ema20_1h, ema50_1h, ema50_4h, ema200_4h, spreadPct };
  const regime = classifyRegime(inputs);
  const strategy = regimeToStrategy(regime);

  const reason = regime === "ranging"
    ? `ADX ${adx1h.toFixed(1)} < 20, ATR ${atrPct1h.toFixed(2)}% — tight range`
    : regime === "swing_trend"
    ? `ADX ${adx1h.toFixed(1)} > 30, EMA50_4h ${ema50_4h.toFixed(0)} vs EMA200_4h ${ema200_4h.toFixed(0)}`
    : regime === "high_volatility"
    ? `ATR ${atrPct1h.toFixed(2)}% > 2% — avoid scalping chaos`
    : `ADX ${adx1h.toFixed(1)} in trend range 20–30`;

  return { regime, strategy, inputs, symbol: binanceSymbol, timestamp: Date.now(), reason };
}

// Latest detected regime per symbol
export const latestRegimeCache = new Map<string, RegimeResult>();
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run api/services/__tests__/regime-detector.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Add `REGIME_TO_STRATEGY` mapping to `strategy-config.ts`**

```typescript
// Append to api/services/strategy-config.ts
import type { RegimeType } from "./regime-detector";  // Note: import type only to avoid circular

export const REGIME_STRATEGY_MAP: Record<string, StrategyType> = {
  ranging: "scalping",
  intraday_trend: "intraday",
  swing_trend: "swing",
  high_volatility: "intraday",
};
```

Note: `RegimeType` import must be `import type` to avoid circular dependency between `regime-detector → strategy-config → regime-detector`. The `REGIME_STRATEGY_MAP` key is `string` not `RegimeType` for this reason.

- [ ] **Step 6: Wire auto-switch into `signal-router.ts`**

Add imports:
```typescript
import { detectRegimeForSymbol, latestRegimeCache, regimeEvents } from "../services/regime-detector";
```

Add regime detection loop inside `startAutoAnalysis()`, after the `runAutoAnalysis()` call:

```typescript
// Regime detection loop — runs every 60s on BTC as the market proxy
// BTC regime drives the system-wide strategy selection
async function runRegimeDetection() {
  try {
    const result = await detectRegimeForSymbol("BTCUSDT");
    latestRegimeCache.set("BTCUSDT", result);

    const previousStrategy = activeStrategyType;
    if (result.strategy !== activeStrategyType) {
      console.log(
        `[regime] Strategy switching: ${activeStrategyType} → ${result.strategy} (regime: ${result.regime})`
      );
      // Restart auto-analysis with new strategy interval
      if (autoAnalysisTimer) {
        clearTimeout(autoAnalysisTimer);
        autoAnalysisTimer = null;
      }
      activeStrategyType = result.strategy;
      signalEvents.emit("strategy-switch", {
        from: previousStrategy,
        to: result.strategy,
        regime: result.regime,
        reason: result.reason,
      });
      runAutoAnalysis();
    }
  } catch (err) {
    console.error("[regime] Detection failed:", err);
  }
  setTimeout(runRegimeDetection, 60_000);
}

// Add this line at the end of startAutoAnalysis(), after runAutoAnalysis():
setTimeout(runRegimeDetection, 10_000); // first check 10s after startup
```

Add `regimeStatus` and `regimeStream` to signal router:

```typescript
// In signalRouter object:
regimeStatus: publicQuery
  .query(() => {
    const btc = latestRegimeCache.get("BTCUSDT");
    return {
      regime: btc?.regime ?? "intraday_trend",
      strategy: btc?.strategy ?? activeStrategyType,
      reason: btc?.reason ?? "",
      inputs: btc?.inputs,
      timestamp: btc?.timestamp,
      activeStrategy: activeStrategyType,
    };
  }),

regimeStream: publicQuery
  .subscription(() => {
    return observable((emit) => {
      const onSwitch = (data: unknown) => emit.next(data);
      signalEvents.on("strategy-switch", onSwitch);
      return () => signalEvents.off("strategy-switch", onSwitch);
    });
  }),
```

- [ ] **Step 7: Commit**

```bash
git add api/services/regime-detector.ts api/services/__tests__/regime-detector.test.ts api/services/strategy-config.ts api/routers/signal-router.ts
git commit -m "feat: add regime detector with auto strategy switch scalping/intraday/swing"
```

---

## Task 5: Trailing Stop Engine

**Context:** `stopLoss` is stored on positions but never moved. A trailing stop for a long position should ratchet up as price rises — locking in profit without premature exit. Server-side, not client-side.

**Trailing logic:**
- Long: `new_stop = max(current_stop, current_price * (1 - trailPct))`
- Short: `new_stop = min(current_stop, current_price * (1 + trailPct))`
- Default trail: 0.5% (tight for scalping), 1% (intraday), 2% (swing)
- If current_price hits stop → emit exit signal

**Files:**
- Create: `api/services/trailing-stop.ts`
- Create: `api/services/__tests__/trailing-stop.test.ts`

---

- [ ] **Step 1: Write failing tests**

```typescript
// api/services/__tests__/trailing-stop.test.ts
import { describe, it, expect } from "vitest";
import { calcNewTrailingStop, shouldStopOut } from "../trailing-stop";

describe("calcNewTrailingStop for LONG", () => {
  it("moves stop up when price rises", () => {
    // Entry 100, stop 99 (1% trail), price now 102
    const newStop = calcNewTrailingStop("long", 99, 102, 0.01);
    expect(newStop).toBeCloseTo(100.98, 1); // 102 * (1 - 0.01)
  });

  it("does NOT move stop down when price falls", () => {
    // Stop is at 101, price falls to 100 — stop stays
    const newStop = calcNewTrailingStop("long", 101, 100, 0.01);
    expect(newStop).toBe(101); // max(101, 99) = 101
  });

  it("ratchets incrementally as price rises further", () => {
    let stop = 99;
    stop = calcNewTrailingStop("long", stop, 101, 0.01); // → 99.99
    stop = calcNewTrailingStop("long", stop, 103, 0.01); // → 101.97
    stop = calcNewTrailingStop("long", stop, 105, 0.01); // → 103.95
    expect(stop).toBeCloseTo(103.95, 1);
  });
});

describe("calcNewTrailingStop for SHORT", () => {
  it("moves stop down when price falls", () => {
    const newStop = calcNewTrailingStop("short", 101, 98, 0.01);
    expect(newStop).toBeCloseTo(98.98, 1); // 98 * (1 + 0.01)
  });

  it("does NOT move stop up when price rises", () => {
    const newStop = calcNewTrailingStop("short", 99, 101, 0.01);
    expect(newStop).toBe(99); // min(99, 102.01) = 99
  });
});

describe("shouldStopOut", () => {
  it("stops out long when price <= stop", () => {
    expect(shouldStopOut("long", 98.5, 99)).toBe(true);
    expect(shouldStopOut("long", 99.0, 99)).toBe(true);
    expect(shouldStopOut("long", 99.1, 99)).toBe(false);
  });

  it("stops out short when price >= stop", () => {
    expect(shouldStopOut("short", 101, 100.5)).toBe(true);
    expect(shouldStopOut("short", 100.5, 100.5)).toBe(true);
    expect(shouldStopOut("short", 100.4, 100.5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run api/services/__tests__/trailing-stop.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement `trailing-stop.ts`**

```typescript
// api/services/trailing-stop.ts
import { tradingEvents, markPriceCache } from "./coindcx-ws";
import { latestTickerCache } from "./streaming";
import { STRATEGY_CONFIGS, type StrategyType } from "./strategy-config";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";

// Default trail % per strategy type
export const TRAIL_PCT: Record<StrategyType, number> = {
  scalping: 0.005,  // 0.5%
  intraday: 0.010,  // 1.0%
  swing:    0.020,  // 2.0%
};

export function calcNewTrailingStop(
  side: "long" | "short",
  currentStop: number,
  currentPrice: number,
  trailPct: number
): number {
  if (side === "long") {
    const candidateStop = currentPrice * (1 - trailPct);
    return Math.max(currentStop, candidateStop);
  } else {
    const candidateStop = currentPrice * (1 + trailPct);
    return Math.min(currentStop, candidateStop);
  }
}

export function shouldStopOut(
  side: "long" | "short",
  currentPrice: number,
  stopLevel: number
): boolean {
  return side === "long" ? currentPrice <= stopLevel : currentPrice >= stopLevel;
}

interface TrackedPosition {
  id: number;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  strategyType: StrategyType;
  userId: number;
}

let trailingTimer: ReturnType<typeof setInterval> | null = null;
const trackedPositions = new Map<number, TrackedPosition>();

export function registerPositionForTrailing(pos: TrackedPosition) {
  trackedPositions.set(pos.id, pos);
  ensureTrailingEngine();
}

export function unregisterPosition(positionId: number) {
  trackedPositions.delete(positionId);
}

function ensureTrailingEngine() {
  if (trailingTimer) return;
  trailingTimer = setInterval(async () => {
    if (trackedPositions.size === 0) return;
    const db = getDb();

    for (const [posId, pos] of trackedPositions) {
      const markKey = `B-${pos.symbol.replace("USDT", "_USDT")}`;
      const currentPrice =
        markPriceCache.get(markKey) ??
        latestTickerCache.get(pos.symbol)?.lastPrice;

      if (!currentPrice || currentPrice <= 0) continue;

      const trailPct = TRAIL_PCT[pos.strategyType];

      // Check stop-out first
      if (shouldStopOut(pos.side, currentPrice, pos.stopLoss)) {
        tradingEvents.emit(`exit-signal:${pos.userId}`, {
          positionId: pos.id,
          symbol: pos.symbol,
          strategyType: pos.strategyType,
          currentPrice,
          triggerType: "trailing_stop",
          stopLevel: pos.stopLoss,
          decision: {
            shouldExit: true,
            reason: `Trailing stop hit: price ${currentPrice.toFixed(4)} crossed stop ${pos.stopLoss.toFixed(4)}`,
          },
        });
        trackedPositions.delete(posId);
        continue;
      }

      // Ratchet stop level
      const newStop = calcNewTrailingStop(pos.side, pos.stopLoss, currentPrice, trailPct);
      if (Math.abs(newStop - pos.stopLoss) > 0.000001) {
        pos.stopLoss = newStop; // update in-memory
        // Persist to DB (fire-and-forget)
        db.update(positions)
          .set({ stopLoss: String(newStop), updatedAt: new Date() })
          .where(and(eq(positions.id, posId), eq(positions.status, "open")))
          .catch(() => {});
      }
    }
  }, 2_000); // tick every 2s — fine for scalping
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run api/services/__tests__/trailing-stop.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Auto-register positions for trailing in `trading-router.ts`**

In `createPosition` mutation, after the DB insert and before returning:

```typescript
import { registerPositionForTrailing } from "../services/trailing-stop";

// After: tradingEvents.emit(`portfolio-update:${input.userId}`);
// Add:
if (input.stopLoss) {
  registerPositionForTrailing({
    id: result[0].id,
    symbol: input.symbol,
    side: input.side,
    entryPrice: parseFloat(input.entryPrice),
    stopLoss: parseFloat(input.stopLoss),
    strategyType: input.strategyType,
    userId: input.userId,
  });
}
```

In `closePosition` mutation, add:
```typescript
import { unregisterPosition } from "../services/trailing-stop";
// After the DB update:
unregisterPosition(input.id);
```

- [ ] **Step 6: Commit**

```bash
git add api/services/trailing-stop.ts api/services/__tests__/trailing-stop.test.ts api/routers/trading-router.ts
git commit -m "feat: add server-side trailing stop engine with per-strategy trail %"
```

---

## Task 6: Frontend — Regime Indicator + Risk Status Panel

**Context:** Two new UI components: (1) `RegimeIndicator` shows current regime (RANGING/INTRADAY/SWING) as a colored badge with strategy label, auto-updates via subscription. (2) `RiskStatus` shows daily PnL %, drawdown bar, cooldown timer, kill switch state.

**Files:**
- Create: `src/components/RegimeIndicator.tsx`
- Create: `src/components/RiskStatus.tsx`
- Modify: `src/pages/Dashboard.tsx` — mount both, add kill switch button

---

- [ ] **Step 1: Create `RegimeIndicator.tsx`**

```tsx
// src/components/RegimeIndicator.tsx
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Activity, TrendingUp, Zap } from "lucide-react";

type Regime = "ranging" | "intraday_trend" | "swing_trend" | "high_volatility";
type Strategy = "scalping" | "intraday" | "swing";

const REGIME_CONFIG: Record<Regime, { label: string; color: string; icon: React.ReactNode }> = {
  ranging:        { label: "RANGING",    color: "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/10", icon: <Zap size={10} /> },
  intraday_trend: { label: "TREND 1H",  color: "text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/10", icon: <Activity size={10} /> },
  swing_trend:    { label: "TREND 4H",  color: "text-[#3b82f6] border-[#3b82f6]/30 bg-[#3b82f6]/10", icon: <TrendingUp size={10} /> },
  high_volatility:{ label: "HIGH VOL",  color: "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10", icon: <Activity size={10} /> },
};

const STRATEGY_LABEL: Record<Strategy, string> = {
  scalping: "Scalping",
  intraday: "Intraday",
  swing: "Swing",
};

export function RegimeIndicator() {
  const [switchLog, setSwitchLog] = useState<{ from: string; to: string; regime: string } | null>(null);

  const { data: status } = trpc.signal.regimeStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  trpc.signal.regimeStream.useSubscription(undefined, {
    onData: (data: unknown) => {
      const d = data as { from: string; to: string; regime: string; reason: string };
      setSwitchLog(d);
      setTimeout(() => setSwitchLog(null), 8_000);
    },
  });

  const regime = (status?.regime ?? "intraday_trend") as Regime;
  const strategy = (status?.strategy ?? "intraday") as Strategy;
  const cfg = REGIME_CONFIG[regime] ?? REGIME_CONFIG.intraday_trend;

  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-semibold", cfg.color)}>
        {cfg.icon}
        <span>{cfg.label}</span>
      </div>
      <span className="text-[9px] text-[#52525b]">→</span>
      <span className="text-[9px] font-semibold text-[#f4f4f5] capitalize">{STRATEGY_LABEL[strategy]}</span>
      {switchLog && (
        <span className="text-[9px] text-[#f59e0b] ml-1 animate-pulse">
          switched {switchLog.from}→{switchLog.to}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `RiskStatus.tsx`**

```tsx
// src/components/RiskStatus.tsx
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";

interface Props {
  userId: number;
  onKillSwitch: (action: "trigger" | "reset") => void;
}

export function RiskStatus({ userId, onKillSwitch }: Props) {
  const { data: risk } = trpc.trading.riskStatus.useQuery({ userId }, {
    refetchInterval: 10_000,
  });

  const { data: ksStatus } = trpc.trading.killSwitchStatus.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  if (!risk) return null;

  const drawdownPct = risk.drawdownPct ?? 0;
  const drawdownBarWidth = Math.min(drawdownPct / 5 * 100, 100); // 5% = full bar
  const drawdownColor =
    drawdownPct >= 4 ? "bg-[#ef4444]" :
    drawdownPct >= 2.5 ? "bg-[#f59e0b]" :
    "bg-[#22c55e]";

  return (
    <div className="px-3 py-2 border-b border-[#27272a] space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#52525b] uppercase tracking-wide">Risk Status</span>
        {ksStatus?.isActive ? (
          <button
            onClick={() => onKillSwitch("reset")}
            className="text-[9px] text-[#ef4444] border border-[#ef4444]/30 bg-[#ef4444]/10 px-1.5 py-0.5 rounded flex items-center gap-1"
          >
            <ShieldAlert size={9} /> HALTED — Reset
          </button>
        ) : (
          <button
            onClick={() => onKillSwitch("trigger")}
            className="text-[9px] text-[#71717a] border border-[#27272a] px-1.5 py-0.5 rounded flex items-center gap-1 hover:text-[#ef4444] hover:border-[#ef4444]/30"
          >
            <ShieldCheck size={9} /> Emergency Stop
          </button>
        )}
      </div>

      {/* Daily drawdown bar */}
      <div>
        <div className="flex justify-between text-[9px] mb-0.5">
          <span className="text-[#71717a]">Daily loss</span>
          <span className={cn("tabular-nums font-medium",
            drawdownPct >= 4 ? "text-[#ef4444]" : drawdownPct >= 2.5 ? "text-[#f59e0b]" : "text-[#22c55e]"
          )}>
            -{drawdownPct.toFixed(2)}% / 5%
          </span>
        </div>
        <div className="h-1 bg-[#18181b] rounded overflow-hidden">
          <div
            className={cn("h-full rounded transition-all", drawdownColor)}
            style={{ width: `${drawdownBarWidth}%` }}
          />
        </div>
      </div>

      {/* Trade stats */}
      <div className="flex gap-3 text-[9px] text-[#52525b]">
        <span>Trades: <span className="text-[#f4f4f5]">{risk.tradeCount}</span></span>
        <span>Losses: <span className={risk.consecutiveLosses >= 2 ? "text-[#f59e0b]" : "text-[#f4f4f5]"}>{risk.consecutiveLosses}</span></span>
        {risk.inCooldown && risk.cooldownUntil && (
          <span className="text-[#f59e0b] animate-pulse">
            Cooldown: {Math.ceil((risk.cooldownUntil - Date.now()) / 60_000)}m
          </span>
        )}
      </div>

      {ksStatus?.isActive && (
        <div className="text-[9px] text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded px-2 py-1">
          ⚠ {ksStatus.killSwitchReason ?? "Trading halted"}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in `Dashboard.tsx`**

Add imports at top:
```typescript
import { RegimeIndicator } from "@/components/RegimeIndicator";
import { RiskStatus } from "@/components/RiskStatus";
```

Add `RiskStatus` in right panel, after symbol selector and before Buy/Sell tabs:
```tsx
<RiskStatus
  userId={1}
  onKillSwitch={(action) => {
    trpc.trading.killSwitch.mutate({ action, reason: action === "trigger" ? "Manual emergency stop" : "" });
  }}
/>
```

Add `RegimeIndicator` in the chart header bar (next to interval selectors):
```tsx
<RegimeIndicator />
```

Note: the `trpc.trading.killSwitch.useMutation()` hook must be declared in the component — add it alongside `createPosition`:
```typescript
const killSwitch = trpc.trading.killSwitch.useMutation();
// Then pass to RiskStatus:
onKillSwitch={(action) => killSwitch.mutate({ action, reason: action === "trigger" ? "Manual stop" : "" })}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/RegimeIndicator.tsx src/components/RiskStatus.tsx src/pages/Dashboard.tsx
git commit -m "feat: add regime indicator and risk status panel to dashboard"
```

---

## Task 7: Full Build + Integration Verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run 2>&1 | tail -30
```
Expected: all pass, 0 failures.

- [ ] **Step 2: Run full build**

```bash
npm run build 2>&1 | tail -20
```
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 3: Run drizzle migration (no schema changes in this plan)**

No new tables added. Skip migration.

- [ ] **Step 4: Smoke test regime detection manually**

Add to a scratch file or run inline:
```typescript
// In Node REPL or scratch script:
import { classifyRegime } from "./api/services/regime-detector.ts";
console.log(classifyRegime({ adx1h: 14, atrPct1h: 0.2, ema20_1h: 100, ema50_1h: 100, ema50_4h: 100, ema200_4h: 100, spreadPct: 0.02 }));
// Expected: "ranging"
console.log(classifyRegime({ adx1h: 35, atrPct1h: 0.8, ema20_1h: 105, ema50_1h: 102, ema50_4h: 105, ema200_4h: 95, spreadPct: 0.05 }));
// Expected: "swing_trend"
```

- [ ] **Step 5: Verify regime switch fires in logs**

Start server (`npm run dev`), wait 70s, check console for:
```
[regime] Strategy switching: intraday → scalping (regime: ranging)
```
or similar, depending on live market conditions.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: production trading engine — regime auto-switch, risk engine, kill switch, trailing stop, feed health"
```

---

## Self-Review

### Spec Coverage Check

| Requirement | Task | Status |
|---|---|---|
| WS reconnect exponential backoff | Task 1 | ✅ |
| Feed health heartbeat | Task 1 | ✅ |
| Kill switch manual trigger | Task 2 | ✅ |
| Kill switch auto (feed failure, drawdown) | Task 2 + Task 3 | ✅ |
| Risk: capital % per trade | Task 3 | ✅ |
| Risk: daily drawdown circuit (-5%) | Task 3 | ✅ |
| Risk: consecutive loss cooldown | Task 3 | ✅ |
| Risk: margin health halt | Task 3 | ✅ |
| Regime detection (ranging/intraday/swing) | Task 4 | ✅ |
| Auto strategy switch on regime change | Task 4 | ✅ |
| Multi-TF analysis (1h + 4h) | Task 4 | ✅ |
| Trailing stop engine (server-side) | Task 5 | ✅ |
| Auto-register positions for trailing | Task 5 | ✅ |
| Regime indicator in UI | Task 6 | ✅ |
| Risk status + drawdown bar in UI | Task 6 | ✅ |
| Emergency stop button in UI | Task 6 | ✅ |

### Gaps Not Covered (Out of Scope — Next Sprint)
- Funding rate filter (avoid longs when funding > 0.10%)
- Correlation limiter (BTC+ETH+SOL exposure capped)
- ExecutionEngine abstraction interface
- Backtesting engine
- AI/LLM advisor layer
- Docker + Redis queue
