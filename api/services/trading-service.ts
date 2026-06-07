import { getDb } from "../queries/connection";
import { positions, exchangeCredentials, futuresWallets } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  getFuturesPositions,
  getUsdtInrRate,
  getMarketsDetails,
  getFuturesOrders,
  getFuturesWallet,
  createFuturesOrder,
} from "./coindcx";
import { decryptCreds } from "../lib/crypto";
import { markPriceCache, userPositionsCache, userBalancesCache, tradingEvents } from "./coindcx-ws";
import { latestTickerCache, subscribeToSymbol } from "./streaming";
import { env } from "../lib/env";
import { globalKillSwitch } from "./kill-switch";
import { globalRiskEngine, getOrCreateSession } from "./risk-engine";
import { TRPCError } from "@trpc/server";

export async function fetchPortfolioData(userId: number) {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);

  let openPositions: any[] = [];
  let totalRealizedPnl = 0, totalMargin = 0, totalUnrealizedPnl = 0, recentTrades: any[] = [];
  const usdtInrRate = await getUsdtInrRate().catch(() => 89);
  const markets = await getMarketsDetails().catch(() => []);

  if (creds[0]) {
    try {
      const decrypted = decryptCreds(creds[0]);
      const wsPositions = userPositionsCache.get(userId);
      const livePositions = wsPositions && wsPositions.length > 0 ? wsPositions : await getFuturesPositions(decrypted);

      openPositions = livePositions.filter((p: any) => parseFloat(p.active_pos) !== 0).map((p: any) => {
        const symbol = p.pair.replace("B-", "").replace("_", "");
        const lastPrice = markPriceCache.get(p.pair) ?? latestTickerCache.get(symbol)?.lastPrice ?? parseFloat(p.mark_price || p.avg_price || "0");
        const sizeVal = parseFloat(p.active_pos);
        const unrealizedPnl = parseFloat(p.unrealized_pnl ?? p.unrealised_pnl ?? String((lastPrice - parseFloat(p.avg_price)) * sizeVal));
        
        totalMargin += parseFloat(p.locked_margin || "0");
        totalUnrealizedPnl += (p.pair.endsWith("INR") ? unrealizedPnl / usdtInrRate : unrealizedPnl);

        return { ...p, symbol, side: sizeVal >= 0 ? "long" : "short", size: Math.abs(sizeVal), currentPrice: String(lastPrice), unrealizedPnl: String(unrealizedPnl) };
      });

      const orders = await getFuturesOrders(decrypted, { status: "filled" }).catch(() => []);
      recentTrades = orders.slice(0, 20);
      totalRealizedPnl = orders.reduce((sum, o: any) => sum - parseFloat(o.fee || "0"), 0);

      // Wallet processing logic... (condensed for brevity)
    } catch (err) {
      console.error("[trading-service] Portfolio fetch failed:", err);
    }
  }

  const paperPositions = await db.select().from(positions).where(and(eq(positions.userId, userId), eq(positions.status, "open"), eq(positions.isPaper, true)));
  return { openPositions, recentTrades, totalRealizedPnl, totalMargin, totalUnrealizedPnl, usdtInrRate, paperPositions };
}

export async function executeOrder(userId: number, input: any) {
  if (!globalKillSwitch.canTrade()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Trading halted" });
  if (input.leverage > 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Leverage cap 10x" });

  const db = getDb();
  const creds = await db.select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);

  let exchangeOrderId: string | undefined;
  if (creds[0] && env.placeOrders) {
    const coindcxSymbol = input.symbol.startsWith("B-") ? input.symbol : `B-${input.symbol.replace("USDT", "_USDT")}`;
    const orderRes = await createFuturesOrder(decryptCreds(creds[0]), {
      market: coindcxSymbol, side: input.side === "long" ? "buy" : "sell", order_type: "market", total_quantity: parseFloat(input.size), price: parseFloat(input.entryPrice), leverage: input.leverage,
    });
    exchangeOrderId = orderRes?.id;
  }

  const result = await db.insert(positions).values({
    userId, symbol: input.symbol, side: input.side, entryPrice: input.entryPrice, currentPrice: input.currentPrice, size: input.size,
    leverage: input.leverage, margin: input.margin, status: "open", isPaper: !exchangeOrderId, exchangeOrderId,
  }).returning({ id: positions.id });

  tradingEvents.emit(`portfolio-update:${userId}`);
  return { id: result[0].id, exchangeOrderId };
}
