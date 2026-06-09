import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials, futuresWallets } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";
import {
  getFuturesInstrumentInfo,
  getCrossMarginDetails,
  getUsdtInrRate,
  getCurrencyConversions,
  getFuturesWallet,
  getFuturesPositions,
} from "../services/coindcx";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { tradingEvents, initCoinDCXPrivateWs } from "../services/coindcx-ws";
import { startExitMonitor, stopExitMonitor, getFeeBreakevenMap } from "../services/exit-manager";
import { env } from "../lib/env";
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

  position: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(positions)
        .where(and(eq(positions.id, input.id), eq(positions.userId, ctx.user.id)))
        .limit(1);
      return result[0] || null;
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
      const [instrument, creds] = await Promise.all([
        getFuturesInstrumentInfo(input.symbol).catch(() => null),
        getDb().select().from(exchangeCredentials)
          .where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx")))
          .limit(1),
      ]);

      let availableUsdt = 0;
      let availableInr = 0;
      let usdtInrRate = 89;
      if (creds[0]) {
        try {
          const [wallets, rate] = await Promise.all([
            getFuturesWallet(decryptCreds(creds[0])),
            getUsdtInrRate(),
          ]);
          usdtInrRate = rate;
          for (const w of wallets) {
            const avail = parseFloat(w.balance || "0") - parseFloat(w.locked_balance || "0");
            if (w.currency_short_name === "USDT") availableUsdt += Math.max(0, avail);
            if (w.currency_short_name === "INR") availableInr += Math.max(0, avail);
          }
        } catch {}
      }

      // Current leverage from open position for this pair (best proxy)
      let currentLeverage: number | null = null;
      if (creds[0]) {
        try {
          const livePositions = await getFuturesPositions(decryptCreds(creds[0]));
          const coindcxPair = `B-${input.symbol.replace("USDT", "_USDT")}`;
          const pos = livePositions.find((p: any) => p.pair === coindcxPair && parseFloat(p.active_pos) !== 0);
          if (pos) currentLeverage = pos.leverage;
        } catch {}
      }

      const maxLeverage = instrument?.max_leverage || 10;

      return {
        symbol: input.symbol,
        pair: instrument?.pair ?? `B-${input.symbol.replace("USDT", "_USDT")}`,
        minQuantity: instrument?.min_quantity ?? 0.001,
        maxQuantity: instrument?.max_quantity ?? 1000000,
        maxQuantityMarket: instrument?.max_quantity_market ?? null,
        minNotional: instrument?.min_notional ?? 5.5,
        step: instrument?.step ?? 0.001,
        basePrecision: instrument?.base_currency_precision ?? 2,
        targetPrecision: instrument?.target_currency_precision ?? 4,
        orderTypes: instrument?.order_types ?? ["market_order", "limit_order"],
        maxLeverage: maxLeverage > 0 ? maxLeverage : 10,
        currentLeverage,
        availableUsdt,
        availableInr,
        availableUsdtEquivalent: availableUsdt + availableInr / usdtInrRate,
        usdtInrRate,
        marginCurrency: availableInr > availableUsdt * usdtInrRate ? "INR" : "USDT",
      };
    }),

  // ─── Trade history ───
  trades: authedQuery
    .input(z.object({ symbol: z.string().optional(), limit: z.number().default(50) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(trades.userId, ctx.user.id)];
      if (input.symbol) conditions.push(eq(trades.symbol, input.symbol));
      return db.select().from(trades).orderBy(desc(trades.createdAt)).limit(input.limit).where(and(...conditions));
    }),

  // ─── Risk session status ───
  riskStatus: authedQuery.query(async ({ ctx }) => {
    const session = await getOrCreateSession(ctx.user.id, 10_000);
    if (!session) return null;
    const drawdownPct =
      session.startingBalance > 0
        ? (Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance) * 100
        : 0;
    return {
      ...session,
      drawdownPct,
      drawdownLimit: globalRiskEngine.config.dailyDrawdownPct * 100,
      maxPositionPct: globalRiskEngine.config.maxPositionPct * 100,
      marginHealthHaltPct: globalRiskEngine.config.marginHealthHaltPct * 100,
    };
  }),

  // ─── Risk alert stream ───
  riskAlertStream: authedQuery.subscription(({ ctx }) => {
    return observable((emit) => {
      const handler = (payload: unknown) => emit.next(payload);
      tradingEvents.on(`risk-alert:${ctx.user.id}`, handler);
      return () => tradingEvents.off(`risk-alert:${ctx.user.id}`, handler);
    });
  }),

  // ─── USDT/INR conversion rate ───
  currencyConversion: authedQuery.query(async () => {
    const conversions = await getCurrencyConversions();
    return conversions[0] ?? { symbol: "USDTINR", conversion_price: 89.0 };
  }),

  // ─── Fee breakeven map — min price move needed to cover entry+exit fees per symbol ───
  feeBreakevenMap: authedQuery
    .input(z.object({ takerFeeRate: z.number().min(0).max(0.01).default(0.0005) }))
    .query(({ input }) => getFeeBreakevenMap(input.takerFeeRate)),

  // ─── Exit-signal stream (drives exit monitor) ───
  exitSignalStream: authedQuery.subscription(({ ctx }) => {
    return observable((emit) => {
      const onExitSignal = (payload: unknown) => emit.next(payload);
      tradingEvents.on(`exit-signal:${ctx.user.id}`, onExitSignal);

      const refreshMonitor = () => {
        const db = getDb();
        const isPaperMode = env.tradingMode === "paper";
        db.select()
          .from(positions)
          .where(and(eq(positions.userId, ctx.user.id), eq(positions.status, "open"), eq(positions.isPaper, isPaperMode)))
          .then((openPositions) => {
            const monitored = openPositions.map((p) => ({
              id: p.id,
              symbol: p.symbol,
              side: p.side as "long" | "short",
              entryPrice: parseFloat(p.entryPrice),
              size: parseFloat(p.size),
              strategyType: (p.strategyType ?? "intraday") as any,
              stopLoss: p.stopLoss ? parseFloat(p.stopLoss) : null,
              takeProfit: p.takeProfit ? parseFloat(p.takeProfit) : null,
            }));
            startExitMonitor(ctx.user.id, monitored);
          })
          .catch(() => {});
      };

      refreshMonitor();
      tradingEvents.on(`portfolio-update:${ctx.user.id}`, refreshMonitor);

      return () => {
        tradingEvents.off(`exit-signal:${ctx.user.id}`, onExitSignal);
        tradingEvents.off(`portfolio-update:${ctx.user.id}`, refreshMonitor);
        stopExitMonitor(ctx.user.id);
      };
    });
  }),

  // ─── Cached futures wallet + derived margin metrics ───
  futuresWallet: authedQuery
    .input(z.object({ marginCurrency: z.enum(["USDT", "INR"]).optional() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const cached = await db
        .select()
        .from(futuresWallets)
        .where(
          and(
            eq(futuresWallets.userId, ctx.user.id),
            eq(futuresWallets.exchange, "coindcx"),
            input.marginCurrency ? eq(futuresWallets.marginCurrency, input.marginCurrency) : undefined
          )
        )
        .orderBy(desc(futuresWallets.updatedAt))
        .limit(1);
      if (!cached[0]) return null;

      const w = cached[0];
      const balance = parseFloat(w.balance);
      const lockedBalance = parseFloat(w.lockedBalance);
      const unrealizedPnl = parseFloat(w.unrealizedPnl);
      const crossUserMargin = parseFloat(w.crossUserMargin);
      const crossOrderMargin = parseFloat(w.crossOrderMargin);

      const walletBalance = balance + lockedBalance;
      const equity = walletBalance + unrealizedPnl;
      const usedMargin = crossUserMargin + crossOrderMargin;
      const freeMargin = Math.max(0, equity - usedMargin);
      const marginUtilization = equity > 0 ? usedMargin / equity : 0;
      const buyingPower = freeMargin * 10;
      const maintenanceMargin = parseFloat(w.maintenanceMargin);
      const marginBuffer = Math.max(0, equity - maintenanceMargin);
      const marginBufferPct = equity > 0 ? marginBuffer / equity : 1;

      return { ...w, walletBalance, equity, usedMargin, freeMargin, marginUtilization, buyingPower, marginBuffer, marginBufferPct };
    }),

  // ─── Cross margin details (live from CoinDCX) ───
  crossMarginDetails: authedQuery.query(async ({ ctx }) => {
    try {
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx")))
        .limit(1);
      if (!creds || !creds[0]) return null;
      return await getCrossMarginDetails(decryptCreds(creds[0]));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Only log once-style: 404 is expected when cross-margin is unavailable
      if (!msg.includes("404")) {
        console.warn("[trading-router] Failed to fetch cross margin details:", msg);
      }
      return null;
    }
  }),
});
