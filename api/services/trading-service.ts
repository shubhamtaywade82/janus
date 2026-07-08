import { getDb } from "../queries/connection";
import { positions, trades, exchangeCredentials, futuresWallets } from "@db/schema";
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
import { env, coinDCXEnvCreds } from "../lib/env";
import { globalKillSwitch } from "./kill-switch";
import { TRPCError } from "@trpc/server";
import { MIN_SYSTEM_LEVERAGE, MAX_SYSTEM_LEVERAGE } from "../../contracts/constants";
import {
  computeMarginUsdt,
  paperMarginStoredToWalletSync,
  paperMarginStoredToUsdtSync,
} from "./paper-currency";

export function mapPaperPosition(p: any, markets: any[] = [], usdtInrRate = 99) {
  const symbol = p.symbol.startsWith("B-")
    ? p.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
    : p.symbol;

  const tickerMap = new Map<string, number>();
  latestTickerCache.forEach((t, sym) => tickerMap.set(sym, t.lastPrice));
  markPriceCache.forEach((mp, pair) => tickerMap.set(pair.replace("B-", "").replace("_", ""), mp));

  const lastPrice = tickerMap.get(symbol) ?? parseFloat(p.currentPrice || p.entryPrice);
  const entryPrice = parseFloat(p.entryPrice);
  const sizeVal = parseFloat(p.size);
  const side = p.side;

  const unrealizedPnl = side === "long"
    ? (lastPrice - entryPrice) * sizeVal
    : (entryPrice - lastPrice) * sizeVal;

  const posLeverage = Number(p.leverage) || 1;
  const notional = sizeVal * lastPrice;
  const initialMargin = computeMarginUsdt(sizeVal, entryPrice, posLeverage);
  const marginCurrency = (p.marginCurrency || "USDT") as "USDT" | "INR";
  const marginStored = parseFloat(p.margin) || initialMargin;
  const marginVal = paperMarginStoredToWalletSync(
    marginStored,
    marginCurrency,
    initialMargin,
    usdtInrRate
  );
  const marginUsdt = paperMarginStoredToUsdtSync(
    marginStored,
    marginCurrency,
    initialMargin,
    usdtInrRate
  );

  const roe = marginUsdt > 0 ? (unrealizedPnl / marginUsdt) * 100 : 0;
  const priceChangePct = entryPrice > 0 ? ((lastPrice - entryPrice) / entryPrice) * 100 : 0;

  const liqPriceRaw = parseFloat(p.liquidationPrice || "0");
  const liqDistance = liqPriceRaw > 0
    ? (side === "long" ? lastPrice - liqPriceRaw : liqPriceRaw - lastPrice)
    : 0;
  const liqDistancePct = lastPrice > 0 && liqPriceRaw > 0
    ? (liqDistance / lastPrice) * 100
    : 0;

  const cdxPair = `B-${symbol.replace("USDT", "_USDT")}`;
  const m = markets.find((x: any) => x.pair === cdxPair || x.symbol === symbol || x.coindcx_name === symbol);
  const basePrecision = m?.base_currency_precision ?? 2;
  const targetPrecision = m?.target_currency_precision ?? 4;

  return {
    id: p.id,
    userId: p.userId,
    symbol,
    side,
    entryPrice: String(p.entryPrice),
    currentPrice: String(lastPrice),
    size: String(sizeVal),
    leverage: p.leverage,
    margin: String(marginVal),
    unrealizedPnl: String(unrealizedPnl),
    realizedPnl: String(p.realizedPnl || "0.00"),
    liquidationPrice: p.liquidationPrice ? String(p.liquidationPrice) : null,
    stopLoss: p.stopLoss ? String(p.stopLoss) : null,
    takeProfit: p.takeProfit ? String(p.takeProfit) : null,
    marginMode: p.marginMode || "isolated",
    marginCurrency,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    isPaper: true as const,
    notional: String(notional),
    initialMargin: String(marginUsdt),
    roe: String(roe),
    priceChangePct: String(priceChangePct),
    liqDistance: String(liqDistance),
    liqDistancePct: String(liqDistancePct),
    basePrecision,
    targetPrecision,
    entryReason: p.entryReason,
    exitReason: p.exitReason,
  };
}

export async function fetchPortfolioData(userId: number) {
  const db = getDb();
  const dbCreds = await db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.userId, userId),
        eq(exchangeCredentials.exchange, "coindcx")
      )
    )
    .limit(1);

  // Fallback to env credentials when DB has no stored credentials
  const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;

  let openPositions: any[] = [];
  let totalRealizedPnl = 0;
  let totalRealizedPnlGross = 0;
  let totalMargin = 0;
  let totalUnrealizedPnl = 0;
  let recentTrades: any[] = [];
  const usdtInrRate = await getUsdtInrRate().catch(() => 89);
  const markets = await getMarketsDetails().catch(() => []);

  if (coindcxCreds) {
    try {
      // Fetch live positions independently — failures here should not kill wallet/order data
      let livePositions: any[] = [];
      try {
        const wsPositions = userPositionsCache.get(userId);
        livePositions = wsPositions && wsPositions.length > 0
          ? wsPositions
          : await getFuturesPositions(coindcxCreds);
      } catch (err) {
        console.warn("[trading-service] Failed to fetch live positions from CoinDCX:", err);
      }

      const getPrecisions = (symbol: string) => {
        const cdxPair = `B-${symbol.replace("USDT", "_USDT")}`;
        const m = markets.find((x: any) => x.pair === cdxPair || x.symbol === symbol || x.coindcx_name === symbol);
        return {
          basePrecision: m?.base_currency_precision ?? 2,
          targetPrecision: m?.target_currency_precision ?? 4,
        };
      };

      const tickerMap = new Map<string, number>();
      latestTickerCache.forEach((t, sym) => tickerMap.set(sym, t.lastPrice));
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
          const marginCurrency = p.margin_currency_short_name || p.margin_currency || "USDT";
          const isInrMargin = marginCurrency === "INR";

          const markPriceFromApi = parseFloat(p.mark_price || "0");
          const markPriceFromWs = markPriceCache.get(p.pair) ?? 0;
          const binanceLastPrice = tickerMap.get(symbol) ?? 0;
          const avgPrice = parseFloat(p.avg_price || "0");
          const lastPrice = (markPriceFromApi > 0 && !isNaN(markPriceFromApi) ? markPriceFromApi : null)
            || (markPriceFromWs > 0 && !isNaN(markPriceFromWs) ? markPriceFromWs : null)
            || (binanceLastPrice > 0 && !isNaN(binanceLastPrice) ? binanceLastPrice : null)
            || (avgPrice > 0 && !isNaN(avgPrice) ? avgPrice : 0);
          const entryPrice = parseFloat(p.avg_price);

          const exchangePnl = parseFloat(p.unrealized_pnl ?? p.unrealised_pnl ?? "");
          const unrealizedPnl = (!isNaN(exchangePnl) && exchangePnl !== 0)
            ? exchangePnl
            : (lastPrice - entryPrice) * sizeVal;

          const lockedMarginRaw = parseFloat(p.locked_margin || p.locked_user_margin || "0");
          const lockedMarginUsdt = lockedMarginRaw;
          const displayLockedMargin = isInrMargin ? lockedMarginRaw * usdtInrRate : lockedMarginRaw;

          const maintMarginRaw = parseFloat(p.maintenance_margin || "0");
          const displayMaintMargin = isInrMargin ? maintMarginRaw * usdtInrRate : maintMarginRaw;

          const pairQuote = (p.pair as string).split("_").pop() ?? "USDT";
          const pnlIsInr = pairQuote === "INR";
          const unrealizedPnlUsdt = pnlIsInr ? unrealizedPnl / usdtInrRate : unrealizedPnl;

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
            marginMode: p.margin_type || p.margin_mode || "isolated",
            marginCurrency,
            settlementCurrencyConversionPrice: p.settlement_currency_avg_price ? String(p.settlement_currency_avg_price) : null,
            settlementCurrencyAvgPrice: p.settlement_currency_avg_price ? String(p.settlement_currency_avg_price) : null,
            priceInInr: null,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
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
          coindcxCreds,
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
        // Sum fees from exchange orders (GROSS PnL = NET + fees)
        const totalFees = filledOrders.reduce(
          (sum: number, o: any) => sum + Math.abs(parseFloat(o.fee || "0")),
          0
        );
        // totalRealizedPnl already holds NET from exchange wallet above
        totalRealizedPnlGross = totalRealizedPnl + totalFees;
      } catch {
        recentTrades = [];
        totalRealizedPnl = 0;
        totalRealizedPnlGross = 0;
      }

      let walletUsdt = 0;
      let availableInr = 0;
      let lockedInr = 0;
      let walletCurrency = "USDT";

      try {
        const wallets = await getFuturesWallet(coindcxCreds);
        for (const w of wallets) {
          const currency = w.currency_short_name || "";
          const free = parseFloat(w.balance || "0");
          const locked = parseFloat(w.locked_balance || "0");
          const total = free + locked;
          if (currency === "USDT") {
            walletUsdt += total;
            availableInr += free;
            lockedInr += locked;
            walletCurrency = "USDT";
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
        const cachedBalances = userBalancesCache.get(userId);
        if (cachedBalances && cachedBalances.length > 0) {
          for (const b of cachedBalances) {
            const currency = (b.currency_short_name || b.currency || "").toUpperCase();
            const total = parseFloat(b.balance || "0") + parseFloat(b.locked_balance || "0");
            if (currency === "USDT") { walletUsdt += total; availableInr += parseFloat(b.balance || "0"); lockedInr += parseFloat(b.locked_balance || "0"); walletCurrency = "USDT"; }
            else if (currency === "INR") { walletUsdt += total / usdtInrRate; availableInr += parseFloat(b.balance || "0"); lockedInr += parseFloat(b.locked_balance || "0"); walletCurrency = "INR"; }
          }
        } else {
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

      // ── 4. DB Positions (Paper + Live tracked) ─────────────────────────
      const dbPositions = await db
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "open")));

      // ── 5. Merge Live (Exchange) + DB ───────────────────────────────────
      // We prioritize exchange truth for size/price, but use DB for ID/SL/TP metadata.
      // Group DB live positions by symbol:side so each exchange position consumes the next
      // unmatched DB row, avoiding duplicate IDs when CoinDCX returns >1 position per pair.
      const dbLiveByKey = new Map<string, typeof dbPositions>();
      for (const dbp of dbPositions) {
        if (dbp.isPaper) continue;
        const key = `${dbp.symbol}:${dbp.side}`;
        if (!dbLiveByKey.has(key)) dbLiveByKey.set(key, []);
        dbLiveByKey.get(key)!.push(dbp);
      }

      const mergedLive: any[] = [];
      const dbMatchedIds = new Set<number>();

      for (let i = 0; i < openPositions.length; i++) {
        const lp = openPositions[i];
        const key = `${lp.symbol}:${lp.side}`;
        const group = dbLiveByKey.get(key);

        if (group && group.length > 0) {
          // Consume the first unmatched DB row for this symbol+side
          const match = group.shift()!;
          dbMatchedIds.add(match.id);
          mergedLive.push({
            ...lp,
            id: match.id,
            stopLoss: match.stopLoss ? parseFloat(match.stopLoss) : lp.stopLoss,
            takeProfit: match.takeProfit ? parseFloat(match.takeProfit) : lp.takeProfit,
            entryReason: match.entryReason,
            strategyType: match.strategyType,
            isPaper: false,
          });
        } else {
          // No matching DB row — orphan exchange position, assign synthetic ID
          mergedLive.push({
            ...lp,
            id: i + 10000,
            isPaper: false,
          });
        }
      }

      // Append any DB live positions that were never matched (orphaned DB rows),
      // preserving them in the stream so nothing is silently dropped.
      for (const [, group] of dbLiveByKey) {
        for (const orphan of group) {
          dbMatchedIds.add(orphan.id);
          mergedLive.push({
            id: orphan.id,
            userId,
            symbol: orphan.symbol,
            side: orphan.side,
            entryPrice: orphan.entryPrice ?? "0",
            currentPrice: orphan.currentPrice ?? orphan.entryPrice ?? "0",
            size: orphan.size ?? "0",
            leverage: orphan.leverage ?? 1,
            margin: orphan.margin ?? "0",
            unrealizedPnl: orphan.unrealizedPnl ?? "0",
            realizedPnl: orphan.realizedPnl ?? "0.00",
            liquidationPrice: orphan.liquidationPrice ? String(orphan.liquidationPrice) : null,
            stopLoss: orphan.stopLoss ? parseFloat(orphan.stopLoss) : null,
            takeProfit: orphan.takeProfit ? parseFloat(orphan.takeProfit) : null,
            marginMode: orphan.marginMode || "isolated",
            marginCurrency: orphan.marginCurrency || "USDT",
            status: orphan.status || "open",
            createdAt: orphan.createdAt,
            updatedAt: orphan.updatedAt,
            missingFromExchange: true,
            isPaper: false,
          });
        }
      }

      // ── 6. Add Paper positions from DB ──────────────────────────────────
      const paperMapped = dbPositions
        .filter((p) => p.isPaper)
        .map((p) => mapPaperPosition(p, markets, usdtInrRate));

      const allPositions = [...mergedLive, ...paperMapped];

      return {
        openPositionsCount: allPositions.length,
        livePositionsCount: openPositions.length,
        paperPositionsCount: paperMapped.length,
        totalUnrealizedPnl: totalUnrealizedPnl.toFixed(4),
        totalRealizedPnlNet: totalRealizedPnl.toFixed(4),
        totalRealizedPnlGross: totalRealizedPnlGross.toFixed(4),
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
      console.error("[trading-service] Failed to fetch live portfolio details from CoinDCX:", err);
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

  const closedPositions = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.userId, userId),
        eq(positions.status, "closed")
      )
    );

  const localUnrealizedPnl = localPositions.reduce(
    (sum, p) => sum + parseFloat(p.unrealizedPnl || "0"),
    0
  );
  // NET realized PnL = sum of closed positions' realized PnL (after fees)
  const localRealizedPnlNet = closedPositions.reduce(
    (sum, p) => sum + parseFloat(p.realizedPnl || "0"),
    0
  );
  // Total fees paid across all trades
  const localTotalFees = allTrades.reduce(
    (sum, t) => sum + Math.abs(parseFloat(t.fee || "0")),
    0
  );
  // GROSS realized PnL = NET + fees (what you made before fees were deducted)
  const localRealizedPnlGross = localRealizedPnlNet + localTotalFees;
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
    livePositionsCount: localPositions.filter(p => !p.isPaper).length,
    paperPositionsCount: localPositions.filter(p => p.isPaper).length,
    totalUnrealizedPnl: localUnrealizedPnl.toFixed(4),
    totalRealizedPnlNet: localRealizedPnlNet.toFixed(4),
    totalRealizedPnlGross: localRealizedPnlGross.toFixed(4),
    totalFees: localTotalFees.toFixed(4),
    totalMargin: localMargin.toFixed(4),
    walletUsdt: "0.0000",
    walletCurrency: "USDT",
    availableInr: "0.0000",
    lockedInr: "0.0000",
    usdtInrRate: String(usdtInrRate),
    totalEquity: localMargin + localUnrealizedPnl,
    positions: positionsMapped,
    recentTrades: tradesMapped,
  };
}

export async function executeOrder(userId: number, input: any) {
  if (!globalKillSwitch.canTrade()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Trading halted" });
  if (input.leverage < MIN_SYSTEM_LEVERAGE || input.leverage > MAX_SYSTEM_LEVERAGE) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Leverage must be between ${MIN_SYSTEM_LEVERAGE}x and ${MAX_SYSTEM_LEVERAGE}x`,
    });
  }

  const db = getDb();
  const dbCreds = await db.select().from(exchangeCredentials).where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx"))).limit(1);
  const coindcxCreds = dbCreds && dbCreds[0] ? decryptCreds(dbCreds[0]) : coinDCXEnvCreds;

  let exchangeOrderId: string | undefined;
  if (coindcxCreds && env.placeOrders) {
    const coindcxSymbol = input.symbol.startsWith("B-") ? input.symbol : `B-${input.symbol.replace("USDT", "_USDT")}`;
    const orderRes = await createFuturesOrder(coindcxCreds, {
      market: coindcxSymbol, side: input.side === "long" ? "buy" : "sell", order_type: "market", total_quantity: parseFloat(input.size), price: parseFloat(input.entryPrice), leverage: input.leverage,
    });
    exchangeOrderId = orderRes?.id;
  }

  let entryPriceVal = parseFloat(input.entryPrice);
  let currentPriceVal = parseFloat(input.currentPrice);
  let marginVal = parseFloat(input.margin);

  if (!exchangeOrderId) {
    const SLIPPAGE_BPS = 5;
    const isLong = input.side.toLowerCase() === "long" || input.side.toLowerCase() === "buy";
    entryPriceVal = entryPriceVal * (1 + (isLong ? 1 : -1) * (SLIPPAGE_BPS / 10000));
    currentPriceVal = entryPriceVal;
    marginVal = (parseFloat(input.size) * entryPriceVal) / input.leverage;
  }

  const result = await db.insert(positions).values({
    userId, symbol: input.symbol, side: input.side, entryPrice: String(entryPriceVal), currentPrice: String(currentPriceVal), size: input.size,
    leverage: input.leverage, margin: marginVal.toFixed(4), status: "open", isPaper: !exchangeOrderId, exchangeOrderId,
  }).returning({ id: positions.id });

  tradingEvents.emit(`portfolio-update:${userId}`);
  return { id: result[0].id, exchangeOrderId };
}
