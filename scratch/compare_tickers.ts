import io from "socket.io-client";
import WebSocket from "ws";
import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config();

// Prices cache
const prices = {
  binanceSpotLtp: 0,
  binanceSpotTicker: 0,
  binanceFuturesLtp: 0,
  binanceFuturesTicker: 0,
  binanceFuturesMark: 0,
  coindcxFuturesLtp: 0,
  coindcxFuturesMark: 0,
};

// Double-serialization parser for CoinDCX
const parseWsEvent = (response: any): any => {
  if (typeof response?.data === "string") {
    try {
      return JSON.parse(response.data);
    } catch {
      return response;
    }
  }
  return response?.data ?? response;
};

async function main() {
  console.log("=== Starting Ticker Comparison Script ===");

  // --- 1. Fetch CoinDCX Credentials for Private Channel if needed (helps connection reliability) ---
  const db = getDb();
  let apiKey = "";
  let apiSecret = "";
  try {
    const creds = await db
      .select()
      .from(exchangeCredentials)
      .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
      .limit(1);
    if (creds && creds[0]) {
      apiKey = creds[0].apiKey;
      apiSecret = creds[0].apiSecret;
      console.log("[CoinDCX] Loaded API keys from DB.");
    }
  } catch (err) {
    console.log("[CoinDCX] No credentials loaded from DB, continuing as public client.");
  }

  // --- 2. Connect to Binance Spot WebSocket ---
  // Using multi-stream URL for Spot trade and ticker
  const binanceSpotWsUrl = "wss://stream.binance.com:9443/stream?streams=ethusdt@trade/ethusdt@ticker";
  const binanceSpotWs = new WebSocket(binanceSpotWsUrl);

  binanceSpotWs.on("open", () => {
    console.log("[Binance Spot WS] Connected.");
  });

  binanceSpotWs.on("message", (dataStr) => {
    try {
      const payload = JSON.parse(dataStr.toString());
      const { stream, data } = payload;
      if (!data) return;

      if (stream.endsWith("@trade")) {
        prices.binanceSpotLtp = parseFloat(data.p);
      } else if (stream.endsWith("@ticker")) {
        prices.binanceSpotTicker = parseFloat(data.c);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  // --- 3. Connect to Binance Futures WebSocket ---
  // Using multi-stream URL for Futures trade, ticker, and markPrice
  const binanceFuturesWsUrl = "wss://fstream.binance.com/market/stream?streams=ethusdt@trade/ethusdt@ticker/ethusdt@markPrice";
  const binanceFuturesWs = new WebSocket(binanceFuturesWsUrl);

  binanceFuturesWs.on("open", () => {
    console.log("[Binance Futures WS] Connected.");
  });

  binanceFuturesWs.on("message", (dataStr) => {
    try {
      const payload = JSON.parse(dataStr.toString());
      const { stream, data } = payload;
      if (!data) return;

      if (stream.endsWith("@trade")) {
        prices.binanceFuturesLtp = parseFloat(data.p);
      } else if (stream.endsWith("@ticker")) {
        prices.binanceFuturesTicker = parseFloat(data.c);
      } else if (stream.endsWith("@markPrice")) {
        prices.binanceFuturesMark = parseFloat(data.p);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  // --- 4. Connect to CoinDCX socket.io WebSocket ---
  const coindcxSocket = io("wss://stream.coindcx.com", {
    transports: ["websocket"],
    upgrade: false,
    rejectUnauthorized: false,
  });

  coindcxSocket.on("connect", () => {
    console.log("[CoinDCX WS] Connected:", coindcxSocket.id);

    // Join public futures channels
    coindcxSocket.emit("join", { channelName: "B-ETH_USDT@prices-futures" });
    coindcxSocket.emit("join", { channelName: "currentPrices@futures@rt" });
    console.log("[CoinDCX WS] Emitted join for prices-futures and currentPrices.");
  });

  coindcxSocket.on("joined", (res) => {
    // Just log confirmation
  });

  // CoinDCX LTP updates
  coindcxSocket.on("price-change", (raw) => {
    try {
      const data = parseWsEvent(raw);
      if (data?.p) {
        prices.coindcxFuturesLtp = parseFloat(data.p);
      }
    } catch (e) {
      // Ignore
    }
  });

  // CoinDCX Mark Price updates
  coindcxSocket.on("currentPrices@futures#update", (raw) => {
    try {
      const parsed = parseWsEvent(raw);
      const ethData = parsed?.prices?.["B-ETH_USDT"];
      if (ethData?.mp) {
        prices.coindcxFuturesMark = parseFloat(ethData.mp);
      }
    } catch (e) {
      // Ignore
    }
  });

  coindcxSocket.on("disconnect", (reason) => {
    console.log("[CoinDCX WS] Disconnected:", reason);
  });

  coindcxSocket.on("connect_error", (err) => {
    console.error("[CoinDCX WS] Connection error:", err.message);
  });

  // Keep connection alive
  const pingInterval = setInterval(() => {
    if (coindcxSocket.connected) {
      coindcxSocket.emit("ping");
    }
  }, 20000);

  // --- 5. Periodically Log Comparison ---
  console.log("\nLogging tick comparisons side-by-side every 1 second (Ctrl+C to quit):\n");
  console.log(
    "| Timestamp            | B-Spot Trade | B-Spot Ticker | B-Futures Trade | B-Futures Ticker | B-Futures Mark | CoinDCX LTP | CoinDCX Mark |"
  );
  console.log(
    "|----------------------|--------------|---------------|-----------------|------------------|----------------|-------------|--------------|"
  );

  const logInterval = setInterval(() => {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    const formatVal = (val: number) => (val > 0 ? val.toFixed(2).padStart(12) : "      --    ");

    console.log(
      `| ${timestamp}             ` +
        `|${formatVal(prices.binanceSpotLtp)} ` +
        `|${formatVal(prices.binanceSpotTicker)} ` +
        `|${formatVal(prices.binanceFuturesLtp)} ` +
        `|${formatVal(prices.binanceFuturesTicker)} ` +
        `|${formatVal(prices.binanceFuturesMark)} ` +
        `|${formatVal(prices.coindcxFuturesLtp)} ` +
        `|${formatVal(prices.coindcxFuturesMark)} |`
    );
  }, 1000);

  // Clean shutdown
  const cleanup = () => {
    console.log("\nCleaning up connections...");
    clearInterval(pingInterval);
    clearInterval(logInterval);
    binanceSpotWs.close();
    binanceFuturesWs.close();
    coindcxSocket.disconnect();
    console.log("Cleanup complete. Exiting.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
