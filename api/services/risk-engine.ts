import { EventEmitter } from "events";

export const riskEvents = new EventEmitter();
riskEvents.setMaxListeners(20);

export interface RiskConfig {
  maxPositionPct: number;       // e.g. 0.20 = 20% of wallet per trade
  dailyDrawdownPct: number;     // e.g. 0.05 = halt at -5% daily loss
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

    // 3. Position size cap (% of free wallet)
    const maxNotional = req.walletBalance * this.config.maxPositionPct;
    if (req.notional > maxNotional) {
      return {
        approved: false,
        reason: `position size ${req.notional.toFixed(2)} USDT exceeds ${(this.config.maxPositionPct * 100).toFixed(0)}% of balance — max ${maxNotional.toFixed(2)} USDT`,
        maxAllowedNotional: maxNotional,
      };
    }

    // 4. Margin health — prevent over-leveraging total account
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
  maxPositionPct: 0.20,
  dailyDrawdownPct: 0.05,
  maxConsecutiveLosses: 3,
  cooldownMs: 30 * 60 * 1000,
  marginHealthHaltPct: 0.85,
};

// In-memory session store — keyed by userId, resets daily at UTC midnight
export const sessions = new Map<number, RiskSession>();

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
