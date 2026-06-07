import { getDb } from "../queries/connection";
import { positions, equitySnapshots } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";

export interface PerformanceMetrics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  currentStreak: number;   // positive = consecutive wins, negative = consecutive losses
  totalRealizedPnl: number;
  byStrategy: Record<string, { wins: number; losses: number; pnl: number; trades: number }>;
}

export async function snapshotEquity(
  userId: number,
  totalEquityUsdt: number,
  unrealizedPnl = 0,
  realizedPnlToday = 0
): Promise<void> {
  try {
    const db = getDb();
    const openCountRows = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "open")));
    const openCount = openCountRows.length;

    await db.insert(equitySnapshots).values({
      userId,
      snapshotAt: new Date(),
      totalEquityUsdt: String(totalEquityUsdt),
      unrealizedPnl: String(unrealizedPnl),
      realizedPnlToday: String(realizedPnlToday),
      openPositionCount: openCount,
    });
  } catch (err) {
    console.error("[performance-tracker] snapshotEquity failed:", err);
  }
}

export async function computeMetrics(userId: number): Promise<PerformanceMetrics> {
  const db = getDb();
  const closed = await db
    .select({
      realizedPnl: positions.realizedPnl,
      strategyType: positions.strategyType,
      closedAt: positions.closedAt,
    })
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.status, "closed")))
    .orderBy(desc(positions.closedAt));

  const byStrategy: PerformanceMetrics["byStrategy"] = {};
  let winCount = 0;
  let lossCount = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalPnl = 0;
  let streak = 0;
  let streakRunning = 0;

  // Process chronologically (oldest first) for streak
  const chronological = [...closed].reverse();
  for (const pos of chronological) {
    const pnl = parseFloat(pos.realizedPnl ?? "0");
    const strat = pos.strategyType ?? "unknown";

    if (!byStrategy[strat]) byStrategy[strat] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
    byStrategy[strat].trades++;
    byStrategy[strat].pnl += pnl;

    totalPnl += pnl;
    if (pnl > 0) {
      winCount++;
      grossWins += pnl;
      largestWin = Math.max(largestWin, pnl);
      byStrategy[strat].wins++;
      streakRunning = streakRunning > 0 ? streakRunning + 1 : 1;
    } else if (pnl < 0) {
      lossCount++;
      grossLosses += Math.abs(pnl);
      largestLoss = Math.max(largestLoss, Math.abs(pnl));
      byStrategy[strat].losses++;
      streakRunning = streakRunning < 0 ? streakRunning - 1 : -1;
    }
    streak = streakRunning;
  }

  const total = winCount + lossCount;

  return {
    totalTrades: total,
    winCount,
    lossCount,
    winRate: total > 0 ? winCount / total : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    avgWin: winCount > 0 ? grossWins / winCount : 0,
    avgLoss: lossCount > 0 ? grossLosses / lossCount : 0,
    largestWin,
    largestLoss,
    currentStreak: streak,
    totalRealizedPnl: totalPnl,
    byStrategy,
  };
}

// Start hourly equity snapshot timer
let snapshotTimer: ReturnType<typeof setInterval> | null = null;

export function startEquitySnapshots(
  userId: number,
  getEquity: () => Promise<number>
): void {
  if (snapshotTimer) return;
  snapshotTimer = setInterval(async () => {
    try {
      const equity = await getEquity();
      await snapshotEquity(userId, equity);
    } catch { /* non-fatal */ }
  }, 60 * 60_000); // every 1h
}
