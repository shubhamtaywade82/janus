/**
 * Market Data Worker
 *
 * Subscribes to all market data channels for configured exchanges and
 * publishes normalized domain events on the shared event bus.
 * Optionally writes live state to Redis.
 *
 * Exchange routing:
 *   coindcx → Binance USD-M Futures WS (depth, aggTrade, bookTicker, markPrice, klines)
 *   delta   → Delta Exchange India WS   (l2_orderbook, all_trades, v2/ticker)
 */
import { loadConfig } from "../../app/config.js";
import { buildContainer } from "../../app/container.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { DomainEvents } from "../../domain/common/events.js";
import { BinanceMarketFeed } from "../../infrastructure/exchange/binance/binance-market-feed.js";
import { DeltaMarketFeed } from "../../infrastructure/exchange/delta/delta-market-feed.js";
import { NoopOrderbookCache } from "../../infrastructure/market-data/redis-orderbook-cache.js";
import { OrderbookMaintainer } from "../../infrastructure/market-data/orderbook-maintainer.js";
import type { CandleInterval } from "../../domain/market-data/candle.js";

const log = logger.child({ worker: "market-data" });

const SYMBOLS_COINDCX = (process.env.SYMBOLS_COINDCX ?? "BTCUSDT,ETHUSDT,SOLUSDT").split(",");
const SYMBOLS_DELTA = (process.env.SYMBOLS_DELTA ?? "BTCUSDT,ETHUSDT").split(",");
const CANDLE_INTERVAL: CandleInterval = (process.env.CANDLE_INTERVAL ?? "1m") as CandleInterval;

async function runBinanceFeed(
  container: ReturnType<typeof buildContainer>,
  cache: NoopOrderbookCache
) {
  const feed = new BinanceMarketFeed();
  await feed.connect();
  log.info("Binance feed connected");

  for (const symbol of SYMBOLS_COINDCX) {
    const maintainer = new OrderbookMaintainer(symbol, "binance");

    // Depth20 @100ms
    (async () => {
      for await (const snapshot of feed.subscribeOrderbook(symbol)) {
        maintainer.applySnapshot(snapshot);
        container.eventBus.publish(DomainEvents.MARKET_ORDERBOOK_UPDATED, snapshot);
        await cache.saveSnapshot(snapshot);
      }
    })().catch((e) => log.error("depth error", { symbol, error: String(e) }));

    // bookTicker — fastest NBBO
    (async () => {
      for await (const bt of feed.subscribeBookTicker(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_BOOK_TICKER, bt);
        await cache.setLtp(symbol, (bt.bidPrice + bt.askPrice) / 2);
      }
    })().catch((e) => log.error("bookTicker error", { symbol, error: String(e) }));

    // AggTrades — taker flow
    (async () => {
      for await (const agg of feed.subscribeAggTrades(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_AGG_TRADE, agg);
      }
    })().catch((e) => log.error("aggTrade error", { symbol, error: String(e) }));

    // Mark price + funding rate
    (async () => {
      for await (const mp of feed.subscribeMarkPrice(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_MARK_PRICE, mp);
        await cache.setMarkPrice(symbol, mp.markPrice);
      }
    })().catch((e) => log.error("markPrice error", { symbol, error: String(e) }));

    (async () => {
      for await (const fr of feed.subscribeFundingRate(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_FUNDING_RATE, fr);
        await cache.setFundingRate(symbol, fr.rate);
      }
    })().catch((e) => log.error("funding error", { symbol, error: String(e) }));

    // Klines (closed only → MARKET_CANDLE_CLOSED)
    (async () => {
      for await (const candle of feed.subscribeCandles(symbol, CANDLE_INTERVAL)) {
        const event = candle.closed ? DomainEvents.MARKET_CANDLE_CLOSED : DomainEvents.MARKET_CANDLE_UPDATED;
        container.eventBus.publish(event, candle);
      }
    })().catch((e) => log.error("klines error", { symbol, error: String(e) }));
  }
}

async function runDeltaFeed(
  container: ReturnType<typeof buildContainer>,
  cache: NoopOrderbookCache
) {
  const config = loadConfig();
  if (!config.delta) {
    log.warn("Delta credentials not set — skipping Delta feed");
    return;
  }

  const feed = new DeltaMarketFeed(config.delta);
  await feed.connect();
  log.info("Delta feed connected");

  for (const symbol of SYMBOLS_DELTA) {
    (async () => {
      for await (const snapshot of feed.subscribeOrderbook(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_ORDERBOOK_UPDATED, snapshot);
        await cache.saveSnapshot(snapshot);
      }
    })().catch((e) => log.error("Delta depth error", { symbol, error: String(e) }));

    (async () => {
      for await (const tick of feed.subscribeTrades(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_TRADE_TICK, tick);
      }
    })().catch((e) => log.error("Delta trades error", { symbol, error: String(e) }));

    (async () => {
      for await (const mp of feed.subscribeMarkPrice(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_MARK_PRICE, mp);
        await cache.setMarkPrice(symbol, mp.markPrice);
      }
    })().catch((e) => log.error("Delta markPrice error", { symbol, error: String(e) }));

    (async () => {
      for await (const fr of feed.subscribeFundingRate(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_FUNDING_RATE, fr);
        await cache.setFundingRate(symbol, fr.rate);
      }
    })().catch((e) => log.error("Delta funding error", { symbol, error: String(e) }));

    (async () => {
      for await (const oi of feed.subscribeOpenInterest(symbol)) {
        container.eventBus.publish(DomainEvents.MARKET_OPEN_INTEREST, oi);
        await cache.setOpenInterest(symbol, oi.openInterest);
      }
    })().catch((e) => log.error("Delta OI error", { symbol, error: String(e) }));
  }
}

async function main() {
  log.info("starting market-data worker");
  const config = loadConfig();
  const container = buildContainer(config);
  const cache = new NoopOrderbookCache(); // replace with RedisOrderbookCache when Redis is configured

  for (const [name, gw] of container.gateways) {
    await gw.connect().catch((e) =>
      log.error("gateway connect failed", { exchange: name, error: String(e) })
    );
  }

  const tasks: Promise<void>[] = [];

  if (config.exchanges.includes("coindcx")) tasks.push(runBinanceFeed(container, cache));
  if (config.exchanges.includes("delta")) tasks.push(runDeltaFeed(container, cache));

  await Promise.all(tasks);
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
