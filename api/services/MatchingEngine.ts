import Redis from "ioredis";
import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const engineQueue = new Queue("EngineExecution", { connection: redis as any });

export class MatchingEngine {
  /**
   * Evaluates live ticks against active local target registries.
   */
  public static async processIncomingTick(
    symbol: string,
    currentLtp: string
  ): Promise<void> {
    const ltp = parseFloat(currentLtp);
    if (isNaN(ltp)) return;

    // Cache the latest values into the global Redis state
    await redis.hset(
      `market:ticker:${symbol}`,
      "ltp",
      currentLtp,
      "updatedAt",
      Date.now().toString()
    );

    // ─── Trigger Matching ───
    // Buy limit orders: trigger when ltp <= limitPrice (score >= ltp, i.e. score in [ltp, +inf])
    // Buy stop orders: trigger when ltp >= stopPrice (score <= ltp, i.e. score in [-inf, ltp])
    const triggeredBuysLimit = await redis.zrangebyscore(
      `orders:trigger:buy:${symbol}`,
      ltp,
      "+inf"
    );
    const triggeredBuysStop = await redis.zrangebyscore(
      `orders:trigger:buy:${symbol}`,
      "-inf",
      ltp
    );

    // Sell limit orders: trigger when ltp >= limitPrice (score <= ltp, i.e. score in [-inf, ltp])
    // Sell stop orders: trigger when ltp <= stopPrice (score >= ltp, i.e. score in [ltp, +inf])
    const triggeredSellsLimit = await redis.zrangebyscore(
      `orders:trigger:sell:${symbol}`,
      "-inf",
      ltp
    );
    const triggeredSellsStop = await redis.zrangebyscore(
      `orders:trigger:sell:${symbol}`,
      ltp,
      "+inf"
    );

    const triggeredBuys = [...triggeredBuysLimit, ...triggeredBuysStop];
    const triggeredSells = [...triggeredSellsLimit, ...triggeredSellsStop];

    // Deduplicate just in case of overlap
    const buyTriggers = Array.from(new Set(triggeredBuys));
    const sellTriggers = Array.from(new Set(triggeredSells));

    for (const clientOrderId of buyTriggers) {
      const removed = await redis.zrem(
        `orders:trigger:buy:${symbol}`,
        clientOrderId
      );
      if (removed > 0) {
        await engineQueue.add(
          "ExecuteMatch",
          {
            clientOrderId,
            executionPrice: currentLtp,
            timestamp: Date.now(),
          },
          { attempts: 3, backoff: 500 }
        );
      }
    }

    for (const clientOrderId of sellTriggers) {
      const removed = await redis.zrem(
        `orders:trigger:sell:${symbol}`,
        clientOrderId
      );
      if (removed > 0) {
        await engineQueue.add(
          "ExecuteMatch",
          {
            clientOrderId,
            executionPrice: currentLtp,
            timestamp: Date.now(),
          },
          { attempts: 3, backoff: 500 }
        );
      }
    }
  }

  /**
   * Registers a limit or stop order trigger in Redis.
   */
  public static async registerOrderTrigger(
    symbol: string,
    side: "BUY" | "SELL" | "buy" | "sell",
    price: string,
    clientOrderId: string
  ): Promise<void> {
    const score = parseFloat(price);
    if (isNaN(score)) return;

    const indexKey =
      side.toUpperCase() === "BUY"
        ? `orders:trigger:buy:${symbol}`
        : `orders:trigger:sell:${symbol}`;

    await redis.zadd(indexKey, score, clientOrderId);
  }

  /**
   * Removes an order trigger from Redis.
   */
  public static async removeOrderTrigger(
    symbol: string,
    side: "BUY" | "SELL" | "buy" | "sell",
    clientOrderId: string
  ): Promise<void> {
    const indexKey =
      side.toUpperCase() === "BUY"
        ? `orders:trigger:buy:${symbol}`
        : `orders:trigger:sell:${symbol}`;

    await redis.zrem(indexKey, clientOrderId);
  }
}
export { redis };
