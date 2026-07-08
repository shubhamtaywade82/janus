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

export interface SymbolRegimeBreakdown {
  symbol: string;
  strategyType: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnlPct: number;   // realizedPnl / margin, averaged
  avgR: number | null; // realizedPnl / initial risk (|entry-SL| * size), averaged where SL was set
}

/** Win rate / avg R / avg PnL% broken down by symbol × strategyType, for validating
 * whether a given regime actually has an edge on a given pair before tuning configs. */
export async function computeSymbolRegimeMetrics(userId: number): Promise<SymbolRegimeBreakdown[]> {
  const db = getDb();
  const closed = await db
    .select({
      symbol: positions.symbol,
      strategyType: positions.strategyType,
      realizedPnl: positions.realizedPnl,
      margin: positions.margin,
      entryPrice: positions.entryPrice,
      stopLoss: positions.stopLoss,
      size: positions.size,
    })
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.status, "closed")));

  const groups = new Map<
    string,
    { symbol: string; strategyType: string; trades: number; wins: number; losses: number; pnlSum: number; pnlPctSum: number; rSum: number; rCount: number }
  >();

  for (const pos of closed) {
    const symbol = pos.symbol;
    const strategyType = pos.strategyType ?? "unknown";
    const key = `${symbol}:${strategyType}`;
    if (!groups.has(key)) {
      groups.set(key, { symbol, strategyType, trades: 0, wins: 0, losses: 0, pnlSum: 0, pnlPctSum: 0, rSum: 0, rCount: 0 });
    }
    const g = groups.get(key)!;

    const pnl = parseFloat(pos.realizedPnl ?? "0");
    const margin = parseFloat(pos.margin ?? "0");
    const entryPrice = parseFloat(pos.entryPrice ?? "0");
    const stopLoss = pos.stopLoss ? parseFloat(pos.stopLoss) : null;
    const size = parseFloat(pos.size ?? "0");

    g.trades++;
    g.pnlSum += pnl;
    if (margin > 0) g.pnlPctSum += pnl / margin;
    if (pnl > 0) g.wins++;
    else if (pnl < 0) g.losses++;

    if (stopLoss !== null && size > 0) {
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      const initialRisk = riskPerUnit * size;
      if (initialRisk > 0) {
        g.rSum += pnl / initialRisk;
        g.rCount++;
      }
    }
  }

  return [...groups.values()]
    .map((g) => ({
      symbol: g.symbol,
      strategyType: g.strategyType,
      trades: g.trades,
      wins: g.wins,
      losses: g.losses,
      winRate: g.trades > 0 ? g.wins / g.trades : 0,
      totalPnl: g.pnlSum,
      avgPnlPct: g.trades > 0 ? g.pnlPctSum / g.trades : 0,
      avgR: g.rCount > 0 ? g.rSum / g.rCount : null,
    }))
    .sort((a, b) => b.trades - a.trades);
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
