/**
 * Paper Wallet — thin adapter over TradingAccountService for paper mode.
 *
 * The underlying state lives in `trading_accounts` (mode="paper") with a full
 * ledger in `account_ledger`. This file keeps the same function signatures so
 * existing callers (auto-executor, trading-router) continue to work unchanged.
 *
 * Equity formula:
 *   equity           = walletBalance + unrealizedPnl
 *   availableBalance = equity - lockedMargin
 */

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
} from "./trading-account";

// In-memory account-id cache so we avoid one DB lookup per call
const accountIdCache = new Map<number, number>(); // userId → accountId

async function getAccountId(userId: number, startingBalance = 10_000): Promise<number> {
  if (accountIdCache.has(userId)) return accountIdCache.get(userId)!;
  const account = await getOrCreateAccount(userId, "paper", startingBalance);
  accountIdCache.set(userId, account.id);
  return account.id;
}

// ─── Public API ───

export async function getPaperWallet(userId: number, startingBalance = 10_000) {
  const account = await getOrCreateAccount(userId, "paper", startingBalance);
  accountIdCache.set(userId, account.id);

  const metrics = computeDerivedMetrics(account);

  return {
    userId,
    accountId: account.id,
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
    status: account.status,
  };
}

export async function lockPaperMargin(userId: number, margin: number, positionId?: number): Promise<void> {
  const accountId = await getAccountId(userId);
  await reserveMargin(accountId, margin, positionId ?? 0);
}

export async function releasePaperMargin(
  userId: number,
  margin: number,
  realizedPnl: number,
  positionId?: number
): Promise<void> {
  const accountId = await getAccountId(userId);
  const isWin = realizedPnl > 0;
  await releaseMargin(accountId, margin, realizedPnl, positionId ?? 0, isWin);
}

export async function updatePaperUnrealizedPnl(userId: number, unrealizedPnl: number): Promise<void> {
  const accountId = await getAccountId(userId);
  await updateUnrealizedPnl(accountId, unrealizedPnl);
}

export async function getPaperEquity(userId: number): Promise<number> {
  const wallet = await getPaperWallet(userId);
  return wallet.equity;
}

export async function resetPaperWallet(userId: number, newBalance: number): Promise<void> {
  const accountId = await getAccountId(userId);
  await resetAccount(accountId, newBalance);
  // Snapshot after reset so the equity curve shows the reset point
  await takeAccountSnapshot(accountId);
  // Clear cache so next getPaperWallet sees the new state
  accountIdCache.delete(userId);
}

export async function snapshotPaperWallet(userId: number): Promise<void> {
  const accountId = await getAccountId(userId);
  await takeAccountSnapshot(accountId);
}

export async function getPaperLedger(userId: number, limit = 50) {
  const accountId = await getAccountId(userId);
  return getLedgerEntries(accountId, limit);
}

export async function getPaperSnapshots(userId: number, limit = 100) {
  const accountId = await getAccountId(userId);
  return getAccountSnapshots(accountId, limit);
}
