import type { ManagedPosition, OpportunityCostResult } from "./types";
import { getDb } from "../../queries/connection";
import { signals } from "@db/schema";
import { desc, gte, ne } from "drizzle-orm";

// ─── Opportunity Cost Evaluator ──────────────────────────────────────────────
// Runs every 10 minutes and asks: "Is this the BEST use of my capital?"
// Compares the current position's score against top signals available right now.

const OPPORTUNITY_LOOKBACK_MS = 5 * 60 * 1000; // signals from last 5 min

export async function evaluateOpportunityCost(
  position: ManagedPosition,
  currentPositionScore: number
): Promise<OpportunityCostResult> {
  let bestOpportunityScore: number | null = null;

  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - OPPORTUNITY_LOOKBACK_MS);

    const freshSignals = await db
      .select({
        symbol: signals.symbol,
        compositeScore: signals.compositeScore,
        direction: signals.direction,
        isGated: signals.isGated,
      })
      .from(signals)
      .where(gte(signals.createdAt, cutoff))
      .orderBy(desc(signals.compositeScore))
      .limit(20);

    // Exclude the position's own symbol
    const others = freshSignals.filter(
      (s) =>
        s.symbol !== position.binanceSymbol &&
        s.isGated &&
        parseFloat(s.compositeScore) > 70
    );

    if (others.length > 0) {
      bestOpportunityScore = parseFloat(others[0].compositeScore);
    }
  } catch {
    // Non-fatal — DB may be unavailable
  }

  // Scoring rubric:
  // - If holding position with good ROE + good score → KEEP
  // - If best opportunity >> current position value → REDUCE or EXIT
  const roe = position.roe;
  const holdingHours = position.holdingMinutes / 60;

  // Position is doing well (>5% ROE) — keep unless opportunity is overwhelming
  if (roe > 5) {
    if (bestOpportunityScore !== null && bestOpportunityScore > 88 && currentPositionScore < 55) {
      return {
        verdict: "REDUCE",
        reason: `Better opportunity (score ${bestOpportunityScore.toFixed(0)}) while position score is ${currentPositionScore.toFixed(0)} — reducing exposure`,
        bestOpportunityScore,
        currentPositionScore,
      };
    }
    return {
      verdict: "KEEP",
      reason: `Position has ${roe.toFixed(1)}% ROE — capital well-deployed`,
      bestOpportunityScore,
      currentPositionScore,
    };
  }

  // Position is unprofitable or marginally profitable
  if (roe < -3) {
    if (bestOpportunityScore !== null && bestOpportunityScore > 80) {
      return {
        verdict: "EXIT",
        reason: `Losing position (${roe.toFixed(1)}% ROE) blocking capital for better opportunity (score ${bestOpportunityScore.toFixed(0)})`,
        bestOpportunityScore,
        currentPositionScore,
      };
    }
  }

  // Stale position: long hold, no direction, low score
  if (holdingHours > 4 && Math.abs(roe) < 2 && currentPositionScore < 55) {
    return {
      verdict: "REDUCE",
      reason: `Position stale (${holdingHours.toFixed(1)}h held, ${roe.toFixed(1)}% ROE, score ${currentPositionScore.toFixed(0)}) — freeing partial capital`,
      bestOpportunityScore,
      currentPositionScore,
    };
  }

  return {
    verdict: "KEEP",
    reason: "No compelling opportunity found — holding current position",
    bestOpportunityScore,
    currentPositionScore,
  };
}
