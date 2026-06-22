import { getDb } from "../queries/connection";
import { marketData } from "@db/schema";
import { and, eq, desc, gte } from "drizzle-orm";

let btcDumpCache: { isDumping: boolean; updatedAt: number; dropPct: number } = { isDumping: false, updatedAt: 0, dropPct: 0 };

/**
 * Implements the BTC Market Anchoring logic from The Alpha Protocol.
 * Returns true if BTC has dropped more than 3% in the last 60 minutes.
 * Used as a global kill-switch to pause LONG entries.
 */
export async function isBtcDumping(): Promise<boolean> {
  const now = Date.now();
  // Cache for 1 minute
  if (now - btcDumpCache.updatedAt < 60_000) {
    return btcDumpCache.isDumping;
  }

  try {
    const db = getDb();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    
    // Get the most recent BTC price
    const latestKline = await db.query.marketData.findFirst({
      where: and(eq(marketData.symbol, "BTCUSDT"), eq(marketData.timeframe, "1m")),
      orderBy: [desc(marketData.timestamp)],
    });

    // Get the oldest BTC price within the last hour
    const oldKline = await db.query.marketData.findFirst({
      where: and(
        eq(marketData.symbol, "BTCUSDT"),
        eq(marketData.timeframe, "1m"),
        gte(marketData.timestamp, oneHourAgo)
      ),
      orderBy: [marketData.timestamp],
    });

    if (latestKline && oldKline) {
      const currentPrice = parseFloat(latestKline.close);
      const oldPrice = parseFloat(oldKline.close);
      
      const dropPct = (oldPrice - currentPrice) / oldPrice;
      const isDumping = dropPct >= 0.03; // 3% drop
      
      btcDumpCache = { isDumping, updatedAt: now, dropPct };
      
      if (isDumping) {
        console.warn(`[btc-anchor] BTC MARKET DUMP DETECTED. Drop: ${(dropPct * 100).toFixed(2)}%. LONG entries will be paused.`);
      }
      
      return isDumping;
    }
  } catch (err) {
    console.error("[btc-anchor] Failed to check BTC dump status:", err);
  }
  
  return false;
}
