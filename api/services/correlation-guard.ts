/**
 * Correlation Guard
 * Prevents stacking too many same-direction positions on correlated assets.
 * All major crypto perpetuals are in the "crypto_beta" group — they move together.
 *
 * Max 2 same-direction positions in the same correlation group at once.
 */

import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { and, eq } from "drizzle-orm";

const CORRELATION_GROUPS: Record<string, string> = {
  BTCUSDT:  "crypto_beta",
  ETHUSDT:  "crypto_beta",
  SOLUSDT:  "crypto_beta",
  BNBUSDT:  "crypto_beta",
  AVAXUSDT: "crypto_beta",
  ADAUSDT:  "crypto_beta",
  XRPUSDT:  "crypto_beta",
  DOGEUSDT: "crypto_beta",
};

const MAX_SAME_DIRECTION_PER_GROUP = 2;

export interface CorrelationCheck {
  allowed: boolean;
  reason: string;
  currentCount: number;
}

export async function checkCorrelation(
  symbol: string,
  side: "long" | "short",
  userId: number
): Promise<CorrelationCheck> {
  const group = CORRELATION_GROUPS[symbol.toUpperCase()] ?? "other";

  const db = getDb();
  const openPositions = await db
    .select({ symbol: positions.symbol, side: positions.side })
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.status, "open")));

  const sameGroupSameDir = openPositions.filter(
    (p) =>
      (CORRELATION_GROUPS[p.symbol.toUpperCase()] ?? "other") === group &&
      p.side === side
  );

  if (sameGroupSameDir.length >= MAX_SAME_DIRECTION_PER_GROUP) {
    return {
      allowed: false,
      currentCount: sameGroupSameDir.length,
      reason: `${sameGroupSameDir.length} ${side} ${group} positions open — correlation limit (max ${MAX_SAME_DIRECTION_PER_GROUP})`,
    };
  }

  return { allowed: true, currentCount: sameGroupSameDir.length, reason: "" };
}
