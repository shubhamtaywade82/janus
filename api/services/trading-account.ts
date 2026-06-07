/**
 * TradingAccountService — unified account model for live, paper, and backtest modes.
 *
 * The only difference between modes is the execution provider; all wallet
 * state, ledger entries, and snapshots share the same tables and logic.
 *
 * Equity formula:
 *   equity            = walletBalance + unrealizedPnl
 *   availableBalance  = equity - lockedMargin
 *   usedMargin        = lockedMargin
 *   freeMargin        = availableBalance
 *   marginUtilization = usedMargin / equity
 *   drawdown          = peakEquity - equity
 *   buyingPower       = freeMargin * maxLeverage (caller-supplied)
 */

import { getDb } from "../queries/connection";
import {
  tradingAccounts,
  accountLedger,
  accountSnapshots,
  positions,
} from "@db/schema";
import { and, eq, desc } from "drizzle-orm";
import type { TradingAccount } from "@db/schema";

export type AccountMode = "live" | "paper" | "backtest";

export interface DerivedAccountMetrics {
  equity: number;
  availableBalance: number;
  usedMargin: number;
  freeMargin: number;
  marginUtilization: number;
  drawdown: number;
  drawdownPct: number;
  winRate: number;
  openExposure: number;
  longExposure: number;
  shortExposure: number;
  buyingPower: number; // freeMargin * 10 (10x cap from risk safeguards)
  healthScore: number; // 0-100, 100 = fully healthy
  marginBuffer: number;
  marginBufferPct: number;
}

// ─── Get or create account ───
export async function getOrCreateAccount(
  userId: number,
  mode: AccountMode,
  initialBalance = 10_000,
  currency: "USDT" | "INR" = "USDT"
): Promise<TradingAccount> {
  const db = getDb();
  const existing = await db
    .select()
    .from(tradingAccounts)
    .where(and(
      eq(tradingAccounts.userId, userId),
      eq(tradingAccounts.mode, mode),
      eq(tradingAccounts.currency, currency)
    ))
    .limit(1);

  if (existing[0]) return existing[0];

  const bal = String(initialBalance);
  const inserted = await db
    .insert(tradingAccounts)
    .values({
      userId,
      mode,
      currency,
      initialBalance: bal,
      walletBalance: bal,
      availableBalance: bal,
      equity: bal,
      peakEquity: bal,
    })
    .returning();

  // Seed with a deposit ledger entry
  await writeLedgerEntry(inserted[0].id, {
    eventType: "deposit",
    credit: initialBalance,
    debit: 0,
    balanceBefore: 0,
    balanceAfter: initialBalance,
    referenceType: "manual",
    metadata: { note: "initial_capital", currency },
  });

  return inserted[0];
}

// ─── Sync live account from CoinDCX wallet data ───
export async function syncLiveAccountFromCoinDCX(
  userId: number,
  data: {
    walletBalance: number;
    availableBalance: number;
    lockedMargin: number;
    unrealizedPnl: number;
    realizedPnl?: number;
  }
): Promise<void> {
  const account = await getOrCreateAccount(userId, "live", data.walletBalance);
  const equity = data.walletBalance + data.unrealizedPnl;
  const peakEquity = Math.max(equity, parseFloat(account.peakEquity));
  const drawdown = Math.max(0, peakEquity - equity);

  await getDb()
    .update(tradingAccounts)
    .set({
      walletBalance: String(data.walletBalance),
      availableBalance: String(data.availableBalance),
      lockedMargin: String(data.lockedMargin),
      unrealizedPnl: String(data.unrealizedPnl),
      realizedPnl: String(data.realizedPnl ?? account.realizedPnl),
      equity: String(equity),
      usedMargin: String(data.lockedMargin),
      freeMargin: String(data.availableBalance),
      peakEquity: String(peakEquity),
      drawdown: String(drawdown),
      updatedAt: new Date(),
    })
    .where(eq(tradingAccounts.id, account.id));
}

// ─── Reserve margin when opening a position ───
export async function reserveMargin(
  accountId: number,
  margin: number,
  positionId: number
): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account) return;

  const balBefore = parseFloat(account.walletBalance);
  const newLocked = parseFloat(account.lockedMargin) + margin;
  const newAvailable = parseFloat(account.availableBalance) - margin;
  const equity = parseFloat(account.equity);
  const freeMargin = Math.max(0, newAvailable);

  await db.update(tradingAccounts).set({
    lockedMargin: String(newLocked),
    availableBalance: String(newAvailable),
    usedMargin: String(newLocked),
    freeMargin: String(freeMargin),
    updatedAt: new Date(),
  }).where(eq(tradingAccounts.id, accountId));

  await writeLedgerEntry(accountId, {
    eventType: "reserve_margin",
    debit: margin,
    credit: 0,
    balanceBefore: balBefore,
    balanceAfter: balBefore - margin,
    referenceType: "position",
    referenceId: positionId,
    metadata: { margin, equity },
  });
}

// ─── Release margin when closing a position ───
export async function releaseMargin(
  accountId: number,
  margin: number,
  realizedPnl: number,
  positionId: number,
  isWin: boolean
): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account) return;

  const balBefore = parseFloat(account.walletBalance);
  const newWalletBalance = balBefore + realizedPnl;
  const newRealized = parseFloat(account.realizedPnl) + realizedPnl;
  const newLocked = Math.max(0, parseFloat(account.lockedMargin) - margin);
  const newEquity = newWalletBalance + parseFloat(account.unrealizedPnl);
  const peakEquity = Math.max(newEquity, parseFloat(account.peakEquity));
  const drawdown = Math.max(0, peakEquity - newEquity);
  const newAvailable = newEquity - newLocked;
  const newTradeCount = account.tradeCount + 1;
  const newWinCount = account.winCount + (isWin ? 1 : 0);

  await db.update(tradingAccounts).set({
    walletBalance: String(newWalletBalance),
    availableBalance: String(newAvailable),
    lockedMargin: String(newLocked),
    realizedPnl: String(newRealized),
    equity: String(newEquity),
    usedMargin: String(newLocked),
    freeMargin: String(newAvailable),
    peakEquity: String(peakEquity),
    drawdown: String(drawdown),
    tradeCount: newTradeCount,
    winCount: newWinCount,
    updatedAt: new Date(),
  }).where(eq(tradingAccounts.id, accountId));

  await writeLedgerEntry(accountId, {
    eventType: "pnl_realization",
    debit: realizedPnl < 0 ? Math.abs(realizedPnl) : 0,
    credit: realizedPnl >= 0 ? realizedPnl : 0,
    balanceBefore: balBefore,
    balanceAfter: newWalletBalance,
    referenceType: "position",
    referenceId: positionId,
    metadata: { margin, realizedPnl, isWin },
  });

  await writeLedgerEntry(accountId, {
    eventType: "release_margin",
    credit: margin,
    debit: 0,
    balanceBefore: newWalletBalance - margin,
    balanceAfter: newWalletBalance,
    referenceType: "position",
    referenceId: positionId,
    metadata: { margin },
  });
}

// ─── Update unrealized PnL from mark prices ───
export async function updateUnrealizedPnl(
  accountId: number,
  unrealizedPnl: number
): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account) return;

  const equity = parseFloat(account.walletBalance) + unrealizedPnl;
  const peakEquity = Math.max(equity, parseFloat(account.peakEquity));
  const drawdown = Math.max(0, peakEquity - equity);
  const freeMargin = equity - parseFloat(account.lockedMargin);

  await db.update(tradingAccounts).set({
    unrealizedPnl: String(unrealizedPnl),
    equity: String(equity),
    availableBalance: String(freeMargin),
    freeMargin: String(freeMargin),
    peakEquity: String(peakEquity),
    drawdown: String(drawdown),
    updatedAt: new Date(),
  }).where(eq(tradingAccounts.id, accountId));
}

// ─── Compute derived metrics (pure, no DB writes) ───
export function computeDerivedMetrics(account: TradingAccount): DerivedAccountMetrics {
  const equity = parseFloat(account.equity);
  const usedMargin = parseFloat(account.usedMargin);
  const lockedMargin = parseFloat(account.lockedMargin);
  const availableBalance = parseFloat(account.availableBalance);
  const freeMargin = equity - usedMargin;
  const peakEquity = parseFloat(account.peakEquity);
  const drawdown = parseFloat(account.drawdown);

  const marginUtilization = equity > 0 ? usedMargin / equity : 0;
  const drawdownPct = peakEquity > 0 ? drawdown / peakEquity : 0;
  const winRate = account.tradeCount > 0 ? account.winCount / account.tradeCount : 0;
  const buyingPower = freeMargin * 10; // capped at 10x (system leverage cap)
  const marginBuffer = Math.max(0, equity - usedMargin * 1.5); // 1.5x maintenance threshold
  const marginBufferPct = equity > 0 ? marginBuffer / equity : 1;

  // Health score: 100 = safe, 0 = near liquidation
  const healthScore = Math.max(0, Math.min(100, 100 - marginUtilization * 100));

  return {
    equity,
    availableBalance: availableBalance > 0 ? availableBalance : freeMargin,
    usedMargin,
    freeMargin,
    marginUtilization,
    drawdown,
    drawdownPct,
    winRate,
    openExposure: lockedMargin, // simplification; real = sum of position notionals
    longExposure: 0,   // requires position scan — caller may enrich
    shortExposure: 0,  // requires position scan — caller may enrich
    buyingPower,
    healthScore,
    marginBuffer,
    marginBufferPct,
  };
}

// ─── Charge a simulated fee ───
export async function chargeFee(
  accountId: number,
  fee: number,
  positionId?: number
): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account || fee <= 0) return;

  const balBefore = parseFloat(account.walletBalance);
  const balAfter = balBefore - fee;
  const newTotal = parseFloat(account.totalFeesPaid) + fee;

  await db.update(tradingAccounts).set({
    walletBalance: String(balAfter),
    equity: String(balAfter + parseFloat(account.unrealizedPnl)),
    totalFeesPaid: String(newTotal),
    updatedAt: new Date(),
  }).where(eq(tradingAccounts.id, accountId));

  await writeLedgerEntry(accountId, {
    eventType: "fee",
    debit: fee,
    credit: 0,
    balanceBefore: balBefore,
    balanceAfter: balAfter,
    referenceType: positionId ? "position" : "manual",
    referenceId: positionId,
    metadata: { fee },
  });
}

// ─── Take a snapshot ───
export async function takeAccountSnapshot(accountId: number): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account) return;

  const openCount = await db
    .select({ id: positions.id })
    .from(positions)
    .where(
      and(
        eq(positions.userId, account.userId),
        eq(positions.status, "open"),
        account.mode === "paper" ? eq(positions.isPaper, true) : eq(positions.isPaper, false)
      )
    );

  await db.insert(accountSnapshots).values({
    accountId,
    equity: account.equity,
    availableBalance: account.availableBalance,
    lockedMargin: account.lockedMargin,
    realizedPnl: account.realizedPnl,
    unrealizedPnl: account.unrealizedPnl,
    openPositionsCount: openCount.length,
    drawdown: account.drawdown,
  });
}

// ─── Reset an account (paper/backtest only) ───
export async function resetAccount(
  accountId: number,
  newBalance: number
): Promise<TradingAccount> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  if (!account) throw new Error("Account not found");
  if (account.mode === "live") throw new Error("Cannot reset a live account");

  const bal = String(newBalance);
  const [updated] = await db
    .update(tradingAccounts)
    .set({
      walletBalance: bal,
      availableBalance: bal,
      lockedMargin: "0",
      realizedPnl: "0",
      unrealizedPnl: "0",
      equity: bal,
      usedMargin: "0",
      freeMargin: bal,
      peakEquity: bal,
      drawdown: "0",
      totalFeesPaid: "0",
      totalFundingPaid: "0",
      tradeCount: 0,
      winCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(tradingAccounts.id, accountId))
    .returning();

  await writeLedgerEntry(accountId, {
    eventType: "reset",
    credit: newBalance,
    debit: 0,
    balanceBefore: parseFloat(account.walletBalance),
    balanceAfter: newBalance,
    referenceType: "manual",
    metadata: { newBalance },
  });

  return updated;
}

// ─── Internal: write a ledger entry ───
async function writeLedgerEntry(
  accountId: number,
  entry: {
    eventType: string;
    debit: number;
    credit: number;
    balanceBefore: number;
    balanceAfter: number;
    referenceType?: string;
    referenceId?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await getDb().insert(accountLedger).values({
      accountId,
      eventType: entry.eventType,
      debit: String(entry.debit),
      credit: String(entry.credit),
      balanceBefore: String(entry.balanceBefore),
      balanceAfter: String(entry.balanceAfter),
      referenceType: entry.referenceType ?? null,
      referenceId: entry.referenceId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch {
    // Ledger writes must never crash the main flow
  }
}

// ─── Get recent ledger entries for an account ───
export async function getLedgerEntries(
  accountId: number,
  limit = 50
) {
  return getDb()
    .select()
    .from(accountLedger)
    .where(eq(accountLedger.accountId, accountId))
    .orderBy(desc(accountLedger.createdAt))
    .limit(limit);
}

// ─── Get recent snapshots for an account ───
export async function getAccountSnapshots(
  accountId: number,
  limit = 100
) {
  return getDb()
    .select()
    .from(accountSnapshots)
    .where(eq(accountSnapshots.accountId, accountId))
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(limit);
}
