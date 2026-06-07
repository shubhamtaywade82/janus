import { EventEmitter } from "events";
import WebSocket from "ws";
import { getDb } from "../queries/connection";
import { fundingRateHistory, liquidationEvents, marketData, openInterestData, orderBookSnapshots, recentTicks } from "@db/schema";
import { marketStateManager } from "./market-state";
import { getOrCreateFeedHealth, feedHealthRegistry } from "./feed-health";
import { liquidityEngine } from "./liquidity-engine";
import { fetchOpenInterest, fetchMarkPrice, fetchFundingRate, fetchKlines } from "./binance";

// Survive Vite HMR: store singletons on globalThis so hot-reloads don't orphan listeners
const _g = globalThis as Record<string, unknown>;

if (!(_g.__marketEvents instanceof EventEmitter)) {
  _g.__marketEvents = new EventEmitter();
  (_g.__marketEvents as EventEmitter).setMaxListeners(100);
}
export const marketEvents = _g.__marketEvents as EventEmitter;

// Latest ticker per symbol — populated by streaming WS, read by portfolio/signal logic
if (!(_g.__latestTickerCache instanceof Map)) {
  _g.__latestTickerCache = new Map<string, { lastPrice: number; symbol: string }>();
}
export const latestTickerCache = _g.__latestTickerCache as Map<string, { lastPrice: number; symbol: string }>;

interface ActiveSymbolStream {
  ws: WebSocket | null;
  subscribers: number;
  openInterestTimer: ReturnType<typeof setInterval> | null;
}

if (!(_g.__activeStreams instanceof Map)) {
  _g.__activeStreams = new Map<string, ActiveSymbolStream>();
}
export const activeStreams = _g.__activeStreams as Map<string, ActiveSymbolStream>;
const OPEN_INTEREST_POLL_MS = 30_000;

// Per-symbol ticker state: merged from @ticker (24h stats) + @trade (live lastPrice)
// Survives HMR via globalThis
if (!(_g.__tickerStateCache instanceof Map)) {
  _g.__tickerStateCache = new Map<string, Record<string, unknown>>();
}
const tickerStateCache = _g.__tickerStateCache as Map<string, Record<string, unknown>>;

// Global heartbeat — ticks all FeedHealth instances every 5s
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
function ensureHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const [, health] of feedHealthRegistry) health.tick();
  }, 5_000);
}

// ─── Dead-stream watchdog ───────────────────────────────────────────────────
// Tracks the last message timestamp per symbol. If a subscribed stream goes
// silent for > 60 s we force-reconnect it so trading never runs on stale data.

if (!(_g.__lastMessageAt instanceof Map)) {
  _g.__lastMessageAt = new Map<string, number>();
}
const lastMessageAt = _g.__lastMessageAt as Map<string, number>;

let watchdogInterval: ReturnType<typeof setInterval> | null = null;
function ensureWatchdog() {
  if (watchdogInterval) return;
  watchdogInterval = setInterval(() => {
    const now = Date.now();
    for (const [symbol] of activeStreams) {
      const last = lastMessageAt.get(symbol) ?? 0;
      if (last > 0 && now - last > 60_000) {
        console.error(
          `[streaming] WATCHDOG: ${symbol} stream silent for ` +
          `${Math.round((now - last) / 1000)}s — forcing reconnect`
        );
        // Terminate the socket; the existing close handler will reconnect with backoff
        const stream = activeStreams.get(symbol);
        stream?.ws?.terminate();
        lastMessageAt.delete(symbol); // reset so we don't fire again immediately
      }
    }
  }, 30_000); // check every 30s
}

function getBinanceWsUrl(symbol: string): string {
  const s = symbol.toLowerCase();
  const host = process.env.USE_TESTNET === "true"
    ? "stream.binancefuture.com"
    : "fstream.binance.com";
  return `wss://${host}/stream?streams=${s}@depth20@100ms/${s}@trade/${s}@ticker/${s}@kline_1m/${s}@forceOrder/${s}@markPrice`;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pollOpenInterest(symbol: string): Promise<void> {
  try {
    const oi = await fetchOpenInterest(symbol);
    const openInterest = parseFloat(String(oi.openInterest));
    const timestamp = Number(oi.time) || Date.now();

    if (!Number.isFinite(openInterest) || openInterest <= 0) return;

    marketStateManager.updateOpenInterest(symbol, {
      openInterest,
      timestamp,
    });

    const db = getDb();
    await db.insert(openInterestData).values({
      symbol,
      openInterest: String(openInterest),
      timestamp: new Date(timestamp),
    }).catch(() => {});
  } catch (err: unknown) {
    console.warn(`[streaming] Open interest poll failed for ${symbol}:`, getErrorMessage(err));
  }
}

async function pollMarkPriceAndFunding(symbol: string): Promise<void> {
  try {
    const [mp, fr] = await Promise.all([
      fetchMarkPrice(symbol).catch(() => null),
      fetchFundingRate(symbol).catch(() => null),
    ]);
    if (mp) {
      marketStateManager.updateFunding(symbol, {
        symbol,
        markPrice: mp.markPrice,
        indexPrice: mp.indexPrice,
        estimatedSettlePrice: mp.estimatedSettlePrice,
        fundingRate: fr?.fundingRate ?? "0",
        nextFundingTime: fr?.fundingTime ?? Date.now() + 8 * 60 * 60 * 1000,
      });
    }
  } catch (err: unknown) {
    console.warn(`[streaming] Mark price/funding poll failed for ${symbol}:`, getErrorMessage(err));
  }
}

// Track last processed kline closeTime per symbol to avoid duplicate events
const lastKlineCloseTime = new Map<string, number>();

async function pollKlines(symbol: string): Promise<void> {
  try {
    const klines = await fetchKlines(symbol, "1m", 5);
    for (const k of klines) {
      const prevClose = lastKlineCloseTime.get(symbol) ?? 0;
      if (k.closeTime <= prevClose) continue; // already processed
      lastKlineCloseTime.set(symbol, k.closeTime);

      // Save to DB
      const db = getDb();
      await db.insert(marketData).values({
        symbol,
        timeframe: "1m",
        timestamp: new Date(k.openTime),
        open: String(k.open),
        high: String(k.high),
        low: String(k.low),
        close: String(k.close),
        volume: String(k.volume),
        quoteVolume: String(k.quoteVolume || "0"),
        tradeCount: k.trades || 0,
      }).onConflictDoUpdate({
        target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
        set: {
          open: String(k.open),
          high: String(k.high),
          low: String(k.low),
          close: String(k.close),
          volume: String(k.volume),
          quoteVolume: String(k.quoteVolume || "0"),
          tradeCount: k.trades || 0,
        },
      });

      // Emit kline event for charts
      const kline = {
        openTime: k.openTime,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        closeTime: k.closeTime,
        quoteVolume: k.quoteVolume,
        trades: k.trades,
        isClosed: true,
      };
      marketEvents.emit(`${symbol}:kline`, kline);
      marketEvents.emit("kline-update", symbol, kline);
    }
  } catch (err: unknown) {
    console.warn(`[streaming] Kline poll failed for ${symbol}:`, getErrorMessage(err));
  }
}

export function subscribeToSymbol(symbol: string) {
  const current = activeStreams.get(symbol);
  if (current) {
    current.subscribers++;
    return;
  }

  // First subscriber, spin up the WebSocket connection
  const streamInfo: ActiveSymbolStream = {
    ws: null,
    subscribers: 1,
    openInterestTimer: null,
  };
  activeStreams.set(symbol, streamInfo);

  const url = getBinanceWsUrl(symbol);
  console.log(`[streaming] Connecting to Binance WS for ${symbol}: ${url}`);

  const ws = new WebSocket(url);
  streamInfo.ws = ws;
  pollOpenInterest(symbol).catch(() => {});
  pollMarkPriceAndFunding(symbol).catch(() => {});
  pollKlines(symbol).catch(() => {});
  streamInfo.openInterestTimer = setInterval(() => {
    pollOpenInterest(symbol).catch(() => {});
    pollMarkPriceAndFunding(symbol).catch(() => {});
    pollKlines(symbol).catch(() => {});
  }, OPEN_INTEREST_POLL_MS);

  const lastDbSave = {
    depth: 0,
    trade: 0,
    kline: 0,
    funding: 0,
  };

  const throttle = (key: keyof typeof lastDbSave, ms: number, fn: () => Promise<void>) => {
    const now = Date.now();
    if (now - lastDbSave[key] > ms) {
      lastDbSave[key] = now;
      fn().catch(err => console.error(`[streaming] ${key} DB write failed:`, err));
    }
  };

  ws.on("message", async (dataStr) => {
    try {
      lastMessageAt.set(symbol, Date.now());
      getOrCreateFeedHealth(symbol).recordMessage();
      const { stream, data } = JSON.parse(dataStr.toString());
      if (!data) return;

      if (stream.endsWith("@depth20@100ms")) {
        handleDepthStream(symbol, data, throttle);
      } else if (stream.endsWith("@trade")) {
        handleTradeStream(symbol, data, throttle);
      } else if (stream.endsWith("@ticker")) {
        handleTickerStream(symbol, data);
      } else if (stream.endsWith("@kline_1m")) {
        handleKlineStream(symbol, data, throttle);
      } else if (stream.endsWith("@forceOrder")) {
        handleLiquidationStream(symbol, data);
      } else if (stream.endsWith("@markPrice")) {
        handleFundingStream(symbol, data, throttle);
      }

      liquidityEngine.processTick(symbol);
    } catch (err) {
      console.error(`[streaming] Error parsing message for ${symbol}:`, err);
    }
  });

  ws.on("error", (err) => {
    console.error(`[streaming] WS Error for ${symbol}:`, err);
  });

  ws.on("close", () => {
    console.log(`[streaming] WS closed for ${symbol}`);
    const state = activeStreams.get(symbol);
    if (state && state.subscribers > 0) {
      if (state.openInterestTimer) {
        clearInterval(state.openInterestTimer);
        state.openInterestTimer = null;
      }
      const health = getOrCreateFeedHealth(symbol);
      health.status = "reconnecting";
      health.reconnectAttempts++;
      const delay = health.backoffMs();
      console.log(`[streaming] Reconnecting ${symbol} in ${delay}ms (attempt ${health.reconnectAttempts})`);
      activeStreams.delete(symbol);
      setTimeout(() => subscribeToSymbol(symbol), delay);
    }
  });

  ensureHeartbeat();
  ensureWatchdog();
}

function handleDepthStream(symbol: string, data: any, throttle: (key: "depth" | "trade" | "kline" | "funding", ms: number, fn: () => Promise<void>) => void) {
  const bids = data.bids ?? data.b ?? [];
  const asks = data.asks ?? data.a ?? [];
  if (!Array.isArray(bids) || !Array.isArray(asks)) return;

  marketEvents.emit(`${symbol}:depth`, { bids, asks });
  marketStateManager.updateOrderBook(symbol, {
    bids: bids.map(([p, q]: [any, any]) => [parseFloat(String(p)), parseFloat(String(q))]),
    asks: asks.map(([p, q]: [any, any]) => [parseFloat(String(p)), parseFloat(String(q))]),
    timestamp: data.E || Date.now(),
  });

  throttle("depth", 2000, async () => {
    const db = getDb();
    const bestBid = parseFloat(bids[0]?.[0] || "0");
    const bestAsk = parseFloat(asks[0]?.[0] || "0");
    await db.insert(orderBookSnapshots).values({
      symbol,
      bids: bids.slice(0, 20),
      asks: asks.slice(0, 20),
      midPrice: String((bestBid + bestAsk) / 2),
      spread: String(bestAsk - bestBid),
    });
  });
}

function handleTradeStream(symbol: string, data: any, throttle: (key: "depth" | "trade" | "kline" | "funding", ms: number, fn: () => Promise<void>) => void) {
  const priceVal = parseFloat(String(data.p));
  marketEvents.emit(`${symbol}:trade`, { id: data.t, price: data.p, qty: data.q, time: data.T, isBuyerMaker: data.m });
  marketStateManager.updateTrade(symbol, { id: Number(data.t), price: priceVal, quantity: parseFloat(String(data.q)), side: data.m ? "SELL" : "BUY", timestamp: data.T });
  marketStateManager.updateLtp(symbol, priceVal, data.T);

  const prevTicker = tickerStateCache.get(symbol) ?? {};
  const liveTicker = { ...prevTicker, symbol: data.s ?? symbol, lastPrice: String(data.p) };
  tickerStateCache.set(symbol, liveTicker);
  if (priceVal > 0) latestTickerCache.set(symbol, { lastPrice: priceVal, symbol: data.s ?? symbol });
  marketEvents.emit(`${symbol}:ticker`, liveTicker);

  throttle("trade", 1000, async () => {
    await getDb().insert(recentTicks).values({
      symbol, price: data.p, size: data.q, side: data.m ? "sell" : "buy", isMaker: data.m, tradeTime: new Date(data.T),
    });
  });
}

function handleTickerStream(symbol: string, data: any) {
  const ticker = {
    symbol: data.s, priceChange: data.p, priceChangePercent: data.P, weightedAvgPrice: data.w,
    lastPrice: data.c, lastQty: data.Q, openPrice: data.o, highPrice: data.h, lowPrice: data.l,
    volume: data.v, quoteVolume: data.q, openTime: data.O, closeTime: data.C, firstId: data.F, lastId: data.L, count: data.n,
  };
  tickerStateCache.set(symbol, { ...ticker });
  const priceVal = parseFloat(data.c);
  if (priceVal > 0) latestTickerCache.set(symbol, { lastPrice: priceVal, symbol: data.s });
  marketEvents.emit(`${symbol}:ticker`, ticker);
  marketStateManager.updateLtp(symbol, priceVal, data.E || Date.now());
}

function handleKlineStream(symbol: string, data: any, throttle: (key: "depth" | "trade" | "kline" | "funding", ms: number, fn: () => Promise<void>) => void) {
  const k = data.k;
  const kline = { openTime: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, closeTime: k.T, quoteVolume: k.q, trades: k.n, isClosed: k.x };
  marketEvents.emit(`${symbol}:kline`, kline);
  marketEvents.emit(`kline-update`, symbol, kline);

  throttle("kline", 5000, async () => {
    await getDb().insert(marketData).values({
      symbol, timeframe: k.i, timestamp: new Date(k.t), open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, quoteVolume: k.q, tradeCount: k.n,
    }).onConflictDoUpdate({
      target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
      set: { open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, quoteVolume: k.q, tradeCount: k.n },
    });
  });
}

function handleLiquidationStream(symbol: string, data: any) {
  const o = data.o;
  const liq = {
    symbol: o.s, side: o.S, orderType: o.o, timeInForce: o.f, originalQuantity: o.q,
    price: parseFloat(String(o.p)), averagePrice: o.ap, orderStatus: o.X, lastFilledQuantity: o.l,
    orderFilledAccumulatedQuantity: o.z, orderTradeTime: o.T
  };
  marketEvents.emit(`${symbol}:liquidation`, liq);
  marketStateManager.updateLiquidation(symbol, liq);

  getDb().insert(liquidationEvents).values({
    symbol, side: liq.side, price: String(liq.price), quantity: liq.originalQuantity,
    filledQty: liq.orderFilledAccumulatedQuantity, status: liq.orderStatus, tradeTime: new Date(liq.orderTradeTime),
  }).catch(() => {});
}

function handleFundingStream(symbol: string, data: any, throttle: (key: "depth" | "trade" | "kline" | "funding", ms: number, fn: () => Promise<void>) => void) {
  const funding = { symbol: data.s, markPrice: data.p, indexPrice: data.i, estimatedSettlePrice: data.P, fundingRate: data.r, nextFundingTime: data.T };
  marketEvents.emit(`${symbol}:funding`, funding);
  marketStateManager.updateFunding(symbol, funding);

  throttle("funding", 60000, async () => {
    await getDb().insert(fundingRateHistory).values({
      symbol, fundingRate: funding.fundingRate, markPrice: funding.markPrice,
      nextFundingTime: new Date(funding.nextFundingTime), timestamp: new Date(data.E || Date.now()),
    });
  });
}

export function unsubscribeFromSymbol(symbol: string) {
  const current = activeStreams.get(symbol);
  if (!current) return;

  current.subscribers--;
  if (current.subscribers <= 0) {
    console.log(`[streaming] No subscribers left for ${symbol}. Closing WS connection.`);
    if (current.openInterestTimer) {
      clearInterval(current.openInterestTimer);
      current.openInterestTimer = null;
    }
    if (current.ws) {
      current.ws.close();
    }
    activeStreams.delete(symbol);

    // Evict per-symbol caches in signal-router + alertEngine storm maps
    // Dynamic import avoids a circular dependency (streaming ← signal-router ← streaming)
    import("../routers/signal-router").then(({ evictKnnSnapshot }) => {
      evictKnnSnapshot(symbol);
    }).catch(() => {});
  }
}

// ─── Vite HMR: force-close all WS connections on hot-reload ───
// New streaming.ts module = new message handlers. Old connections have stale closures.
// Closing them triggers the reconnect loop which uses the fresh subscribeToSymbol.
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    console.log("[streaming] HMR: closing all WS connections for fresh handlers");
    for (const [, stream] of activeStreams) {
      if (stream.openInterestTimer) clearInterval(stream.openInterestTimer);
      stream.ws?.terminate();
    }
    activeStreams.clear();
    lastMessageAt.clear();
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  });
}
