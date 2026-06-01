import { latestTickerCache, subscribeToSymbol } from "../api/services/streaming.ts";
import { markPriceCache } from "../api/services/coindcx-ws.ts";
import { fetchPortfolioData } from "../api/routers/trading-router.ts";
import * as dotenv from "dotenv";

dotenv.config();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log("Subscribing ETHUSDT on Binance WS...");
  subscribeToSymbol("ETHUSDT");

  console.log("Waiting 4s for WS data to arrive...");
  await wait(4000);

  console.log("\n── Cache state ──");
  console.log("latestTickerCache ETHUSDT:", latestTickerCache.get("ETHUSDT"));
  console.log("markPriceCache B-ETH_USDT:", markPriceCache.get("B-ETH_USDT"));
  console.log("latestTickerCache size:", latestTickerCache.size);
  console.log("markPriceCache size:", markPriceCache.size);

  console.log("\n── fetchPortfolioData ──");
  const data = await fetchPortfolioData(1);
  const pos = data.positions[0];
  if (pos) {
    console.log(`currentPrice=${pos.currentPrice}  entryPrice=${pos.entryPrice}  unrealizedPnl=${pos.unrealizedPnl}`);
  }
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
