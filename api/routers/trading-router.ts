import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials, futuresWallets } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";
import {
  getFuturesOrders,
  getFuturesInstrumentInfo,
  getCrossMarginDetails,
  walletTransfer,
  addRemoveMargin,
  getUsdtInrRate,
  getCurrencyConversions,
  getFuturesWallet,
  getFuturesPositions,
} from "../services/coindcx";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { tradingEvents, initCoinDCXPrivateWs } from "../services/coindcx-ws";
import { getFeeBreakevenMap, startExitMonitor, stopExitMonitor } from "../services/exit-manager";
import { globalRiskEngine, getOrCreateSession, updateSession } from "../services/risk-engine";
import { unregisterPosition } from "../services/trailing-stop";
import { encrypt, decryptCreds } from "../lib/crypto";
import { fetchPortfolioData, executeOrder } from "../services/trading-service";

export const tradingRouter = createRouter({
  positions: authedQuery
    .input(z.object({ userId: z.number().optional(), status: z.enum(["open", "closed", "liquidated"]).optional(), symbol: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [];
      const userId = ctx.user.id;
      conditions.push(eq(positions.userId, userId));
      if (input.status) conditions.push(eq(positions.status, input.status));
      if (input.symbol) conditions.push(eq(positions.symbol, input.symbol));
      return db.select().from(positions).where(and(...conditions)).orderBy(desc(positions.createdAt));
    }),

  createPosition: authedQuery
    .input(z.object({ symbol: z.string(), side: z.enum(["long", "short"]), entryPrice: z.string(), currentPrice: z.string(), size: z.string(), leverage: z.number().default(1), margin: z.string(), stopLoss: z.string().optional(), takeProfit: z.string().optional(), strategyType: z.string().default("intraday") }))
    .mutation(async ({ input, ctx }) => {
      return executeOrder(ctx.user.id, input);
    }),

  closePosition: authedQuery
    .input(z.object({ id: z.number(), closePrice: z.string(), realizedPnl: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [pos] = await db.select().from(positions).where(eq(positions.id, input.id)).limit(1);
      if (!pos) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });
      if (pos.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      await db.update(positions).set({ status: "closed", currentPrice: input.closePrice, realizedPnl: input.realizedPnl, unrealizedPnl: "0", exitReason: "Manual Close", closedAt: new Date() }).where(eq(positions.id, input.id));
      
      const session = await getOrCreateSession(ctx.user.id, 0);
      await updateSession(globalRiskEngine.recordTrade(session, { pnl: parseFloat(input.realizedPnl) }));
      unregisterPosition(input.id);
      tradingEvents.emit(`portfolio-update:${ctx.user.id}`);
      return { success: true };
    }),

  portfolio: authedQuery.query(async ({ ctx }) => fetchPortfolioData(ctx.user.id)),

  portfolioStream: authedQuery.subscription(({ ctx }) => {
    return observable((emit) => {
      const onUpdate = async () => { try { emit.next(await fetchPortfolioData(ctx.user.id)); } catch {} };
      tradingEvents.on(`portfolio-update:${ctx.user.id}`, onUpdate);
      const interval = setInterval(onUpdate, 5000);
      onUpdate();
      return () => { tradingEvents.off(`portfolio-update:${ctx.user.id}`, onUpdate); clearInterval(interval); };
    });
  }),

  credentials: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb().select().from(exchangeCredentials).where(eq(exchangeCredentials.userId, ctx.user.id));
    return rows.map((r) => ({ ...r, apiSecret: "••••••••" }));
  }),

  saveCredentials: authedQuery
    .input(z.object({ exchange: z.enum(["coindcx", "binance"]), apiKey: z.string(), apiSecret: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().insert(exchangeCredentials).values({ userId: ctx.user.id, exchange: input.exchange, apiKey: encrypt(input.apiKey), apiSecret: encrypt(input.apiSecret) });
      if (input.exchange === "coindcx") initCoinDCXPrivateWs().catch(() => {});
      return { success: true };
    }),

  instrumentInfo: authedQuery
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input, ctx }) => {
      const instrument = await getFuturesInstrumentInfo(input.symbol).catch(() => null);
      const [creds] = await getDb().select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);
      
      let availableUsdt = 0, availableInr = 0, usdtInrRate = 89;
      if (creds) {
        try {
          const [wallets, rate] = await Promise.all([getFuturesWallet(decryptCreds(creds)), getUsdtInrRate()]);
          usdtInrRate = rate;
          wallets.forEach(w => {
            const avail = parseFloat(w.balance || "0") - parseFloat(w.locked_balance || "0");
            if (w.currency_short_name === "USDT") availableUsdt += avail;
            if (w.currency_short_name === "INR") availableInr += avail;
          });
        } catch {}
      }

      return {
        symbol: input.symbol,
        minQuantity: instrument?.min_quantity ?? 0.001,
        minNotional: instrument?.min_notional ?? 5.5,
        basePrecision: instrument?.base_currency_precision ?? 2,
        targetPrecision: instrument?.target_currency_precision ?? 4,
        maxLeverage: instrument?.max_leverage ?? 10,
        availableUsdt,
        availableInr,
        usdtInrRate,
      };
    }),
});
