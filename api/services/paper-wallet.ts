/**
 * Paper Wallet
 * Tracks virtual balance for paper trading mode (PLACE_ORDERS=false).
 *
 * Balance lifecycle:
 *   startingBalance (configurable, default $10,000)
 *   - margin locked when paper position opened
 *   + margin released + realizedPnl when paper position closed
 *
 * State persists in-memory (resets on server restart).
 * Seeded from config.paperStartingBalance on first use.
 */

import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { and, eq } from "drizzle-orm";

interface PaperWalletState {
  userId: number;
  startingBalance: number;
  balance: number;         // free (not locked in positions)
  lockedMargin: number;    // sum of margins in open paper positions
  realizedPnl: number;
  tradeCount: number;
}

const wallets = new Map<number, PaperWalletState>();

export async function getPaperWallet(userId: number, startingBalance = 10_000): Promise<PaperWalletState> {
  if (wallets.has(userId)) return wallets.get(userId)!;

  // Reconstruct from DB on first access (e.g., after server restart)
  try {
    const db = getDb();
    const openPaperPositions = await db
      .select({ margin: positions.margin, realizedPnl: positions.realizedPnl })
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "open"), eq(positions.isPaper, true)));

    const lockedMargin = openPaperPositions.reduce((sum, p) => sum + parseFloat(p.margin), 0);

    const closedPaperPositions = await db
      .select({ realizedPnl: positions.realizedPnl })
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "closed"), eq(positions.isPaper, true)));

    const realizedPnl = closedPaperPositions.reduce((sum, p) => sum + parseFloat(p.realizedPnl ?? "0"), 0);
    const tradeCount = closedPaperPositions.length;

    const state: PaperWalletState = {
      userId,
      startingBalance,
      balance: startingBalance - lockedMargin + realizedPnl,
      lockedMargin,
      realizedPnl,
      tradeCount,
    };
    wallets.set(userId, state);
    return state;
  } catch {
    const state: PaperWalletState = {
      userId,
      startingBalance,
      balance: startingBalance,
      lockedMargin: 0,
      realizedPnl: 0,
      tradeCount: 0,
    };
    wallets.set(userId, state);
    return state;
  }
}

export function lockPaperMargin(userId: number, margin: number): void {
  const wallet = wallets.get(userId);
  if (!wallet) return;
  wallet.lockedMargin += margin;
  wallet.balance -= margin;
}

export function releasePaperMargin(userId: number, margin: number, realizedPnl: number): void {
  const wallet = wallets.get(userId);
  if (!wallet) return;
  wallet.lockedMargin = Math.max(0, wallet.lockedMargin - margin);
  wallet.balance += margin + realizedPnl;
  wallet.realizedPnl += realizedPnl;
  wallet.tradeCount++;
}

export function getPaperEquity(userId: number): number {
  const wallet = wallets.get(userId);
  if (!wallet) return 0;
  return wallet.balance + wallet.lockedMargin; // total = free + locked
}

export function resetPaperWallet(userId: number, newBalance: number): void {
  wallets.set(userId, {
    userId,
    startingBalance: newBalance,
    balance: newBalance,
    lockedMargin: 0,
    realizedPnl: 0,
    tradeCount: 0,
  });
}
