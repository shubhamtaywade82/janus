import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials, futuresWallets } from "@db/schema";
import { desc, eq, and } from "drizzle-orm";
import {
  createFuturesOrder,
  getFuturesPositions,
  getFuturesWallet,
  getFuturesInstrumentInfo,
  calculateLiquidationPrice,
  getCrossMarginDetails,
  walletTransfer,
  addRemoveMargin,
  getFuturesOrders,
  getUsdtInrRate,
  getCurrencyConversions,
  getMarketsDetails,
} from "../services/coindcx";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { tradingEvents, initCoinDCXPrivateWs, userBalancesCache, userPositionsCache, markPriceCache } from "../services/coindcx-ws";
import { startExitMonitor, stopExitMonitor, getFeeBreakevenMap } from "../services/exit-manager";
import { latestTickerCache, subscribeToSymbol } from "../services/streaming";
import { globalRiskEngine, getOrCreateSession, sessions, riskEvents } from "../services/risk-engine";
import { registerPositionForTrailing, unregisterPosition } from "../services/trailing-stop";
import { globalKillSwitch } from "../services/kill-switch";
import { releasePaperMargin } from "../services/paper-wallet";
import { env } from "../lib/env";
import { encrypt, decryptCreds } from "../lib/crypto";

// Wire risk events → tradingEvents so frontend streams pick them up
riskEvents.on("drawdown-limit-hit", ({ userId, drawdownPct }: { userId: number; drawdownPct: number }) => {
  console.error(`[risk] Drawdown limit hit — userId=${userId} drawdown=${(drawdownPct * 100).toFixed(2)}%`);
  tradingEvents.emit(`risk-alert:${userId}`, {
    type: "drawdown_limit",
    message: `Daily loss limit hit: ${(drawdownPct * 100).toFixed(2)}%. Trading suspended.`,
  });
});

riskEvents.on("cooldown-started", ({ userId, consecutiveLosses }: { userId: number; consecutiveLosses: number }) => {
  console.warn(`[risk] Cooldown started — userId=${userId} losses=${consecutiveLosses}`);
  tradingEvents.emit(`risk-alert:${userId}`, {
    type: "cooldown",
    message: `${consecutiveLosses} consecutive losses — 30 minute cooldown active.`,
  });
});

export async function fetchPortfolioData(userId: number) {
  const db = getDb();
  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.userId, userId),
        eq(exchangeCredentials.exchange, "coindcx")
      )
    )
    .limit(1);

  let openPositions: any[] = [];
  let totalRealizedPnl = 0;
  let totalMargin = 0;
  let totalUnrealizedPnl = 0;
  let recentTrades: any[] = [];

  if (creds && creds[0]) {
    try {
      // WS cache is fresher — use it if populated, else REST
      const wsPositions = userPositionsCache.get(userId);
      const [livePositions, usdtInrRate, markets] = await Promise.all([
        wsPositions && wsPositions.length > 0
          ? Promise.resolve(wsPositions)
          : getFuturesPositions(decryptCreds(creds[0])),
        getUsdtInrRate(),
        getMarketsDetails().catch(() => []),
      ]);

      const getPrecisions = (symbol: string) => {
        const cdxPair = `B-${symbol.replace("USDT", "_USDT")}`;
        const m = markets.find((x: any) => x.pair === cdxPair || x.symbol === symbol || x.coindcx_name === symbol);
        return {
          basePrecision: m?.base_currency_precision ?? 2,
          targetPrecision: m?.target_currency_precision ?? 4,
        };
      };

      // Price priority: CoinDCX mark price (exact) > Binance last price (fast fallback)
      // tickerMap keyed by Binance symbol (ETHUSDT)
      const tickerMap = new Map<string, number>();
      // 1. Binance prices as base
      latestTickerCache.forEach((t, sym) => tickerMap.set(sym, t.lastPrice));
      // 2. CoinDCX mark price overrides (more accurate for CoinDCX futures PnL/liquidation)
      markPriceCache.forEach((mp, pair) => {
        const sym = pair.replace("B-", "").replace("_", ""); // B-ETH_USDT → ETHUSDT
        tickerMap.set(sym, mp);
      });

      // Ensure open positions' symbols are subscribed on Binance WS (fallback)
      for (const p of livePositions) {
        if (parseFloat(p.active_pos) !== 0) {
          const binanceSym = (p.pair || "").replace("B-", "").replace("_", "");
          if (binanceSym) subscribeToSymbol(binanceSym);
        }
      }

      openPositions = livePositions
        .filter((p: any) => parseFloat(p.active_pos) !== 0)
        .map((p: any, idx: number) => {
          const sizeVal = parseFloat(p.active_pos);
          const side = sizeVal >= 0 ? "long" : "short";
          const absSize = Math.abs(sizeVal);
          const symbol = p.pair.replace("B-", "").replace("_", "");
          // Real field: margin_currency_short_name (not margin_currency)
          const marginCurrency = p.margin_currency_short_name || p.margin_currency || "USDT";
          const isInrMargin = marginCurrency === "INR";

          // Price priority:
          //   1. p.mark_price  — CoinDCX mark price (what CoinDCX uses for PnL/liquidation)
          //   2. markPriceCache — from CoinDCX private WS (freshest)
          //   3. latestTickerCache — Binance last price (fallback only — can differ from CDX mark price)
          const markPriceFromApi = parseFloat(p.mark_price || "0");
          const markPriceFromWs = markPriceCache.get(p.pair) ?? 0;
          const binanceLastPrice = tickerMap.get(symbol) ?? 0;
          const lastPrice = (markPriceFromApi > 0 ? markPriceFromApi : 0)
            || markPriceFromWs
            || binanceLastPrice
            || parseFloat(p.avg_price);
          const entryPrice = parseFloat(p.avg_price);

          // Exchange PnL (most accurate) → signed-quantity formula fallback
          // signed quantity: long = positive qty, short = negative qty → single formula covers both
          const exchangePnl = parseFloat(p.unrealized_pnl ?? p.unrealised_pnl ?? "");
          const unrealizedPnl = (!isNaN(exchangePnl) && exchangePnl !== 0)
            ? exchangePnl
            : (lastPrice - entryPrice) * sizeVal;

          // Margin is posted in marginCurrency (INR/USDT) — convert to USDT
          const lockedMarginRaw = parseFloat(p.locked_margin || p.locked_user_margin || "0");
          const lockedMarginUsdt = lockedMarginRaw; // Exchange returns locked_margin in USDT
          const displayLockedMargin = isInrMargin ? lockedMarginRaw * usdtInrRate : lockedMarginRaw;

          const maintMarginRaw = parseFloat(p.maintenance_margin || "0");
          const displayMaintMargin = isInrMargin ? maintMarginRaw * usdtInrRate : maintMarginRaw;

          // PnL currency = pair QUOTE currency (B-ETH_USDT → USDT), NOT margin currency
          // INR-margined B-ETH_USDT still has PnL in USDT
          const pairQuote = (p.pair as string).split("_").pop() ?? "USDT";
          const pnlIsInr = pairQuote === "INR";
          const unrealizedPnlUsdt = pnlIsInr ? unrealizedPnl / usdtInrRate : unrealizedPnl;

          // Derived position metrics (all in pair quote currency)
          const posLeverage = Number(p.leverage) || 1;
          const notional = absSize * lastPrice;
          const initialMargin = notional / posLeverage;
          const roe = initialMargin > 0 ? (unrealizedPnl / initialMargin) * 100 : 0;
          const priceChangePct = entryPrice > 0 ? ((lastPrice - entryPrice) / entryPrice) * 100 : 0;
          const liqPriceRaw = parseFloat(p.liquidation_price || "0");
          const liqDistance = liqPriceRaw > 0
            ? (sizeVal >= 0 ? lastPrice - liqPriceRaw : liqPriceRaw - lastPrice)
            : 0;
          const liqDistancePct = lastPrice > 0 && liqPriceRaw > 0
            ? (liqDistance / lastPrice) * 100
            : 0;

          totalMargin += lockedMarginUsdt;
          totalUnrealizedPnl += unrealizedPnlUsdt;

          return {
            id: idx + 10000,
            userId,
            symbol,
            side,
            entryPrice: String(p.avg_price),
            currentPrice: String(lastPrice),
            size: String(absSize),
            leverage: p.leverage,
            margin: String(displayLockedMargin),
            unrealizedPnl: String(unrealizedPnl),
            realizedPnl: "0.00",
            liquidationPrice: p.liquidation_price ? String(p.liquidation_price) : null,
            stopLoss: p.stop_loss_trigger ? String(p.stop_loss_trigger) : null,
            takeProfit: p.take_profit_trigger ? String(p.take_profit_trigger) : null,
            lockedMargin: String(displayLockedMargin),
            maintenanceMargin: p.maintenance_margin ? String(displayMaintMargin) : null,
            lockedOrderMargin: p.locked_order_margin ? String(p.locked_order_margin) : null,
            crossUserMargin: null,
            crossOrderMargin: null,
            // Real field: margin_type (not margin_mode)
            marginMode: p.margin_type || p.margin_mode || "isolated",
            marginCurrency,
            settlementCurrencyConversionPrice: p.settlement_currency_avg_price ? String(p.settlement_currency_avg_price) : null,
            settlementCurrencyAvgPrice: p.settlement_currency_avg_price ? String(p.settlement_currency_avg_price) : null,
            priceInInr: null,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
            // Derived position metrics
            notional: String(notional),
            initialMargin: String(initialMargin),
            roe: String(roe),
            priceChangePct: String(priceChangePct),
            liqDistance: String(liqDistance),
            liqDistancePct: String(liqDistancePct),
            basePrecision: getPrecisions(symbol).basePrecision,
            targetPrecision: getPrecisions(symbol).targetPrecision,
          };
        });

      try {
        const filledOrders = await getFuturesOrders(
          decryptCreds(creds[0]),
          { status: "filled" }
        );
         recentTrades = filledOrders.slice(0, 20).map((o: any) => {
          const symbol = o.pair ? o.pair.replace("B-", "").replace("_", "") : o.market;
          return {
            id: o.id,
            symbol,
            side: o.side,
            price: o.price_per_unit || o.avg_price || "0",
            size: o.total_quantity || o.quantity || "0",
            total: o.total_quantity && o.price_per_unit
              ? String(parseFloat(o.total_quantity) * parseFloat(o.price_per_unit))
              : "0",
            fee: o.fee || "0",
            createdAt: o.created_at ? new Date(o.created_at) : new Date(),
            basePrecision: getPrecisions(symbol).basePrecision,
            targetPrecision: getPrecisions(symbol).targetPrecision,
          };
        });
        totalRealizedPnl = filledOrders.reduce(
          (sum: number, o: any) => sum + parseFloat(o.fee || "0") * -1,
          0
        );
      } catch {
        recentTrades = [];
        totalRealizedPnl = 0;
      }

      let walletUsdt = 0;
      let availableInr = 0;
      let lockedInr = 0;
      let walletCurrency = "USDT";

      try {
        const wallets = await getFuturesWallet(decryptCreds(creds[0]));
        for (const w of wallets) {
          const currency = w.currency_short_name || "";
          const free = parseFloat(w.balance || "0");
          const locked = parseFloat(w.locked_balance || "0");
          const total = free + locked;
          if (currency === "USDT") {
            walletUsdt += total;
            availableInr += free;   // in USDT here but reused field
            lockedInr += locked;
            walletCurrency = "USDT";
            // Use exchange's authoritative realized_pnl when the field is present and parseable
            // (including 0 = break-even) — do NOT fall back to fee-derived value when exchange says 0
            if (w.realized_pnl != null && w.realized_pnl !== "") {
              const wRpnl = parseFloat(w.realized_pnl);
              if (!isNaN(wRpnl)) totalRealizedPnl = wRpnl;
            }
          } else if (currency === "INR") {
            walletUsdt += total / usdtInrRate;
            availableInr += free;
            lockedInr += locked;
            walletCurrency = "INR";
            if (w.realized_pnl != null && w.realized_pnl !== "") {
              const wRpnl = parseFloat(w.realized_pnl);
              if (!isNaN(wRpnl)) totalRealizedPnl = wRpnl / usdtInrRate;
            }
          }
        }
      } catch {
        // Fallback 1: WS in-memory cache (futures balance-update events)
        const cachedBalances = userBalancesCache.get(userId);
        if (cachedBalances && cachedBalances.length > 0) {
          for (const b of cachedBalances) {
            const currency = (b.currency_short_name || b.currency || "").toUpperCase();
            const total = parseFloat(b.balance || "0") + parseFloat(b.locked_balance || "0");
            if (currency === "USDT") { walletUsdt += total; availableInr += parseFloat(b.balance || "0"); lockedInr += parseFloat(b.locked_balance || "0"); walletCurrency = "USDT"; }
            else if (currency === "INR") { walletUsdt += total / usdtInrRate; availableInr += parseFloat(b.balance || "0"); lockedInr += parseFloat(b.locked_balance || "0"); walletCurrency = "INR"; }
          }
        } else {
          // Fallback 2: DB persisted futures wallet
          try {
            const dbWallets = await db.select().from(futuresWallets)
              .where(and(eq(futuresWallets.userId, userId), eq(futuresWallets.exchange, "coindcx")));
            for (const w of dbWallets) {
              const total = parseFloat(w.balance || "0") + parseFloat(w.lockedBalance || "0");
              if (w.marginCurrency === "USDT") { walletUsdt += total; walletCurrency = "USDT"; }
              else if (w.marginCurrency === "INR") { walletUsdt += total / usdtInrRate; walletCurrency = "INR"; }
            }
          } catch {}
        }
      }

      // Always merge paper positions from DB alongside live exchange positions
      const paperPositions = await db
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "open"), eq(positions.isPaper, true)));

      const paperMapped = paperPositions.map((p) => ({
        ...p,
        isPaper: true as const,
        entryPrice: p.entryPrice,
        currentPrice: latestTickerCache.get(p.symbol)?.lastPrice?.toString() ?? p.currentPrice,
        unrealizedPnl: p.unrealizedPnl,
        margin: p.margin,
        basePrecision: getPrecisions(p.symbol).basePrecision,
        targetPrecision: getPrecisions(p.symbol).targetPrecision,
      }));

      const allPositions = [
        ...openPositions.map((p) => ({ ...p, isPaper: false as const })),
        ...paperMapped,
      ];

      return {
        openPositionsCount: allPositions.length,
        livePositionsCount: openPositions.length,
        paperPositionsCount: paperMapped.length,
        totalUnrealizedPnl: totalUnrealizedPnl.toFixed(4),
        totalRealizedPnl: totalRealizedPnl.toFixed(4),
        totalMargin: totalMargin.toFixed(4),
        walletUsdt: walletUsdt.toFixed(4),
        walletCurrency,
        availableInr: availableInr.toFixed(4),
        lockedInr: lockedInr.toFixed(4),
        usdtInrRate: usdtInrRate.toFixed(4),
        totalEquity: walletUsdt + totalUnrealizedPnl,
        positions: allPositions,
        recentTrades,
      };
    } catch (err) {
      console.error("[trading-router] Failed to fetch live portfolio details from CoinDCX, falling back to local DB:", err);
    }
  }

  const localPositions = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.userId, userId),
        eq(positions.status, "open")
      )
    );

  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(100);

  const localUnrealizedPnl = localPositions.reduce(
    (sum, p) => sum + parseFloat(p.unrealizedPnl || "0"),
    0
  );
  const localRealizedPnl = allTrades.reduce(
    (sum, t) => sum + parseFloat(t.fee || "0") * -1,
    0
  );
  const localMargin = localPositions.reduce(
    (sum, p) => sum + parseFloat(p.margin || "0"),
    0
  );

  const getLocalPrecisions = (symbol: string) => {
    const defaults: Record<string, { base: number, target: number }> = {
      BTCUSDT: { base: 2, target: 4 },
      ETHUSDT: { base: 2, target: 4 },
      SOLUSDT: { base: 2, target: 3 },
      BNBUSDT: { base: 2, target: 3 },
      XRPUSDT: { base: 4, target: 1 },
      ADAUSDT: { base: 4, target: 1 },
      DOGEUSDT: { base: 5, target: 0 },
      AVAXUSDT: { base: 2, target: 2 },
    };
    const cleanSym = symbol.replace("B-", "").replace("_", "");
    const d = defaults[cleanSym] ?? { base: 2, target: 4 };
    return { basePrecision: d.base, targetPrecision: d.target };
  };

  const positionsMapped = localPositions.map((p) => {
    const prec = getLocalPrecisions(p.symbol);
    return {
      ...p,
      basePrecision: prec.basePrecision,
      targetPrecision: prec.targetPrecision,
    };
  });

  const tradesMapped = allTrades.slice(0, 20).map((t) => {
    const prec = getLocalPrecisions(t.symbol);
    return {
      ...t,
      basePrecision: prec.basePrecision,
      targetPrecision: prec.targetPrecision,
    };
  });

  return {
    openPositionsCount: localPositions.length,
    totalUnrealizedPnl: localUnrealizedPnl.toFixed(4),
    totalRealizedPnl: localRealizedPnl.toFixed(4),
    totalMargin: localMargin.toFixed(4),
    totalEquity: localMargin + localUnrealizedPnl,
    positions: positionsMapped,
    recentTrades: tradesMapped,
  };
}

export const tradingRouter = createRouter({
  // ─── Get all positions ───
  positions: authedQuery
    .input(
      z.object({
        userId: z.number().optional(),
        status: z.enum(["open", "closed", "liquidated"]).optional(),
        symbol: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user.id;

      // Check if user has saved credentials for CoinDCX
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, userId),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);

      if (creds && creds[0] && input.status === "open") {
        try {
          // Fetch live CoinDCX futures positions
          const [livePositions, usdtInrRate] = await Promise.all([
            getFuturesPositions(decryptCreds(creds[0])),
            getUsdtInrRate(),
          ]);

          const tickerMap = new Map<string, number>();
          latestTickerCache.forEach((t, sym) => tickerMap.set(sym, t.lastPrice));
          markPriceCache.forEach((mp, pair) => tickerMap.set(pair.replace("B-", "").replace("_", ""), mp));

          // Map positions to DB schema format
          const mapped = livePositions
            .filter((p: any) => parseFloat(p.active_pos) !== 0)
            .map((p: any, idx: number) => {
              const sizeVal = parseFloat(p.active_pos);
              const side = sizeVal >= 0 ? "long" : "short";
              const absSize = Math.abs(sizeVal);
              const symbol = p.pair.replace("B-", "").replace("_", "");
              const marginCurrency = p.margin_currency_short_name || p.margin_currency || "USDT";
              const isInrMargin = marginCurrency === "INR";

              const markPriceFromApi2 = parseFloat(p.mark_price || "0");
              const markPriceFromWs2 = markPriceCache.get(p.pair) ?? 0;
              const lastPrice = (markPriceFromApi2 > 0 ? markPriceFromApi2 : 0)
                || markPriceFromWs2
                || tickerMap.get(symbol)
                || parseFloat(p.avg_price);
              const entryPrice = parseFloat(p.avg_price);

              // Exchange PnL → signed-quantity formula fallback
              const exchangePnl2 = parseFloat(p.unrealized_pnl ?? p.unrealised_pnl ?? "");
              const unrealizedPnl = (!isNaN(exchangePnl2) && exchangePnl2 !== 0)
                ? exchangePnl2
                : (lastPrice - entryPrice) * sizeVal;

              const lockedMarginRaw = parseFloat(p.locked_margin || p.locked_user_margin || "0");
              const displayLockedMargin = isInrMargin ? lockedMarginRaw * usdtInrRate : lockedMarginRaw;

              // Derived position metrics
              const posLeverage2 = Number(p.leverage) || 1;
              const notional2 = absSize * lastPrice;
              const initialMargin2 = notional2 / posLeverage2;
              const roe2 = initialMargin2 > 0 ? (unrealizedPnl / initialMargin2) * 100 : 0;
              const priceChangePct2 = entryPrice > 0 ? ((lastPrice - entryPrice) / entryPrice) * 100 : 0;
              const liqPriceRaw2 = parseFloat(p.liquidation_price || "0");
              const liqDistance2 = liqPriceRaw2 > 0
                ? (sizeVal >= 0 ? lastPrice - liqPriceRaw2 : liqPriceRaw2 - lastPrice)
                : 0;
              const liqDistancePct2 = lastPrice > 0 && liqPriceRaw2 > 0
                ? (liqDistance2 / lastPrice) * 100
                : 0;

              return {
                id: idx + 10000,
                userId,
                symbol,
                side,
                entryPrice: String(p.avg_price),
                currentPrice: String(lastPrice),
                size: String(absSize),
                leverage: p.leverage,
                margin: String(displayLockedMargin),
                unrealizedPnl: String(unrealizedPnl),
                realizedPnl: "0.00",
                liquidationPrice: p.liquidation_price ? String(p.liquidation_price) : null,
                stopLoss: p.stop_loss_trigger ? String(p.stop_loss_trigger) : null,
                takeProfit: p.take_profit_trigger ? String(p.take_profit_trigger) : null,
                marginMode: p.margin_type || p.margin_mode || "isolated",
                marginCurrency,
                status: "open",
                createdAt: new Date(),
                updatedAt: new Date(),
                // Derived position metrics
                notional: String(notional2),
                initialMargin: String(initialMargin2),
                roe: String(roe2),
                priceChangePct: String(priceChangePct2),
                liqDistance: String(liqDistance2),
                liqDistancePct: String(liqDistancePct2),
              };
            });

          // Always append paper DB positions — live API only returns exchange positions
          const paperDbPositions = await db
            .select()
            .from(positions)
            .where(and(
              eq(positions.userId, userId),
              eq(positions.status, "open"),
              eq(positions.isPaper, true)
            ))
            .orderBy(desc(positions.createdAt));

          return [
            ...mapped.map((p) => ({ ...p, isPaper: false })),
            ...paperDbPositions,
          ];
        } catch (err) {
          console.error("[trading-router] Failed to fetch live positions from CoinDCX, falling back to local DB:", err);
        }
      }

      const conditions = [];
      if (input.userId) conditions.push(eq(positions.userId, input.userId));
      if (input.status) conditions.push(eq(positions.status, input.status));
      if (input.symbol) conditions.push(eq(positions.symbol, input.symbol));

      const query = db.select().from(positions).orderBy(desc(positions.createdAt));
      if (conditions.length > 0) {
        return query.where(and(...conditions));
      }
      return query;
    }),

  // ─── Get position by ID ───
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

  // ─── Create a new position (simulated/live) ───
  createPosition: authedQuery
    .input(
      z.object({
        userId: z.number().optional(),
        symbol: z.string(),
        side: z.enum(["long", "short"]),
        entryPrice: z.string(),
        currentPrice: z.string(),
        size: z.string(),
        leverage: z.number().min(1).max(125).default(1),
        margin: z.string(),
        liquidationPrice: z.string().optional(),
        stopLoss: z.string().optional(),
        takeProfit: z.string().optional(),
        signalId: z.number().optional(),
        strategyType: z.enum(["scalping", "intraday", "swing", "grid", "momentum_reversal", "bb_reversion", "ml_sizing", "scalping_micro"]).default("intraday"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = getDb();

      // 0. Kill switch — block all new positions if halt is active
      if (!globalKillSwitch.canTrade()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Trading halted: ${globalKillSwitch.state?.reason ?? "kill switch active"}`,
        });
      }

      // 1. Leverage Cap check (10x maximum)
      if (input.leverage > 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Leverage exceeds maximum allowed safety cap of 10x.",
        });
      }

      // 1b. Risk Engine gate — capital %, daily drawdown, cooldown, margin health
      {
        let walletBalance = 0;
        let usedMargin = 0;
        const riskCreds = await db
          .select()
          .from(exchangeCredentials)
          .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx")))
          .limit(1);

        if (riskCreds[0]) {
          try {
            const wallets = await getFuturesWallet({ apiKey: riskCreds[0].apiKey, apiSecret: riskCreds[0].apiSecret });
            for (const w of wallets) {
              walletBalance += parseFloat(w.balance || "0");
              usedMargin += parseFloat(w.locked_balance || "0");
            }
          } catch { /* non-fatal — use 0 as fallback */ }
        }

        const session = getOrCreateSession(userId, walletBalance || 10_000);
        const notional = parseFloat(input.entryPrice) * parseFloat(input.size);
        const riskDecision = globalRiskEngine.checkTradeAllowed(session, {
          notional,
          walletBalance: walletBalance || session.startingBalance,
          usedMargin,
        });

        if (!riskDecision.approved) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Risk check failed: ${riskDecision.reason}`,
          });
        }
      }

      // 2. Stop-Loss & Liquidation Price distance buffer check
      if (input.stopLoss) {
        const entry = parseFloat(input.entryPrice);
        const stop = parseFloat(input.stopLoss);
        const size = parseFloat(input.size);
        const margin = parseFloat(input.margin);
        
        const liq = input.liquidationPrice 
          ? parseFloat(input.liquidationPrice) 
          : calculateLiquidationPrice(entry, margin, size, input.side, input.leverage);

        const distLiq = Math.abs(entry - liq);
        const distStop = Math.abs(entry - stop);

        if (distLiq < 2 * distStop) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Risk buffer violation: Projected liquidation price distance must be at least twice the distance of the stop loss price relative to entry price.",
          });
        }
      }

      // Check if user has saved CoinDCX credentials for live execution
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, userId),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);

      let exchangeOrderId: string | undefined = undefined;

      if (creds && creds[0] && env.placeOrders) {
        try {
          // Format symbol from BTCUSDT -> B-BTC_USDT
          let coindcxSymbol = input.symbol;
          if (!coindcxSymbol.startsWith("B-")) {
            coindcxSymbol = `B-${input.symbol.replace("USDT", "_USDT")}`;
          }

          console.log(`[coindcx-execution] Attempting live order for ${coindcxSymbol} (${input.side})`);
          const orderRes = await createFuturesOrder(
            decryptCreds(creds[0]),
            {
              market: coindcxSymbol,
              side: input.side === "long" ? "buy" : "sell",
              order_type: "market",
              total_quantity: parseFloat(input.size),
              price: parseFloat(input.entryPrice),
              leverage: input.leverage,
            }
          );

          if (orderRes && orderRes.id) {
            exchangeOrderId = orderRes.id;
            console.log(`[coindcx-execution] Live order succeeded. Order ID: ${exchangeOrderId}`);
          }
        } catch (err: any) {
          console.error("[coindcx-execution] Failed live execution:", err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Live exchange order execution failed: ${err.message || err}`,
          });
        }
      } else if (creds && creds[0] && !env.placeOrders) {
        console.warn(`[coindcx-execution] BLOCKED — PLACE_ORDERS=false. Set PLACE_ORDERS=true in .env to enable live trading.`);
      }

      // Check for existing open paper position for same instrument and side
      const existingPaperPos = await db.select().from(positions).where(
        and(
          eq(positions.userId, userId),
          eq(positions.symbol, input.symbol),
          eq(positions.side, input.side),
          eq(positions.isPaper, true),
          eq(positions.status, "open")
        )
      ).limit(1);

      let resultId: number;
      if (existingPaperPos.length > 0) {
        const existing = existingPaperPos[0];
        const newSize = (parseFloat(existing.size) || 0) + parseFloat(input.size);
        const newMargin = (parseFloat(existing.margin) || 0) + parseFloat(input.margin);
        const weightedEntry = ((parseFloat(existing.entryPrice) || 0) * (parseFloat(existing.size) || 0) +
          parseFloat(input.entryPrice) * parseFloat(input.size)) / newSize;
        await db.update(positions).set({
          size: String(newSize),
          margin: String(newMargin),
          entryPrice: String(weightedEntry),
          ...(input.stopLoss && { stopLoss: input.stopLoss }),
          ...(input.takeProfit && { takeProfit: input.takeProfit }),
          updatedAt: new Date(),
        }).where(eq(positions.id, existing.id));
        resultId = existing.id;
        tradingEvents.emit(`portfolio-update:${userId}`);
        if (input.stopLoss) {
          registerPositionForTrailing({
            id: resultId,
            symbol: input.symbol,
            side: input.side,
            entryPrice: weightedEntry,
            stopLoss: parseFloat(input.stopLoss),
            strategyType: input.strategyType as import("../services/strategy-config").StrategyType,
            userId,
          });
        }
      } else {
        const result = await db.insert(positions).values({
          userId,
          symbol: input.symbol,
          side: input.side,
          entryPrice: input.entryPrice,
          currentPrice: input.currentPrice,
          size: input.size,
          leverage: input.leverage,
          margin: input.margin,
          liquidationPrice: input.liquidationPrice,
          stopLoss: input.stopLoss,
          takeProfit: input.takeProfit,
          signalId: input.signalId,
          strategyType: input.strategyType,
          unrealizedPnl: "0",
          realizedPnl: "0",
          status: "open",
          exchangeOrderId,
          isPaper: !exchangeOrderId,
        }).returning({ id: positions.id });
        resultId = result[0].id;
        tradingEvents.emit(`portfolio-update:${userId}`);
        if (input.stopLoss) {
          registerPositionForTrailing({
            id: resultId,
            symbol: input.symbol,
            side: input.side,
            entryPrice: parseFloat(input.entryPrice),
            stopLoss: parseFloat(input.stopLoss),
            strategyType: input.strategyType as import("../services/strategy-config").StrategyType,
            userId,
          });
        }
      }

      return { id: resultId, ...input, userId, exchangeOrderId };
    }),

  // ─── Close a position ───
  closePosition: authedQuery
    .input(
      z.object({
        id: z.number(),
        closePrice: z.string(),
        realizedPnl: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const pos = await db.select().from(positions).where(eq(positions.id, input.id)).limit(1);
      if (!pos[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });

      const userId = pos[0].userId;
      if (userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot close another user's position" });
      }

      await db
        .update(positions)
        .set({
          status: "closed",
          currentPrice: input.closePrice,
          realizedPnl: input.realizedPnl,
          unrealizedPnl: "0",
          exitReason: "Manual Close via UI",
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(positions.id, input.id));

      if (pos[0].isPaper) {
        await releasePaperMargin(userId, parseFloat(pos[0].margin), parseFloat(input.realizedPnl), pos[0].id);
      }

      // Update risk session so circuit breakers fire correctly
      const pnl = parseFloat(input.realizedPnl);
      const session = getOrCreateSession(userId, 0);
      const updatedSession = globalRiskEngine.recordTrade(session, { pnl });
      sessions.set(userId, updatedSession);

      unregisterPosition(input.id);
      tradingEvents.emit(`portfolio-update:${userId}`);

      return { success: true };
    }),

  // ─── Update position PnL ───
  updatePositionPnl: authedQuery
    .input(
      z.object({
        id: z.number(),
        currentPrice: z.string(),
        unrealizedPnl: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(positions)
        .set({
          currentPrice: input.currentPrice,
          unrealizedPnl: input.unrealizedPnl,
          updatedAt: new Date(),
        })
        .where(eq(positions.id, input.id));
      return { success: true };
    }),

  // ─── Get trade history ───
  trades: authedQuery
    .input(
      z.object({
        symbol: z.string().optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user.id;
      const conditions = [eq(trades.userId, userId)];
      if (input.symbol) conditions.push(eq(trades.symbol, input.symbol));

      const query = db
        .select()
        .from(trades)
        .orderBy(desc(trades.createdAt))
        .limit(input.limit);
      return query.where(and(...conditions));
    }),

  // ─── Record a trade ───
  recordTrade: authedQuery
    .input(
      z.object({
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        orderType: z.enum(["market", "limit", "stop"]).default("market"),
        price: z.string(),
        size: z.string(),
        leverage: z.number().default(1),
        fee: z.string().default("0"),
        total: z.string(),
        positionId: z.number().optional(),
        clientOrderId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const priceVal = parseFloat(input.price) || 0;
      const sizeVal = parseFloat(input.size) || 0;
      const isSell = input.side === "sell";
      const tdsVal = isSell ? priceVal * sizeVal * 0.01 : 0;
      const tdsDeducted = tdsVal.toFixed(8);

      const result = await db.insert(trades).values({
        userId: ctx.user.id,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        price: input.price,
        size: input.size,
        leverage: input.leverage,
        fee: input.fee,
        tdsDeducted: tdsDeducted,
        total: input.total,
        positionId: input.positionId,
        clientOrderId: input.clientOrderId,
        status: "filled",
        executedAt: new Date(),
      }).returning({ id: trades.id });
      return { id: result[0].id, ...input, tdsDeducted };
    }),

  // ─── Fee breakeven map — min price move needed to cover entry+exit fees per symbol ───
  feeBreakevenMap: authedQuery
    .input(
      z.object({
        takerFeeRate: z.number().min(0).max(0.01).default(0.0005),
      })
    )
    .query(({ input }) => {
      return getFeeBreakevenMap(input.takerFeeRate);
    }),

  // ─── Risk session status ───
  riskStatus: authedQuery
    .query(({ ctx }) => {
      const session = sessions.get(ctx.user.id);
      if (!session) return null;
      const drawdownPct =
        session.startingBalance > 0
          ? Math.abs(Math.min(0, session.realizedPnl)) / session.startingBalance * 100
          : 0;
      return {
        ...session,
        drawdownPct,
        drawdownLimit: globalRiskEngine.config.dailyDrawdownPct * 100,
        maxPositionPct: globalRiskEngine.config.maxPositionPct * 100,
        marginHealthHaltPct: globalRiskEngine.config.marginHealthHaltPct * 100,
      };
    }),

  // ─── Risk alert stream — fires on drawdown/cooldown events ───
  riskAlertStream: authedQuery
    .subscription(({ ctx }) => {
      return observable((emit) => {
        const handler = (payload: unknown) => emit.next(payload);
        tradingEvents.on(`risk-alert:${ctx.user.id}`, handler);
        return () => tradingEvents.off(`risk-alert:${ctx.user.id}`, handler);
      });
    }),

  // ─── Get portfolio summary ───
  portfolio: authedQuery
    .query(async ({ ctx }) => {
      return fetchPortfolioData(ctx.user.id);
    }),

  // ─── USDT/INR Currency Conversion Rate ───
  currencyConversion: authedQuery
    .query(async () => {
      const conversions = await getCurrencyConversions();
      return conversions[0] ?? { symbol: "USDTINR", conversion_price: 89.0 };
    }),

  // ─── Portfolio Subscription Stream ───
  portfolioStream: authedQuery
    .subscription(({ ctx }) => {
      return observable((emit) => {
        let closed = false;

        const onUpdate = async () => {
          try {
            const data = await fetchPortfolioData(ctx.user.id);
            if (!closed) emit.next(data);
          } catch (e) {
            if (!closed) {
              console.error("[trading-router] Stream fetch portfolio failed:", e);
            }
          }
        };

        // Listen for internal portfolio updates
        tradingEvents.on(`portfolio-update:${ctx.user.id}`, onUpdate);

        // Also refresh periodically every 5 seconds (heartbeat/sync fallback)
        const interval = setInterval(onUpdate, 5000);

        // Push initial data
        onUpdate();

        return () => {
          closed = true;
          tradingEvents.off(`portfolio-update:${ctx.user.id}`, onUpdate);
          clearInterval(interval);
        };
      });
    }),

  // ─── Exit Signal Stream — fires when fee-adjusted PnL > 0 on an open position ───
  exitSignalStream: authedQuery
    .subscription(({ ctx }) => {
      return observable((emit) => {
        const onExitSignal = (payload: unknown) => {
          emit.next(payload);
        };

        tradingEvents.on(`exit-signal:${ctx.user.id}`, onExitSignal);

        const refreshMonitor = () => {
          const db = getDb();
          const isPaperMode = env.paperTrading || !env.placeOrders;
          db.select()
            .from(positions)
            .where(and(
              eq(positions.userId, ctx.user.id),
              eq(positions.status, "open"),
              eq(positions.isPaper, isPaperMode)
            ))
            .then((openPositions) => {
              const monitored = openPositions.map((p) => ({
                id: p.id,
                symbol: p.symbol,
                side: p.side,
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

        // Start initial monitoring
        refreshMonitor();

        // Refresh monitoring when positions open or close
        tradingEvents.on(`portfolio-update:${ctx.user.id}`, refreshMonitor);

        return () => {
          tradingEvents.off(`exit-signal:${ctx.user.id}`, onExitSignal);
          tradingEvents.off(`portfolio-update:${ctx.user.id}`, refreshMonitor);
          stopExitMonitor(ctx.user.id);
        };
      });
    }),

  // ─── Save exchange credentials ───
  saveCredentials: authedQuery
    .input(
      z.object({
        exchange: z.enum(["coindcx", "binance"]),
        apiKey: z.string(),
        apiSecret: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = getDb();
      await db.insert(exchangeCredentials).values({
        userId,
        exchange: input.exchange,
        apiKey: encrypt(input.apiKey),
        apiSecret: encrypt(input.apiSecret),
      });
      if (input.exchange === "coindcx") {
        initCoinDCXPrivateWs().catch((err) => {
          console.error("[coindcx-ws] Failed to initialize private WS on credential update:", err);
        });
      }
      return { success: true };
    }),

  // ─── Get exchange credentials ───
  credentials: authedQuery
    .query(async ({ ctx }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(exchangeCredentials)
        .where(eq(exchangeCredentials.userId, ctx.user.id));
      // Mask API secret — never send the raw secret to the client
      return rows.map((r) => ({ ...r, apiSecret: r.apiSecret ? "••••••••" : "" }));
    }),

  // ─── Get futures wallet (with derived metrics) ───
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

      // Derived metrics
      const walletBalance = balance + lockedBalance;
      const equity = walletBalance + unrealizedPnl;
      const usedMargin = crossUserMargin + crossOrderMargin;
      const freeMargin = Math.max(0, equity - usedMargin);
      const marginUtilization = equity > 0 ? usedMargin / equity : 0;
      const buyingPower = freeMargin * 10;
      const maintenanceMargin = parseFloat(w.maintenanceMargin);
      const marginBuffer = Math.max(0, equity - maintenanceMargin);
      const marginBufferPct = equity > 0 ? marginBuffer / equity : 1;

      return {
        ...w,
        // Computed fields
        walletBalance,
        equity,
        usedMargin,
        freeMargin,
        marginUtilization,
        buyingPower,
        marginBuffer,
        marginBufferPct,
      };
    }),

  // ─── Get cross margin details (live from CoinDCX) ───
  crossMarginDetails: authedQuery
    .query(async ({ ctx }) => {
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, ctx.user.id),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);
      if (!creds || !creds[0]) return null;
      return getCrossMarginDetails(decryptCreds(creds[0]));
    }),

  // ─── Wallet transfer (Spot <-> Futures) ───
  walletTransfer: authedQuery
    .input(
      z.object({
        currencyShortName: z.string(),
        amount: z.number().positive(),
        fromWallet: z.enum(["spot", "futures"]),
        toWallet: z.enum(["spot", "futures"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx")))
        .limit(1);
      if (!creds || !creds[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "CoinDCX credentials not found" });
      }
      const result = await walletTransfer(
        decryptCreds(creds[0]),
        {
          currency_short_name: input.currencyShortName,
          amount: input.amount,
          from_wallet: input.fromWallet,
          to_wallet: input.toWallet,
        }
      );
      tradingEvents.emit(`portfolio-update:${userId}`);
      return result;
    }),

  // ─── Add / Remove margin ───
  addRemoveMargin: authedQuery
    .input(
      z.object({
        positionId: z.string(),
        amount: z.number().positive(),
        type: z.enum(["add", "remove"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx")))
        .limit(1);
      if (!creds || !creds[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "CoinDCX credentials not found" });
      }
      const result = await addRemoveMargin(
        decryptCreds(creds[0]),
        {
          position_id: input.positionId,
          amount: input.amount,
          type: input.type,
        }
      );
      tradingEvents.emit(`portfolio-update:${userId}`);
      return result;
    }),

  // ─── List futures orders ───
  futuresOrders: authedQuery
    .input(
      z.object({
        status: z.enum(["open", "closed", "cancelled"]).optional(),
        marginCurrency: z.enum(["USDT", "INR"]).optional(),
        market: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const creds = await db
        .select()
        .from(exchangeCredentials)
        .where(
          and(
            eq(exchangeCredentials.userId, ctx.user.id),
            eq(exchangeCredentials.exchange, "coindcx")
          )
        )
        .limit(1);
      if (!creds || !creds[0]) return [];
      return getFuturesOrders(
        decryptCreds(creds[0]),
        {
          status: input.status,
          margin_currency_short_name: input.marginCurrency ? [input.marginCurrency] : undefined,
          market: input.market,
        }
      );
    }),

  // ─── Instrument info + user context for trading sidebar ───
  instrumentInfo: authedQuery
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [instrument, creds] = await Promise.all([
        getFuturesInstrumentInfo(input.symbol).catch(() => null),
        db.select().from(exchangeCredentials)
          .where(and(eq(exchangeCredentials.userId, ctx.user.id), eq(exchangeCredentials.exchange, "coindcx")))
          .limit(1),
      ]);

      // Available futures wallet balance
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
          const positions = await getFuturesPositions(decryptCreds(creds[0]));
          const coindcxPair = `B-${input.symbol.replace("USDT", "_USDT")}`;
          const pos = positions.find((p: any) => p.pair === coindcxPair && parseFloat(p.active_pos) !== 0);
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
});
