/**
 * CoinDCX Futures WebSocket Test
 *
 * Usage:
 *   npx tsx scratch/test_coindcx_ws.ts [channels...] [--pair B-ETH_USDT]
 *
 * Available channels:
 *   account      df-position-update + df-order-update + balance-update (private)
 *   positions    df-position-update only (private)
 *   orders       df-order-update only (private)
 *   balance      balance-update only (private)
 *   trades       new-trade  per pair
 *   ltp          price-change  per pair
 *   candle       candlestick 1m  per pair
 *   orderbook    depth-snapshot  per pair
 *   mark         currentPrices@futures#update  (all pairs)
 *   all          subscribe everything above
 *
 * Examples:
 *   npx tsx scratch/test_coindcx_ws.ts positions
 *   npx tsx scratch/test_coindcx_ws.ts account
 *   npx tsx scratch/test_coindcx_ws.ts ltp trades --pair B-BTC_USDT
 *   npx tsx scratch/test_coindcx_ws.ts all
 *   npx tsx scratch/test_coindcx_ws.ts positions ltp
 */

import io from "socket.io-client";
import { createHmac } from "crypto";
import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { getFuturesPositions } from "../api/services/coindcx.ts";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Parse args ───
const args = process.argv.slice(2);
const pairFlagIdx = args.indexOf("--pair");
const PAIR = pairFlagIdx !== -1 ? args[pairFlagIdx + 1] : "B-ETH_USDT";
// Strip --pair and its value, then keep only non-flag args as channel names
const channelArgs = args.filter((a, i) =>
  !a.startsWith("--") && !(pairFlagIdx !== -1 && i === pairFlagIdx + 1)
);
const ALL = channelArgs.includes("all") || channelArgs.length === 0;
const has = (name: string) => ALL || channelArgs.includes(name);
// private channel needed if any account-level event requested
const needsPrivate = has("account") || has("positions") || has("orders") || has("balance");

if (channelArgs.length === 0) {
  console.log("No channels specified — subscribing to all. Pass channel names to filter.\n");
}
console.log(`Pair: ${PAIR}`);
console.log(`Channels: ${ALL ? "all" : channelArgs.join(", ")}\n`);

// ─── Event payload parser (CoinDCX double-serializes data as JSON string) ───
const parseWsEvent = (response: any): any => {
  if (typeof response?.data === "string") {
    try { return JSON.parse(response.data); } catch { return response; }
  }
  return response?.data ?? response;
};

const main = async () => {
  const db = getDb();
  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);

  if (!creds[0]) { console.error("No credentials found"); process.exit(1); }
  const { apiKey, apiSecret } = creds[0];

  // ─── REST snapshot on startup ───
  if (has("account") || has("positions")) {
    console.log("[REST] Fetching current positions snapshot...");
    try {
      const positions = await getFuturesPositions({ apiKey, apiSecret });
      const open = positions.filter((p: any) => parseFloat(p.active_pos) !== 0);
      console.log(`[REST SNAPSHOT] ${open.length} open / ${positions.length} total positions`);
      open.forEach((p: any) =>
        console.log(`  ${p.pair}  active=${p.active_pos}  entry=${p.avg_price}  mark=${p.mark_price}  liq=${p.liquidation_price}  ${p.margin_currency_short_name}  lev=${p.leverage}x  type=${p.margin_type}`)
      );
      console.log("[REST] Waiting for live updates...\n");
    } catch (e: any) {
      console.error("[REST] Failed:", e.message);
    }
  }

  const body = { channel: "coindcx" };
  const payload = Buffer.from(JSON.stringify(body)).toString();
  const signature = createHmac("sha256", apiSecret).update(payload).digest("hex");

  const socket = io("wss://stream.coindcx.com", { transports: ["websocket"] });

  socket.on("connect", () => {
    console.log("[ws] Connected:", socket.id);

    if (needsPrivate) {
      socket.emit("join", { channelName: "coindcx", authSignature: signature, apiKey });
      console.log("[ws] Joined: coindcx private channel");
    }
    if (has("candle")) {
      socket.emit("join", { channelName: `${PAIR}_1m-futures` });
      console.log(`[ws] Joined: candlestick 1m for ${PAIR}`);
    }
    if (has("orderbook")) {
      socket.emit("join", { channelName: `${PAIR}@orderbook@20-futures` });
      console.log(`[ws] Joined: orderbook depth-20 for ${PAIR}`);
    }
    if (has("trades") || has("ltp")) {
      socket.emit("join", { channelName: `${PAIR}@trades-futures` });
      console.log(`[ws] Joined: trades for ${PAIR}`);
    }
    if (has("ltp")) {
      socket.emit("join", { channelName: `${PAIR}@prices-futures` });
      console.log(`[ws] Joined: prices (LTP) for ${PAIR}`);
    }
    if (has("mark")) {
      socket.emit("join", { channelName: "currentPrices@futures@rt" });
      console.log("[ws] Joined: mark prices (all pairs)");
    }
  });

  socket.on("joined", (res: any) => console.log("[joined]", JSON.stringify(parseWsEvent(res))));
  socket.on("disconnect", (reason: string) => console.log("[disconnect]", reason));
  socket.on("connect_error", (err: any) => console.error("[connect_error]", err.message));

  // ─── Private account events ───
  if (needsPrivate) {
    if (has("account") || has("positions")) {
      socket.on("df-position-update", (raw: any) => {
        console.log("[df-position-update]", JSON.stringify(raw));
        const parsed = parseWsEvent(raw);
        const list: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
        console.log("\n[POSITION UPDATE]", new Date().toISOString());
        list.forEach((p: any) =>
          console.log(`  ${p.pair}  active=${p.active_pos}  entry=${p.avg_price}  mark=${p.mark_price}  liq=${p.liquidation_price}  ${p.margin_currency_short_name}  lev=${p.leverage}x  type=${p.margin_type}  updated=${p.updated_at}`)
        );
      });
    }

    if (has("account") || has("orders")) {
      socket.on("df-order-update", (raw: any) => {
        const parsed = parseWsEvent(raw);
        const list: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
        console.log("\n[ORDER UPDATE]", new Date().toISOString());
        list.forEach((o: any) =>
          console.log(`  ${o.pair}  ${o.side}  status=${o.status}  type=${o.order_type}  price=${o.price}  qty=${o.total_quantity}  ${o.margin_currency_short_name}`)
        );
      });
    }

    if (has("account") || has("balance")) {
      socket.on("balance-update", (raw: any) => {
        const parsed = parseWsEvent(raw);
        const list: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
        console.log("\n[BALANCE UPDATE]", new Date().toISOString());
        list.forEach((b: any) =>
          console.log(`  ${b.currency_short_name}  balance=${b.balance}  locked=${b.locked_balance}`)
        );
      });
    }
  }

  // ─── Public market events ───
  if (has("candle")) {
    socket.on("candlestick", (raw: any) => {
      const d = parseWsEvent(raw);
      const c = (d?.data ?? [])[0];
      if (c) console.log(`[CANDLE ${d.i}]  ${c.pair}  O=${c.open} H=${c.high} L=${c.low} C=${c.close}  vol=${c.volume}`);
    });
  }

  if (has("orderbook")) {
    socket.on("depth-snapshot", (raw: any) => {
      const d = parseWsEvent(raw);
      const asks = (Object.entries(d?.asks ?? {}) as [string, string][]).slice(0, 3);
      const bids = (Object.entries(d?.bids ?? {}) as [string, string][]).slice(0, 3);
      console.log(`[ORDERBOOK]  asks=${asks.map(([p, q]) => `${p}×${q}`).join(" ")}  |  bids=${bids.map(([p, q]) => `${p}×${q}`).join(" ")}`);
    });
  }

  if (has("trades")) {
    socket.on("new-trade", (raw: any) => {
      const t = parseWsEvent(raw);
      console.log(`[TRADE]  ${t.s}  ${t.m === 1 ? "SELL" : "BUY"}  p=${t.p}  q=${t.q}  T=${t.T}`);
    });
  }

  if (has("ltp")) {
    socket.on("price-change", (raw: any) => {
      const t = parseWsEvent(raw);
      console.log(`[LTP]  ${PAIR}  p=${t.p}  T=${t.T}`);
    });
  }

  if (has("mark")) {
    socket.on("currentPrices@futures#update", (raw: any) => {
      const d = parseWsEvent(raw);
      const eth = d?.prices?.[PAIR];
      if (eth?.mp) console.log(`[MARK]  ${PAIR}  mp=${eth.mp}`);
    });
  }

  setInterval(() => { if (socket.connected) socket.emit("ping"); }, 25_000);

  setTimeout(() => {
    console.log("\n[ws] Done.");
    if (needsPrivate) socket.emit("leave", { channelName: "coindcx" });
    socket.disconnect();
    process.exit(0);
  }, 5 * 60 * 1000);
};

main().catch((e) => { console.error(e); process.exit(1); });
