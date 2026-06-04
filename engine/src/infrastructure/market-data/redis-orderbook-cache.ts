/**
 * Redis orderbook cache
 * Stores live orderbook state and computed metrics so workers (signal, risk)
 * can read without holding a WebSocket connection.
 *
 * Key schema:
 *   orderbook:{symbol}          → JSON OrderbookSnapshot
 *   spread:{symbol}             → number (string)
 *   imbalance:{symbol}          → number (string)
 *   ltp:{symbol}                → number (string)
 *   mark_price:{symbol}         → number (string)
 *   open_interest:{symbol}      → number (string)
 *   funding_rate:{symbol}       → number (string)
 *
 * This module is optional — if Redis is not configured the engine
 * falls back to in-memory state.
 */

import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { OrderbookMetrics } from "../../domain/market-data/orderbook.js";
import { OrderbookMaintainer } from "./orderbook-maintainer.js";

export interface RedisLike {
  set(key: string, value: string, ex?: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
}

const DEFAULT_TTL_S = 10; // expire keys after 10s of silence

export class RedisOrderbookCache {
  constructor(private readonly redis: RedisLike, private readonly ttl = DEFAULT_TTL_S) {}

  async saveSnapshot(snapshot: OrderbookSnapshot): Promise<void> {
    const key = `orderbook:${snapshot.symbol}`;
    await this.redis.set(key, JSON.stringify(snapshot), this.ttl);

    // Derive and cache metrics
    const m = new OrderbookMaintainer(snapshot.symbol, snapshot.exchange);
    m.applySnapshot(snapshot);
    const metrics = m.metrics();
    if (metrics) {
      await this.saveMetrics(snapshot.symbol, metrics);
    }
  }

  async saveMetrics(symbol: string, metrics: OrderbookMetrics): Promise<void> {
    await Promise.all([
      this.redis.set(`spread:${symbol}`, String(metrics.spread), this.ttl),
      this.redis.set(`imbalance:${symbol}`, String(metrics.imbalance), this.ttl),
    ]);
  }

  async getSnapshot(symbol: string): Promise<OrderbookSnapshot | null> {
    const raw = await this.redis.get(`orderbook:${symbol}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as OrderbookSnapshot; } catch { return null; }
  }

  async getSpread(symbol: string): Promise<number | null> {
    const v = await this.redis.get(`spread:${symbol}`);
    return v !== null ? parseFloat(v) : null;
  }

  async getImbalance(symbol: string): Promise<number | null> {
    const v = await this.redis.get(`imbalance:${symbol}`);
    return v !== null ? parseFloat(v) : null;
  }

  async setLtp(symbol: string, ltp: number): Promise<void> {
    await this.redis.set(`ltp:${symbol}`, String(ltp), this.ttl);
  }

  async getLtp(symbol: string): Promise<number | null> {
    const v = await this.redis.get(`ltp:${symbol}`);
    return v !== null ? parseFloat(v) : null;
  }

  async setMarkPrice(symbol: string, price: number): Promise<void> {
    await this.redis.set(`mark_price:${symbol}`, String(price), this.ttl * 6);
  }

  async setFundingRate(symbol: string, rate: number): Promise<void> {
    await this.redis.set(`funding_rate:${symbol}`, String(rate), 3600);
  }

  async setOpenInterest(symbol: string, oi: number): Promise<void> {
    await this.redis.set(`open_interest:${symbol}`, String(oi), this.ttl * 6);
  }
}

/**
 * No-op cache for when Redis is not configured.
 * Satisfies the interface so callers need no null checks.
 */
export class NoopOrderbookCache implements Pick<RedisOrderbookCache, "saveSnapshot" | "setLtp" | "setMarkPrice" | "setFundingRate" | "setOpenInterest"> {
  async saveSnapshot(_s: OrderbookSnapshot): Promise<void> {}
  async setLtp(_sym: string, _v: number): Promise<void> {}
  async setMarkPrice(_sym: string, _v: number): Promise<void> {}
  async setFundingRate(_sym: string, _v: number): Promise<void> {}
  async setOpenInterest(_sym: string, _v: number): Promise<void> {}
}
