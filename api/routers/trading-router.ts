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
  getFuturesOrders,
  createFuturesOrder,
} from "../services/coindcx";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { tradingEvents, initCoinDCXPrivateWs } from "../services/coindcx-ws";
import { startExitMonitor, stopExitMonitor, getFeeBreakevenMap } from "../services/exit-manager";
import { globalRiskEngine, getOrCreateSession, updateSession } from "../services/risk-engine";
import { unregisterPosition } from "../services/trailing-stop";
import { releasePaperPositionMargin, resolvePaperPositionMargin } from "../services/paper-currency";
import { autoExecutorConfig } from "@db/schema";
import { encrypt, decryptCreds } from "../lib/crypto";
import { fetchPortfolioData, executeOrder } from "../services/trading-service";
import { env, coinDCXEnvCreds } from "../lib/env";
import { globalKillSwitch } from "../services/kill-switch";
import { recordPositionTransaction } from "../services/position-manager/transaction-ledger";

export const tradingRouter = createRouter({
  positions: authedQuery
    .input(z.object({ userId: z.number().optional(), status: z.enum(["open", "closed", "liquidated"]).optional(), symbol: z.string().optional(), isPaper: z.boolean().optional() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [];
      const userId = ctx.user.id;
      conditions.push(eq(positions.userId, userId));
      if (input.status) conditions.push(eq(positions.status, input.status));
      if (input.symbol) conditions.push(eq(positions.symbol, input.symbol));
      if (input.isPaper !== undefined) conditions.push(eq(positions.isPaper, input.isPaper));
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

      if (!pos.isPaper) {
        if (!env.placeOrders) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live order execution is disabled (PLACE_ORDERS=false)" });
        }
        try {
          const dbCreds = await db.select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);
          const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;
          if (!coindcxCreds) throw new TRPCError({ code: "BAD_REQUEST", message: "No CoinDCX exchange credentials found" });

          const coindcxSide = (pos.side.toLowerCase() === "long" || pos.side.toLowerCase() === "buy") ? "sell" : "buy";
          const coindcxSymbol = pos.symbol.startsWith("B-")
            ? pos.symbol
            : `B-${pos.symbol.replace("USDT", "_USDT")}`;
          await createFuturesOrder(coindcxCreds, {
            market: coindcxSymbol,
            side: coindcxSide,
            order_type: "market",
            total_quantity: parseFloat(pos.size),
            leverage: pos.leverage,
          });
        } catch (err: any) {
          console.error(`[trading-router] Live exchange close failed for position #${pos.id}:`, err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Exchange order failed: ${err.message || String(err)}`,
          });
        }
      }

      await db.update(positions).set({ status: "closed", currentPrice: input.closePrice, realizedPnl: input.realizedPnl, unrealizedPnl: "0", exitReason: "Manual Close", closedAt: new Date() }).where(eq(positions.id, input.id));

      if (pos.isPaper) {
        const [cfg] = await db
          .select({ paperCurrency: autoExecutorConfig.paperCurrency })
          .from(autoExecutorConfig)
          .where(eq(autoExecutorConfig.userId, ctx.user.id))
          .limit(1);
        const paperCurrency = (cfg?.paperCurrency as "USDT" | "INR") ?? "INR";
        const { marginUsdt } = await resolvePaperPositionMargin({
          marginStored: parseFloat(pos.margin),
          marginCurrency: paperCurrency,
          size: parseFloat(pos.size),
          entryPrice: parseFloat(pos.entryPrice),
          leverage: pos.leverage,
        });
        await releasePaperPositionMargin(
          ctx.user.id,
          marginUsdt,
          parseFloat(input.realizedPnl),
          pos.id,
          paperCurrency
        );
      }

      try {
        await recordPositionTransaction({
          positionId: pos.id,
          userId: ctx.user.id,
          symbol: pos.symbol,
          type: "FULL_EXIT",
          side: (pos.side.toLowerCase() === "long" || pos.side.toLowerCase() === "buy") ? "LONG" : "SHORT",
          quantityBefore: parseFloat(pos.size),
          quantityAfter: 0,
          quantityDelta: -parseFloat(pos.size),
          price: parseFloat(input.closePrice),
          avgEntryPrice: parseFloat(pos.entryPrice),
          realizedPnl: parseFloat(input.realizedPnl),
          fee: pos.isPaper ? 0 : parseFloat(input.closePrice) * parseFloat(pos.size) * 0.0004,
          marginBefore: parseFloat(pos.margin),
          marginAfter: 0,
          metadata: { reason: "Manual Close" }
        });
      } catch (ledgerErr) {
        console.error("[trading-router] Ledger entry failed:", ledgerErr);
      }
      
      const session = await getOrCreateSession(ctx.user.id, 0);
      await updateSession(globalRiskEngine.recordTrade(session, { pnl: parseFloat(input.realizedPnl) }));
      unregisterPosition(input.id);
      tradingEvents.emit(`portfolio-update:${ctx.user.id}`);
      return { success: true };
    }),

  panicCloseAll: authedQuery
    .input(z.object({ isPaper: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user.id;

      globalKillSwitch.trigger("manual", `Panic Close All triggered manually by user for ${input.isPaper ? "Paper" : "Live"} trading.`);

      const openPosList = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.status, "open"),
            eq(positions.isPaper, input.isPaper)
          )
        );

      if (openPosList.length === 0) {
        return { success: true, count: 0 };
      }

      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      for (const pos of openPosList) {
        try {
          if (!pos.isPaper) {
            if (env.placeOrders) {
              const dbCreds = await db.select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);
              const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;
              if (!coindcxCreds) throw new Error("No CoinDCX exchange credentials found");

              const coindcxSide = (pos.side.toLowerCase() === "long" || pos.side.toLowerCase() === "buy") ? "sell" : "buy";
              const coindcxSymbol = pos.symbol.startsWith("B-")
                ? pos.symbol
                : `B-${pos.symbol.replace("USDT", "_USDT")}`;
              await createFuturesOrder(coindcxCreds, {
                market: coindcxSymbol,
                side: coindcxSide,
                order_type: "market",
                total_quantity: parseFloat(pos.size),
                leverage: pos.leverage,
              });
            }
          }

          const markPriceVal = parseFloat(pos.currentPrice);
          const entryPriceVal = parseFloat(pos.entryPrice);
          const sizeVal = parseFloat(pos.size);
          const isLong = pos.side.toLowerCase() === "long" || pos.side.toLowerCase() === "buy";
          const realizedPnl = (isLong ? 1 : -1) * (markPriceVal - entryPriceVal) * sizeVal;

          await db
            .update(positions)
            .set({
              status: "closed",
              realizedPnl: String(realizedPnl),
              unrealizedPnl: "0",
              exitReason: "Panic Close All",
              closedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(positions.id, pos.id));

          if (pos.isPaper) {
            const [cfg] = await db
              .select({ paperCurrency: autoExecutorConfig.paperCurrency })
              .from(autoExecutorConfig)
              .where(eq(autoExecutorConfig.userId, userId))
              .limit(1);
            const paperCurrency = (cfg?.paperCurrency as "USDT" | "INR") ?? "INR";
            const { marginUsdt } = await resolvePaperPositionMargin({
              marginStored: parseFloat(pos.margin),
              marginCurrency: paperCurrency,
              size: sizeVal,
              entryPrice: entryPriceVal,
              leverage: pos.leverage,
            });
            await releasePaperPositionMargin(
              userId,
              marginUsdt,
              realizedPnl,
              pos.id,
              paperCurrency
            );
          }

          try {
            await recordPositionTransaction({
              positionId: pos.id,
              userId,
              symbol: pos.symbol,
              type: "FULL_EXIT",
              side: isLong ? "LONG" : "SHORT",
              quantityBefore: sizeVal,
              quantityAfter: 0,
              quantityDelta: -sizeVal,
              price: markPriceVal,
              avgEntryPrice: entryPriceVal,
              realizedPnl,
              fee: pos.isPaper ? 0 : markPriceVal * sizeVal * 0.0004,
              marginBefore: parseFloat(pos.margin),
              marginAfter: 0,
              metadata: { reason: "Panic Close All" }
            });
          } catch (ledgerErr) {
            console.error("[trading-router] Ledger entry failed:", ledgerErr);
          }

          const session = await getOrCreateSession(userId, 0);
          await updateSession(globalRiskEngine.recordTrade(session, { pnl: realizedPnl }));

          unregisterPosition(pos.id);
          successCount++;
        } catch (err: any) {
          console.error(`[trading-router] Failed to close position #${pos.id}:`, err);
          failCount++;
          errors.push(`${pos.symbol}: ${err.message || String(err)}`);
        }
      }

      tradingEvents.emit(`portfolio-update:${userId}`);

      if (failCount > 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Closed ${successCount} positions. Failed to close ${failCount}: ${errors.join(", ")}`,
        });
      }

      return { success: true, count: successCount };
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

  // ─── Open/pending orders from exchange (limit orders awaiting fill) ───
  openOrders: authedQuery
    .input(z.object({ symbol: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx")))
        .limit(1);
      if (!creds[0]) return [];
      try {
        const params: Record<string, any> = { status: "open" };
        if (input.symbol) {
          params.market = `B-${input.symbol.replace("USDT", "_USDT")}`;
        }
        const orders = await getFuturesOrders(decryptCreds(creds[0]), params);
        return orders.map((o: any) => ({
          id: o.id,
          symbol: o.pair ? o.pair.replace("B-", "").replace("_", "") : (o.market ?? ""),
          coindcxPair: o.pair ?? o.market,
          side: (o.side ?? "buy") as "buy" | "sell",
          orderType: o.order_type ?? "limit_order",
          price: parseFloat(o.price_per_unit ?? o.avg_price ?? "0"),
          quantity: parseFloat(o.total_quantity ?? o.quantity ?? "0"),
          filledQuantity: parseFloat(o.filled_quantity ?? "0"),
          status: o.status,
          createdAt: o.created_at ? new Date(o.created_at) : new Date(),
        }));
      } catch {
        return [];
      }
    }),

  // ─── Paper positions as orders (for unified order panel) ───
  paperOrders: authedQuery
    .input(z.object({ symbol: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [
        eq(positions.userId, ctx.user.id),
        eq(positions.status, "open"),
        eq(positions.isPaper, true),
      ];
      if (input.symbol) conditions.push(eq(positions.symbol, input.symbol));
      const rows = await db.select().from(positions).where(and(...conditions));
      return rows.map((p) => ({
        id: String(p.id),
        symbol: p.symbol,
        coindcxPair: `B-${p.symbol.replace("USDT", "_USDT")}`,
        side: p.side === "long" ? "buy" : "sell",
        orderType: "market_order",
        price: parseFloat(p.entryPrice),
        quantity: parseFloat(p.size),
        filledQuantity: parseFloat(p.size),
        status: "filled",
        createdAt: p.createdAt,
        isPaper: true,
      }));
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
        // Monitor all open positions (paper + live) regardless of trading mode
        db.select()
          .from(positions)
          .where(and(eq(positions.userId, ctx.user.id), eq(positions.status, "open")))
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
