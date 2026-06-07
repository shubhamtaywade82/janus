/**
 * Paper Wallet — thin adapter over TradingAccountService for paper mode.
 *
 * The underlying state lives in `trading_accounts` (mode="paper") with a full
 * ledger in `account_ledger`.
 *
 * Currency support:
 *   - USDT paper: balance, margin, PnL all in USDT (1:1 with position values)
 *   - INR paper:  balance, margin, PnL all in INR. Callers pass USDT values;
 *                 this adapter converts via live USDT/INR rate before storing.
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { getUsdtInrRate } from "./coindcx";

import {
  getOrCreateAccount,
  reserveMargin,
  releaseMargin,
  updateUnrealizedPnl,
  computeDerivedMetrics,
  resetAccount,
  takeAccountSnapshot,
  getLedgerEntries,
  getAccountSnapshots,
  depositToAccount,
  getDepositTotals,
} from "./trading-account";

// In-memory account-id cache keyed by "userId:currency"
const accountIdCache = new Map<string, number>();

function cacheKey(userId: number, currency: string): string {
  return `${userId}:${currency}`;
}

async function getAccountId(
  userId: number,
  startingBalance = 100_000,
  currency: "USDT" | "INR" = "INR"
): Promise<number> {
  const key = cacheKey(userId, currency);
  if (accountIdCache.has(key)) return accountIdCache.get(key)!;
  const account = await getOrCreateAccount(userId, "paper", startingBalance, currency);
  accountIdCache.set(key, account.id);
  return account.id;
}

// ─── Public API ───

export async function getPaperWallet(
  userId: number,
  startingBalance = 100_000,
  currency: "USDT" | "INR" = "INR"
) {
  const account = await getOrCreateAccount(userId, "paper", startingBalance, currency);
  accountIdCache.set(cacheKey(userId, currency), account.id);

  const metrics = computeDerivedMetrics(account);
  const { totalDeposited, depositCount } = await getDepositTotals(account.id);

  return {
    userId,
    accountId: account.id,
    currency: account.currency,
    startingBalance: parseFloat(account.initialBalance),
    balance: parseFloat(account.availableBalance),
    lockedMargin: parseFloat(account.lockedMargin),
    realizedPnl: parseFloat(account.realizedPnl),
    unrealizedPnl: parseFloat(account.unrealizedPnl),
    equity: metrics.equity,
    usedMargin: metrics.usedMargin,
    freeMargin: metrics.freeMargin,
    marginUtilization: metrics.marginUtilization,
    drawdown: metrics.drawdown,
    drawdownPct: metrics.drawdownPct,
    peakEquity: parseFloat(account.peakEquity),
    winRate: metrics.winRate,
    buyingPower: metrics.buyingPower,
    healthScore: metrics.healthScore,
    marginBuffer: metrics.marginBuffer,
    marginBufferPct: metrics.marginBufferPct,
    tradeCount: account.tradeCount,
    winCount: account.winCount,
    totalFeesPaid: parseFloat(account.totalFeesPaid),
    totalFundingPaid: parseFloat(account.totalFundingPaid),
    totalDeposited,
    depositCount,
    status: account.status,
  };
}

/**
 * Deposit virtual INR funds into the paper wallet.
 * @param amount  amount in the wallet's own currency (no USDT conversion — INR deposits go straight in)
 */
export async function depositPaperFunds(
  userId: number,
  amount: number,
  currency: "USDT" | "INR" = "INR",
  note?: string
): Promise<void> {
  const accountId = await getAccountId(userId, undefined, currency);
  await depositToAccount(accountId, amount, note);
}

/**
 * Lock margin for a paper position.
 * @param margin  USDT-denominated margin (will be converted to INR if currency=INR)
 */
export async function lockPaperMargin(
  userId: number,
  margin: number,
  positionId?: number,
  currency: "USDT" | "INR" = "INR"
): Promise<void> {
  const accountId = await getAccountId(userId, undefined, currency);
  let finalMargin = margin;
  if (currency === "INR") {
    const rate = await getUsdtInrRate();
    finalMargin = margin * rate;
  }
  await reserveMargin(accountId, finalMargin, positionId ?? 0);
}

/**
 * Release margin + realized PnL for a paper position.
 * @param margin       USDT-denominated margin to release
 * @param realizedPnl  USDT-denominated PnL (will be converted to INR if currency=INR)
 */
export async function releasePaperMargin(
  userId: number,
  margin: number,
  realizedPnl: number,
  positionId?: number,
  currency: "USDT" | "INR" = "INR"
): Promise<void> {
  const accountId = await getAccountId(userId, undefined, currency);
  let finalMargin = margin;
  let finalPnl = realizedPnl;
  if (currency === "INR") {
    const rate = await getUsdtInrRate();
    finalMargin = margin * rate;
    finalPnl = realizedPnl * rate;
  }
  const isWin = finalPnl > 0;
  await releaseMargin(accountId, finalMargin, finalPnl, positionId ?? 0, isWin);
}

export async function updatePaperUnrealizedPnl(
  userId: number,
  unrealizedPnl: number,
  currency: "USDT" | "INR" = "INR"
): Promise<void> {
  const accountId = await getAccountId(userId, undefined, currency);
  let finalUnrealized = unrealizedPnl;
  if (currency === "INR") {
    const rate = await getUsdtInrRate();
    finalUnrealized = unrealizedPnl * rate;
  }
  await updateUnrealizedPnl(accountId, finalUnrealized);
}

export async function getPaperEquity(
  userId: number,
  currency: "USDT" | "INR" = "INR"
): Promise<number> {
  const wallet = await getPaperWallet(userId, undefined, currency);
  return wallet.equity;
}

export async function resetPaperWallet(
  userId: number,
  newBalance: number,
  currency: "USDT" | "INR" = "INR"
): Promise<void> {
  const accountId = await getAccountId(userId, newBalance, currency);
  await resetAccount(accountId, newBalance);

  // Clean up all paper positions so they don't linger after reset
  await getDb()
    .delete(positions)
    .where(and(eq(positions.userId, userId), eq(positions.isPaper, true)));

  // Snapshot after reset so the equity curve shows the reset point
  await takeAccountSnapshot(accountId);
  // Clear cache so next getPaperWallet sees the new state
  accountIdCache.delete(cacheKey(userId, currency));
}

export async function snapshotPaperWallet(
  userId: number,
  currency: "USDT" | "INR" = "INR"
): Promise<void> {
  const accountId = await getAccountId(userId, undefined, currency);
  await takeAccountSnapshot(accountId);
}

export async function getPaperLedger(
  userId: number,
  limit = 50,
  currency: "USDT" | "INR" = "INR"
) {
  const accountId = await getAccountId(userId, undefined, currency);
  return getLedgerEntries(accountId, limit);
}

export async function getPaperSnapshots(
  userId: number,
  limit = 100,
  currency: "USDT" | "INR" = "INR"
) {
  const accountId = await getAccountId(userId, undefined, currency);
  return getAccountSnapshots(accountId, limit);
}
