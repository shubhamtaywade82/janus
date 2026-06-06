import io from "socket.io-client";
import { createHmac } from "crypto";
import { getDb } from "../queries/connection";
import { exchangeCredentials, positions, futuresWallets } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { EventEmitter } from "events";
import { latestTickerCache, marketEvents, activeStreams } from "./streaming";
import { syncLiveAccountFromCoinDCX } from "./trading-account";
import { decryptCreds } from "../lib/crypto";

export const tradingEvents = new EventEmitter();
tradingEvents.setMaxListeners(100);

export const userBalancesCache = new Map<number, any[]>();
export const userPositionsCache = new Map<number, any[]>();
export const markPriceCache = new Map<string, number>();

// Pairs to stream public data for (Dashboard symbols)
const PUBLIC_PAIRS = [
  "B-BTC_USDT", "B-ETH_USDT", "B-SOL_USDT",
  "B-BNB_USDT", "B-XRP_USDT", "B-ADA_USDT",
  "B-DOGE_USDT", "B-AVAX_USDT",
];

// Convert CoinDCX pair to Binance-style symbol (B-ETH_USDT → ETHUSDT)
const toSymbol = (pair: string) => pair.replace("B-", "").replace("_", "");

let socket: any = null;

// CoinDCX sends { event: string, data: "<JSON string>" } — double-serialized
const parseWsEvent = (response: any): any => {
  if (typeof response?.data === "string") {
    try { return JSON.parse(response.data); } catch { return response; }
  }
  return response?.data ?? response;
};

function generateWsSignature(secret: string, body: Record<string, any>): string {
  const payload = JSON.stringify(body);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function initCoinDCXPrivateWs() {
  const db = getDb();
  
  // Find user credentials for userId = 1
  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.userId, 1),
        eq(exchangeCredentials.exchange, "coindcx")
      )
    )
    .limit(1);

  if (!creds || !creds[0]) {
    console.log("[coindcx-ws] No credentials found. WebSocket listener idle.");
    return;
  }

  const { apiKey, apiSecret } = decryptCreds(creds[0]);
  const wsUrl = "wss://stream.coindcx.com"; // CoinDCX Socket.io stream endpoint

  if (socket) {
    socket.disconnect();
  }

  console.log(`[coindcx-ws] Connecting to CoinDCX Private Socket.io v2: ${wsUrl}`);
  
  socket = io(wsUrl, {
    transports: ["websocket"],
    upgrade: false,
    rejectUnauthorized: false
  });

  socket.on("connect", () => {
    console.log("[coindcx-ws] Socket.io connection opened. Authenticating for 'coindcx' private channel...");
    
    // Auth Handshake for 'coindcx' channel
    const body = { channel: "coindcx" };
    const authSignature = generateWsSignature(apiSecret, body);

    // CoinDCX socket.io join auth handshake
    socket.emit("join", {
      channelName: "coindcx",
      authSignature,
      apiKey,
    });
  });

  socket.on("joined", (response: any) => {
    console.log("[coindcx-ws] Authenticated successfully joined 'coindcx' channel:", response);
    // Mark prices (all pairs, ~1s)
    socket.emit("join", { channelName: "currentPrices@futures@rt" });
    // LTP + klines per pair (futures prices, correct for our positions)
    for (const pair of PUBLIC_PAIRS) {
      socket.emit("join", { channelName: `${pair}@prices-futures` });
      socket.emit("join", { channelName: `${pair}_1m-futures` });
    }
    console.log("[coindcx-ws] Joined public futures channels for", PUBLIC_PAIRS.length, "pairs");
  });

  // Mark price updates (~1s, all pairs)
  socket.on("currentPrices@futures#update", (raw: any) => {
    const parsed = parseWsEvent(raw);
    const prices = parsed?.prices ?? {};
    for (const [pair, data] of Object.entries(prices) as [string, any][]) {
      if (data?.mp) {
        const mpVal = typeof data.mp === 'number' ? data.mp : parseFloat(String(data.mp));
        if (mpVal > 0 && !isNaN(mpVal)) {
          markPriceCache.set(pair, mpVal);
          // Also update latestTickerCache so portfolio + UI get futures mark price
          latestTickerCache.set(toSymbol(pair), { lastPrice: mpVal, symbol: toSymbol(pair) });
        }
      }
    }
  });

  // LTP updates from CoinDCX futures (fires on every trade)
  socket.on("price-change", (raw: any) => {
    const parsed = parseWsEvent(raw);
    if (!parsed?.p) return;
    // Find which pair emitted this (CoinDCX sends pair in channel, not in payload)
    // parsed.pr = "f" means futures. Update all matched mark prices.
    // We rely on currentPrices@futures#update for pair-specific prices.
  });

  // CoinDCX 1m kline — emit as Binance-compatible kline event for the chart
  socket.on("candlestick", (raw: any) => {
    const parsed = parseWsEvent(raw);
    const candles: any[] = parsed?.data ?? [];
    const c = candles[0];
    if (!c?.pair) return;
    const symbol = toSymbol(c.pair);
    const kline = {
      openTime: c.open_time * 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      closeTime: c.close_time * 1000,
      quoteVolume: c.quote_volume,
      trades: 0,
    };
    marketEvents.emit(`${symbol}:kline`, kline);
    // Update ticker cache with latest close
    if (c.close) {
      const price = parseFloat(c.close);
      if (price > 0 && !isNaN(price)) {
        latestTickerCache.set(symbol, { lastPrice: price, symbol });
      }

      // Emit ticker update to UI as fallback if Binance stream is down/inactive
      const binanceActive = activeStreams.get(symbol)?.ws?.readyState === 1;
      if (!binanceActive) {
        marketEvents.emit(`${symbol}:ticker`, {
          symbol,
          priceChange: "0.00",
          priceChangePercent: "0.00",
          weightedAvgPrice: c.close,
          lastPrice: c.close,
          lastQty: "0.00",
          openPrice: c.open,
          highPrice: c.high,
          lowPrice: c.low,
          volume: c.volume,
          quoteVolume: c.quote_volume,
          openTime: c.open_time * 1000,
          closeTime: c.close_time * 1000,
          count: 0,
        });
      }
    }
  });

  socket.on("df-position-update", (raw: any) => {
    const parsed = parseWsEvent(raw);
    const posList: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    console.log(`[coindcx-ws] df-position-update: ${posList.length} positions`);
    if (posList.length > 0) {
      const existing = userPositionsCache.get(1) || [];
      const updated = [...existing];
      for (const p of posList) {
        const idx = updated.findIndex((e: any) => e.pair === p.pair);
        if (idx >= 0) updated[idx] = p;
        else updated.push(p);
      }
      userPositionsCache.set(1, updated);
    }
    tradingEvents.emit("portfolio-update:1");
  });

  socket.on("df-order-update", (raw: any) => {
    const parsed = parseWsEvent(raw);
    console.log("[coindcx-ws] df-order-update:", JSON.stringify(parsed).slice(0, 200));
    tradingEvents.emit("portfolio-update:1");
  });

  socket.on("balance-update", async (raw: any) => {
    const parsed = parseWsEvent(raw);
    const balanceList: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    console.log(`[coindcx-ws] balance-update: ${balanceList.length} entries`, balanceList.map((b: any) => `${b.currency_short_name}=${b.balance}`));

    if (balanceList) {
      userBalancesCache.set(1, balanceList);
      // Persist each currency balance to DB so it survives server restarts
      try {
        const db = getDb();
        for (const b of balanceList) {
          const currency = (b.currency_short_name || b.currency || "").toUpperCase();
          if (currency !== "INR" && currency !== "USDT") continue;
          const existing = await db
            .select()
            .from(futuresWallets)
            .where(and(
              eq(futuresWallets.userId, 1),
              eq(futuresWallets.exchange, "coindcx"),
              eq(futuresWallets.marginCurrency, currency as "INR" | "USDT")
            ))
            .limit(1);

          // Extended fields — present in cross margin detail events
          const walletData = {
            balance: String(b.balance || "0"),
            lockedBalance: String(b.locked_balance || "0"),
            totalAccountEquity: String(b.total_account_equity || b.equity || "0"),
            availableBalanceCross: String(b.available_balance_cross || b.available_balance || b.balance || "0"),
            marginRatioCross: String(b.margin_ratio_cross || b.margin_ratio || "0"),
            withdrawableBalance: String(b.withdrawable_balance || b.balance || "0"),
            crossUserMargin: String(b.cross_user_margin || "0"),
            crossOrderMargin: String(b.cross_order_margin || "0"),
            unrealizedPnl: String(b.unrealized_pnl || "0"),
            realizedPnl: String(b.realized_pnl || "0"),
            maintenanceMargin: String(b.maintenance_margin || "0"),
            initialMargin: String(b.initial_margin || "0"),
            liquidationValue: String(b.liquidation_value || "0"),
            accountType: String(b.account_type || b.margin_mode || "cross"),
            updatedAt: new Date(),
          };

          if (existing[0]) {
            await db.update(futuresWallets).set(walletData).where(eq(futuresWallets.id, existing[0].id));
          } else {
            await db.insert(futuresWallets).values({
              userId: 1,
              exchange: "coindcx",
              marginCurrency: currency as "INR" | "USDT",
              ...walletData,
            });
          }

          // Mirror to unified trading_accounts (live mode)
          if (currency === "USDT") {
            const walletBalance = parseFloat(b.balance || "0") + parseFloat(b.locked_balance || "0");
            const availableBalance = parseFloat(b.available_balance_cross || b.available_balance || b.balance || "0");
            const lockedMargin = parseFloat(b.cross_user_margin || "0") + parseFloat(b.cross_order_margin || "0");
            const unrealizedPnl = parseFloat(b.unrealized_pnl || "0");
            const realizedPnl = parseFloat(b.realized_pnl || "0");

            syncLiveAccountFromCoinDCX(1, {
              walletBalance,
              availableBalance,
              lockedMargin,
              unrealizedPnl,
              realizedPnl,
            }).catch((err) => console.error("[coindcx-ws] Failed to sync live account:", err));
          }
        }
      } catch (err) {
        console.error("[coindcx-ws] Failed to persist balance to DB:", err);
      }
    }
    tradingEvents.emit("portfolio-update:1");
  });

  // Handle legacy/fallback user-orders if any
  socket.on("user-orders", async (order: any) => {
    try {
      console.log("[coindcx-ws] Received execution report:", order);
      const exchangeOrderId = order.id;
      const status = order.status; // e.g. "filled", "cancelled"

      if (status === "filled") {
        const db = getDb();
        
        // Match position by exchangeOrderId
        const matchedPositions = await db
          .select()
          .from(positions)
          .where(eq(positions.exchangeOrderId, exchangeOrderId))
          .limit(1);

        if (matchedPositions && matchedPositions[0]) {
          const pos = matchedPositions[0];
          
          await db
            .update(positions)
            .set({
              status: "open",
              updatedAt: new Date(),
            })
            .where(eq(positions.id, pos.id));

          console.log(`[coindcx-ws] Updated position ${pos.id} to open in DB.`);
          tradingEvents.emit("portfolio-update:1");
        }
      }
    } catch (err) {
      console.error("[coindcx-ws] Error handling user order tick:", err);
    }
  });

  socket.on("error", (err: any) => {
    console.error("[coindcx-ws] Socket.io private socket error:", err);
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[coindcx-ws] Socket.io disconnected. Reason: ${reason}. Will reconnect automatically.`);
  });
}
