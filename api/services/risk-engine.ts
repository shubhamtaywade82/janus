import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { riskSessions, tradingAccounts } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const riskEvents = new EventEmitter();
riskEvents.setMaxListeners(20);

export interface RiskConfig {
  maxPositionPct: number;       // e.g. 0.20 = 20% of wallet per trade
  dailyDrawdownPct: number;     // e.g. 0.05 = halt at -5% daily loss
  maxDrawdownFromPeakPct: number; // e.g. 0.25 = halt at -25% from all-time peak
  maxConsecutiveLosses: number; // e.g. 3 → cooldown
  cooldownMs: number;           // e.g. 30 * 60 * 1000
  marginHealthHaltPct: number;  // e.g. 0.85 = halt when usedMargin/totalBalance > 85%
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
  peakEquity: number;           // All-time peak equity for max-drawdown-from-peak check
}

export interface TradeRequest {
  notional: number;       // price * size in USDT
  walletBalance: number;  // current free balance in USDT
  usedMargin: number;     // locked margin across all positions in USDT
  isManualOverride?: boolean;
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
    if (req.isManualOverride) {
      return { approved: true };
    }

    // 1. Check cooldown
    if (session.inCooldown && session.cooldownUntil !== null) {
      if (Date.now() < session.cooldownUntil) {
        const minsLeft = Math.ceil((session.cooldownUntil - Date.now()) / 60_000);
        return {
          approved: false,
          reason: `cooldown active — ${minsLeft}m left after ${session.consecutiveLosses} consecutive losses`,
        };
      }
      // Expired — falls through as approved (cooldown cleared)
    }

    // 2. Daily drawdown circuit breaker
    const drawdownPct =
      session.startingBalance > 0
        ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance
        : 0;
    if (drawdownPct >= this.config.dailyDrawdownPct) {
      return {
        approved: false,
        reason: `daily drawdown limit hit — ${(drawdownPct * 100).toFixed(2)}% loss today (limit: ${(this.config.dailyDrawdownPct * 100).toFixed(0)}%)`,
      };
    }

    // 3. Max drawdown from peak circuit breaker (25% default)
    const currentEquity = session.startingBalance + session.realizedPnl;
    if (session.peakEquity > 0 && currentEquity > 0) {
      const drawdownFromPeak = (session.peakEquity - currentEquity) / session.peakEquity;
      if (drawdownFromPeak >= this.config.maxDrawdownFromPeakPct) {
        return {
          approved: false,
          reason: `max drawdown from peak hit — ${(drawdownFromPeak * 100).toFixed(2)}% from peak (limit: ${(this.config.maxDrawdownFromPeakPct * 100).toFixed(0)}%)`,
        };
      }
    }

    // 4. Position size cap (% of free wallet)
    const maxNotional = req.walletBalance * this.config.maxPositionPct;
    if (req.notional > maxNotional) {
      return {
        approved: false,
        reason: `position size ${req.notional.toFixed(2)} USDT exceeds ${(this.config.maxPositionPct * 100).toFixed(0)}% of balance — max ${maxNotional.toFixed(2)} USDT`,
        maxAllowedNotional: maxNotional,
      };
    }

    // 5. Margin health — prevent over-leveraging total account
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

    // Update peak equity if current equity exceeds previous peak
    const currentEquity = updated.startingBalance + updated.realizedPnl;
    if (currentEquity > updated.peakEquity) {
      updated.peakEquity = currentEquity;
    }

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

    // Emit drawdown alert if limit reached
    const drawdownPct =
      session.startingBalance > 0
        ? Math.abs(Math.min(0, updated.realizedPnl)) / session.startingBalance
        : 0;
    if (drawdownPct >= this.config.dailyDrawdownPct) {
      riskEvents.emit("drawdown-limit-hit", { userId: session.userId, drawdownPct });
    }

    return updated;
  }
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionPct: 0.80,
  dailyDrawdownPct: 0.10,
  maxDrawdownFromPeakPct: 0.25,
  maxConsecutiveLosses: 3,
  cooldownMs: 30 * 60 * 1000,
  marginHealthHaltPct: 0.95,
};

// ─── PostgreSQL-backed Risk Session Store ───
// Replaces the in-memory Map so restarts don't wipe state.

export const riskSessionStore = {
  async getOrCreate(userId: number, walletBalance: number): Promise<RiskSession> {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(riskSessions)
      .where(and(eq(riskSessions.userId, userId), eq(riskSessions.tradingDay, today)))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0];
      // Load all-time peak equity from tradingAccounts if available
      let peakEquity = parseFloat(row.startingEquity);
      try {
        const accRows = await db
          .select({ peakEquity: tradingAccounts.peakEquity })
          .from(tradingAccounts)
          .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.mode, "live")))
          .limit(1);
        if (accRows.length > 0 && accRows[0].peakEquity) {
          peakEquity = parseFloat(accRows[0].peakEquity);
        }
      } catch {
        // tradingAccounts may not have a row; fall back to starting equity
      }
      return {
        userId: row.userId,
        date: row.tradingDay,
        startingBalance: parseFloat(row.startingEquity),
        realizedPnl: parseFloat(row.realizedPnl),
        tradeCount: row.tradeCount,
        consecutiveLosses: row.consecutiveLosses,
        inCooldown: row.cooldownUntil ? Date.now() < new Date(row.cooldownUntil).getTime() : false,
        cooldownUntil: row.cooldownUntil ? new Date(row.cooldownUntil).getTime() : null,
        peakEquity,
      };
    }

    // Create fresh session
    let peakEquity = walletBalance;
    try {
      const accRows = await db
        .select({ peakEquity: tradingAccounts.peakEquity })
        .from(tradingAccounts)
        .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.mode, "live")))
        .limit(1);
      if (accRows.length > 0 && accRows[0].peakEquity) {
        peakEquity = parseFloat(accRows[0].peakEquity);
      }
    } catch {
      // tradingAccounts may not have a row; fall back to starting equity
    }

    const fresh: RiskSession = {
      userId,
      date: today,
      startingBalance: walletBalance,
      realizedPnl: 0,
      tradeCount: 0,
      consecutiveLosses: 0,
      inCooldown: false,
      cooldownUntil: null,
      peakEquity,
    };

    await db.insert(riskSessions).values({
      userId,
      tradingDay: today,
      startingEquity: walletBalance.toFixed(4),
      currentEquity: walletBalance.toFixed(4),
      realizedPnl: "0",
      unrealizedPnl: "0",
      tradeCount: 0,
      consecutiveLosses: 0,
      cooldownUntil: null,
      maxDrawdownHit: false,
    });

    return fresh;
  },

  async save(session: RiskSession): Promise<void> {
    const db = getDb();
    await db
      .update(riskSessions)
      .set({
        currentEquity: session.startingBalance.toFixed(4),
        realizedPnl: session.realizedPnl.toFixed(8),
        tradeCount: session.tradeCount,
        consecutiveLosses: session.consecutiveLosses,
        cooldownUntil: session.cooldownUntil ? new Date(session.cooldownUntil) : null,
        maxDrawdownHit:
          session.startingBalance > 0 &&
          Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance >= DEFAULT_RISK_CONFIG.dailyDrawdownPct,
        updatedAt: new Date(),
      })
      .where(and(eq(riskSessions.userId, session.userId), eq(riskSessions.tradingDay, session.date)));

    // Persist peak equity to tradingAccounts if it has increased
    try {
      const currentEquity = session.startingBalance + session.realizedPnl;
      if (currentEquity > session.peakEquity) {
        await db
          .update(tradingAccounts)
          .set({
            peakEquity: currentEquity.toFixed(8),
            drawdown: "0",
            updatedAt: new Date(),
          })
          .where(and(eq(tradingAccounts.userId, session.userId), eq(tradingAccounts.mode, "live")));
      }
    } catch {
      // tradingAccounts row may not exist; ignore
    }
  },
};

// ─── Compatibility wrappers (keeps existing call sites working) ───

export async function getOrCreateSession(userId: number, walletBalance: number): Promise<RiskSession> {
  return riskSessionStore.getOrCreate(userId, walletBalance);
}

export async function updateSession(session: RiskSession): Promise<void> {
  return riskSessionStore.save(session);
}

export const globalRiskEngine = new RiskEngine(DEFAULT_RISK_CONFIG);
