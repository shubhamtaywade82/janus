import Decimal from "decimal.js";
import { getDb } from "../queries/connection";
import { tradingAccounts, accountLedger } from "@db/schema";
import { and, eq } from "drizzle-orm";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export class WalletLedgerService {
  /**
   * Safely reserves available funds by moving them to locked status.
   */
  public static async lockMargin(
    userId: number,
    mode: "live" | "paper" | "backtest",
    currency: "USDT" | "INR",
    marginStr: string,
    referenceId: number,
    referenceType = "position"
  ): Promise<void> {
    const db = getDb();
    const margin = new Decimal(marginStr);

    await db.transaction(async (tx) => {
      // 1. Fetch account with an explicit row-level lock
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.mode, mode),
            eq(tradingAccounts.currency, currency)
          )
        )
        .for("update");

      if (!account) throw new Error("Target trading account registry missing");

      const available = new Decimal(account.availableBalance);
      const locked = new Decimal(account.lockedMargin);
      const walletBalance = new Decimal(account.walletBalance);
      const equity = new Decimal(account.equity);

      if (available.lt(margin)) {
        throw new Error(
          `Insufficient funds available to lock: available=${available.toFixed(
            4
          )}, required=${margin.toFixed(4)}`
        );
      }

      const newLocked = locked.add(margin);
      const newAvailable = available.sub(margin);
      const freeMargin = Decimal.max(0, newAvailable);

      // 2. Perform safe transformations back into database string entries
      await tx
        .update(tradingAccounts)
        .set({
          lockedMargin: newLocked.toFixed(8),
          availableBalance: newAvailable.toFixed(8),
          usedMargin: newLocked.toFixed(8),
          freeMargin: freeMargin.toFixed(8),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, account.id));

      // 3. Append to transactional ledger audit trail
      await tx.insert(accountLedger).values({
        accountId: account.id,
        eventType: "reserve_margin",
        debit: margin.toFixed(8),
        credit: "0.00000000",
        balanceBefore: walletBalance.toFixed(8),
        balanceAfter: walletBalance.sub(margin).toFixed(8),
        referenceType,
        referenceId,
        metadata: { margin: margin.toNumber(), equity: equity.toNumber() },
      });
    });
  }

  /**
   * Refund reserved margin (e.g. when order is rejected or cancelled).
   */
  public static async refundMargin(
    userId: number,
    mode: "live" | "paper" | "backtest",
    currency: "USDT" | "INR",
    marginStr: string,
    referenceId: number,
    referenceType = "order"
  ): Promise<void> {
    const db = getDb();
    const margin = new Decimal(marginStr);

    await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.mode, mode),
            eq(tradingAccounts.currency, currency)
          )
        )
        .for("update");

      if (!account) return;

      const locked = new Decimal(account.lockedMargin);
      const newLocked = Decimal.max(0, locked.sub(margin));
      const newAvailable = new Decimal(account.availableBalance).add(margin);
      const freeMargin = Decimal.max(0, newAvailable);

      await tx
        .update(tradingAccounts)
        .set({
          lockedMargin: newLocked.toFixed(8),
          availableBalance: newAvailable.toFixed(8),
          usedMargin: newLocked.toFixed(8),
          freeMargin: freeMargin.toFixed(8),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, account.id));

      await tx.insert(accountLedger).values({
        accountId: account.id,
        eventType: "release_margin",
        debit: "0.00000000",
        credit: margin.toFixed(8),
        balanceBefore: newAvailable.sub(margin).toFixed(8),
        balanceAfter: newAvailable.toFixed(8),
        referenceType,
        referenceId,
        metadata: { refunded: margin.toNumber() },
      });
    });
  }

  /**
   * Release margin and settle realized PnL.
   */
  public static async releaseMargin(
    userId: number,
    mode: "live" | "paper" | "backtest",
    currency: "USDT" | "INR",
    marginStr: string,
    realizedPnlStr: string,
    positionId: number,
    isWin: boolean
  ): Promise<void> {
    const db = getDb();
    const margin = new Decimal(marginStr);
    const realizedPnl = new Decimal(realizedPnlStr);

    await db.transaction(async (tx) => {
      // 1. Fetch account with an explicit row-level lock
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.mode, mode),
            eq(tradingAccounts.currency, currency)
          )
        )
        .for("update");

      if (!account) throw new Error("Target trading account registry missing");

      const balBefore = new Decimal(account.walletBalance);
      const newWalletBalance = balBefore.add(realizedPnl);
      const newRealized = new Decimal(account.realizedPnl).add(realizedPnl);
      const newLocked = Decimal.max(
        0,
        new Decimal(account.lockedMargin).sub(margin)
      );
      const newEquity = newWalletBalance.add(new Decimal(account.unrealizedPnl));
      const peakEquity = Decimal.max(newEquity, new Decimal(account.peakEquity));
      const drawdown = Decimal.max(0, peakEquity.sub(newEquity));
      const newAvailable = newEquity.sub(newLocked);
      const newTradeCount = account.tradeCount + 1;
      const newWinCount = account.winCount + (isWin ? 1 : 0);

      // 2. Perform safe transformations back into database string entries
      await tx
        .update(tradingAccounts)
        .set({
          walletBalance: newWalletBalance.toFixed(8),
          availableBalance: newAvailable.toFixed(8),
          lockedMargin: newLocked.toFixed(8),
          realizedPnl: newRealized.toFixed(8),
          equity: newEquity.toFixed(8),
          usedMargin: newLocked.toFixed(8),
          freeMargin: newAvailable.toFixed(8),
          peakEquity: peakEquity.toFixed(8),
          drawdown: drawdown.toFixed(8),
          tradeCount: newTradeCount,
          winCount: newWinCount,
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, account.id));

      // 3. Append to transactional ledger audit trail
      await tx.insert(accountLedger).values({
        accountId: account.id,
        eventType: "pnl_realization",
        debit: realizedPnl.lt(0) ? realizedPnl.abs().toFixed(8) : "0.00000000",
        credit: realizedPnl.gte(0) ? realizedPnl.toFixed(8) : "0.00000000",
        balanceBefore: balBefore.toFixed(8),
        balanceAfter: newWalletBalance.toFixed(8),
        referenceType: "position",
        referenceId: positionId,
        metadata: {
          margin: margin.toNumber(),
          realizedPnl: realizedPnl.toNumber(),
          isWin,
        },
      });

      await tx.insert(accountLedger).values({
        accountId: account.id,
        eventType: "release_margin",
        debit: "0.00000000",
        credit: margin.toFixed(8),
        balanceBefore: newWalletBalance.sub(margin).toFixed(8),
        balanceAfter: newWalletBalance.toFixed(8),
        referenceType: "position",
        referenceId: positionId,
        metadata: { margin: margin.toNumber() },
      });
    });
  }

  /**
   * Update unrealized PnL from mark prices.
   */
  public static async updateUnrealizedPnl(
    userId: number,
    mode: "live" | "paper" | "backtest",
    currency: "USDT" | "INR",
    unrealizedPnlStr: string
  ): Promise<void> {
    const db = getDb();
    const unrealizedPnl = new Decimal(unrealizedPnlStr);

    await db.transaction(async (tx) => {
      // 1. Fetch account with an explicit row-level lock
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.mode, mode),
            eq(tradingAccounts.currency, currency)
          )
        )
        .for("update");

      if (!account) return;

      const walletBalance = new Decimal(account.walletBalance);
      const lockedMargin = new Decimal(account.lockedMargin);
      const peakEquity = new Decimal(account.peakEquity);

      const equity = walletBalance.add(unrealizedPnl);
      const newPeakEquity = Decimal.max(equity, peakEquity);
      const drawdown = Decimal.max(0, newPeakEquity.sub(equity));
      const freeMargin = equity.sub(lockedMargin);

      // 2. Perform safe transformations back into database string entries
      await tx
        .update(tradingAccounts)
        .set({
          unrealizedPnl: unrealizedPnl.toFixed(8),
          equity: equity.toFixed(8),
          availableBalance: freeMargin.toFixed(8),
          freeMargin: freeMargin.toFixed(8),
          peakEquity: newPeakEquity.toFixed(8),
          drawdown: drawdown.toFixed(8),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, account.id));
    });
  }

  /**
   * Charge fee.
   */
  public static async chargeFee(
    userId: number,
    mode: "live" | "paper" | "backtest",
    currency: "USDT" | "INR",
    feeStr: string,
    positionId?: number
  ): Promise<void> {
    const db = getDb();
    const fee = new Decimal(feeStr);
    if (fee.lte(0)) return;

    await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.mode, mode),
            eq(tradingAccounts.currency, currency)
          )
        )
        .for("update");

      if (!account) return;

      const balBefore = new Decimal(account.walletBalance);
      const balAfter = balBefore.sub(fee);
      const newTotal = new Decimal(account.totalFeesPaid).add(fee);
      const newEquity = balAfter.add(new Decimal(account.unrealizedPnl));

      await tx
        .update(tradingAccounts)
        .set({
          walletBalance: balAfter.toFixed(8),
          equity: newEquity.toFixed(8),
          totalFeesPaid: newTotal.toFixed(8),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, account.id));

      await tx.insert(accountLedger).values({
        accountId: account.id,
        eventType: "fee",
        debit: fee.toFixed(8),
        credit: "0.00000000",
        balanceBefore: balBefore.toFixed(8),
        balanceAfter: balAfter.toFixed(8),
        referenceType: positionId ? "position" : "manual",
        referenceId: positionId ?? null,
        metadata: { fee: fee.toNumber() },
      });
    });
  }
}
