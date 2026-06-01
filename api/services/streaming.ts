import { EventEmitter } from "events";
import WebSocket from "ws";
import { getDb } from "../queries/connection";
import { marketData, orderBookSnapshots, recentTicks } from "@db/schema";

export const marketEvents = new EventEmitter();
marketEvents.setMaxListeners(100);

// Latest ticker per symbol — populated by streaming WS, read by portfolio/signal logic
export const latestTickerCache = new Map<string, { lastPrice: number; symbol: string }>();

interface ActiveSymbolStream {
  ws: WebSocket | null;
  subscribers: number;
}

const activeStreams = new Map<string, ActiveSymbolStream>();

function getBinanceWsUrl(symbol: string): string {
  const s = symbol.toLowerCase();
  // Using spot stream (fstream.binance.com futures is geo-restricted in some regions)
  return `wss://stream.binance.com:9443/stream?streams=${s}@depth20@100ms/${s}@trade/${s}@ticker/${s}@kline_1m`;
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
  };
  activeStreams.set(symbol, streamInfo);

  const url = getBinanceWsUrl(symbol);
  console.log(`[streaming] Connecting to Binance WS for ${symbol}: ${url}`);

  const ws = new WebSocket(url);
  streamInfo.ws = ws;

  let lastDbSave = {
    depth: 0,
    trade: 0,
    kline: 0,
  };

  ws.on("message", async (dataStr) => {
    try {
      const payload = JSON.parse(dataStr.toString());
      const { stream, data } = payload;
      if (!data) return;

      if (stream.endsWith("@depth20@100ms")) {
        // Spot uses bids/asks, futures uses b/a
        const bids = data.bids ?? data.b ?? [];
        const asks = data.asks ?? data.a ?? [];
        if (!Array.isArray(bids) || !Array.isArray(asks)) return;
        const formattedDepth = { bids, asks };

        marketEvents.emit(`${symbol}:depth`, formattedDepth);

        // Throttle DB writes to once every 2 seconds
        const now = Date.now();
        if (now - lastDbSave.depth > 2000) {
          lastDbSave.depth = now;
          const db = getDb();
          const bestBid = parseFloat(bids[0]?.[0] || "0");
          const bestAsk = parseFloat(asks[0]?.[0] || "0");
          await db.insert(orderBookSnapshots).values({
            symbol,
            bids: bids.slice(0, 20),
            asks: asks.slice(0, 20),
            midPrice: String((bestBid + bestAsk) / 2),
            spread: String(bestAsk - bestBid),
          }).catch(() => {});
        }
      } 
      else if (stream.endsWith("@trade")) {
        const formattedTrade = {
          id: data.t,
          price: data.p,
          qty: data.q,
          time: data.T,
          isBuyerMaker: data.m,
        };

        marketEvents.emit(`${symbol}:trade`, formattedTrade);

        // Save trade to DB
        const now = Date.now();
        if (now - lastDbSave.trade > 1000) {
          lastDbSave.trade = now;
          const db = getDb();
          await db.insert(recentTicks).values({
            symbol,
            price: data.p,
            size: data.q,
            side: data.m ? "sell" : "buy",
            isMaker: data.m,
            tradeTime: new Date(data.T),
          }).catch(() => {});
        }
      } 
      else if (stream.endsWith("@ticker")) {
        const formattedTicker = {
          symbol: data.s,
          priceChange: data.p,
          priceChangePercent: data.P,
          weightedAvgPrice: data.w,
          lastPrice: data.c,
          lastQty: data.Q,
          openPrice: data.o,
          highPrice: data.h,
          lowPrice: data.l,
          volume: data.v,
          quoteVolume: data.q,
          openTime: data.O,
          closeTime: data.C,
          firstId: data.F,
          lastId: data.L,
          count: data.n,
        };

        latestTickerCache.set(symbol, { lastPrice: parseFloat(data.c), symbol: data.s });
        marketEvents.emit(`${symbol}:ticker`, formattedTicker);
      } 
      else if (stream.endsWith("@kline_1m")) {
        const k = data.k;
        const formattedKline = {
          openTime: k.t,
          open: k.o,
          high: k.h,
          low: k.l,
          close: k.c,
          volume: k.v,
          closeTime: k.T,
          quoteVolume: k.q,
          trades: k.n,
        };

        marketEvents.emit(`${symbol}:kline`, formattedKline);

        // Throttle kline updates in DB
        const now = Date.now();
        if (now - lastDbSave.kline > 5000) {
          lastDbSave.kline = now;
          await db.insert(marketData).values({
            symbol,
            timeframe: k.i,
            timestamp: new Date(k.t),
            open: k.o,
            high: k.h,
            low: k.l,
            close: k.c,
            volume: k.v,
            quoteVolume: k.q,
            tradeCount: k.n,
          })
          .onConflictDoUpdate({
            target: [marketData.symbol, marketData.timeframe, marketData.timestamp],
            set: {
              open: k.o,
              high: k.h,
              low: k.l,
              close: k.c,
              volume: k.v,
              quoteVolume: k.q,
              tradeCount: k.n,
            }
          })
          .catch((err) => {
            console.error("[streaming] DB upsert failed:", err);
          });
        }
      }
    } catch (err) {
      console.error(`[streaming] Error parsing message for ${symbol}:`, err);
    }
  });

  ws.on("error", (err) => {
    console.error(`[streaming] WS Error for ${symbol}:`, err);
  });

  ws.on("close", () => {
    console.log(`[streaming] WS Connection closed for ${symbol}`);
    // Attempt reconnect if still has subscribers
    const state = activeStreams.get(symbol);
    if (state && state.subscribers > 0) {
      activeStreams.delete(symbol);
      setTimeout(() => subscribeToSymbol(symbol), 5000);
    }
  });
}

export function unsubscribeFromSymbol(symbol: string) {
  const current = activeStreams.get(symbol);
  if (!current) return;

  current.subscribers--;
  if (current.subscribers <= 0) {
    console.log(`[streaming] No subscribers left for ${symbol}. Closing WS connection.`);
    if (current.ws) {
      current.ws.close();
    }
    activeStreams.delete(symbol);
  }
}
