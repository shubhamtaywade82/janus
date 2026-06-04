/**
 * Market Data Worker
 * Runs independently, subscribes to market feeds, and publishes domain events.
 * Use: node --experimental-vm-modules dist/interfaces/workers/market-data.worker.js
 */
import { loadConfig } from "../../app/config.js";
import { buildContainer } from "../../app/container.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { DomainEvents } from "../../domain/common/events.js";
import { BinanceMarketFeed } from "../../infrastructure/exchange/binance/binance-market-feed.js";
import { DeltaWsClient } from "../../infrastructure/exchange/delta/delta-ws-client.js";
import { mapOrderbook as mapDeltaOrderbook, mapTrade as mapDeltaTrade } from "../../infrastructure/exchange/delta/delta-mapper.js";
import type { CandleInterval } from "../../domain/market-data/candle.js";

const log = logger.child({ worker: "market-data" });

const SYMBOLS_COINDCX = (process.env.SYMBOLS_COINDCX ?? "BTCUSDT,ETHUSDT,SOLUSDT").split(",");
const SYMBOLS_DELTA = (process.env.SYMBOLS_DELTA ?? "BTCUSDT,ETHUSDT").split(",");
const CANDLE_INTERVAL: CandleInterval = (process.env.CANDLE_INTERVAL ?? "1m") as CandleInterval;

async function runCoinDCXFeed(container: ReturnType<typeof buildContainer>) {
  const feed = new BinanceMarketFeed();
  await feed.connect();
  log.info("Binance feed connected (for CoinDCX symbols)");

  for (const symbol of SYMBOLS_COINDCX) {
    // Orderbook
    (async () => {
      for await (const snapshot of feed.subscribeOrderbook(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_ORDERBOOK_UPDATED, snapshot);
      }
    })().catch((err) => log.error("orderbook stream error", { symbol, error: String(err) }));

    // Trades
    (async () => {
      for await (const tick of feed.subscribeTrades(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_TRADE_TICK, tick);
      }
    })().catch((err) => log.error("trades stream error", { symbol, error: String(err) }));

    // Candles (closed only)
    (async () => {
      for await (const candle of feed.subscribeCandles(symbol, CANDLE_INTERVAL)) {
        if (candle.closed) {
          container.eventBus.publish(DomainEvents.MARKET_CANDLE_CLOSED, candle);
        }
      }
    })().catch((err) => log.error("candle stream error", { symbol, error: String(err) }));
  }
}

async function runDeltaFeed(container: ReturnType<typeof buildContainer>) {
  if (!container.gateways.has("delta")) return;

  const deltaGateway = container.gateways.get("delta")!;

  for (const symbol of SYMBOLS_DELTA) {
    (async () => {
      for await (const snapshot of deltaGateway.subscribeOrderbook(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_ORDERBOOK_UPDATED, snapshot);
      }
    })().catch((err) => log.error("Delta orderbook stream error", { symbol, error: String(err) }));
  }
}

async function main() {
  log.info("starting market-data worker");
  const config = loadConfig();
  const container = buildContainer(config);

  // Connect gateways (needed for Delta's own market data)
  for (const [name, gw] of container.gateways) {
    try {
      await gw.connect();
      log.info("gateway connected", { exchange: name });
    } catch (err) {
      log.error("gateway connect failed", { exchange: name, error: String(err) });
    }
  }

  const tasks: Promise<void>[] = [];

  if (config.exchanges.includes("coindcx")) {
    tasks.push(runCoinDCXFeed(container));
  }

  if (config.exchanges.includes("delta")) {
    tasks.push(runDeltaFeed(container));
  }

  await Promise.all(tasks);
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
