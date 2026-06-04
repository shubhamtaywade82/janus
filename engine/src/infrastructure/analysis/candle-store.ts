import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";

const CAPACITY = 500;

/**
 * Rolling fixed-capacity candle store per timeframe.
 * Upserts by openTime so a partially-closed candle can be updated in place.
 */
export class CandleStore {
  private readonly buf: Candle[] = [];
  private readonly capacity: number;

  constructor(
    readonly timeframe: CandleInterval,
    capacity = CAPACITY,
  ) {
    this.capacity = capacity;
  }

  /** Add or update a candle by openTime. */
  upsert(candle: Candle): void {
    const idx = this.buf.findIndex((c) => c.openTime === candle.openTime);
    if (idx !== -1) {
      this.buf[idx] = candle;
    } else {
      this.buf.push(candle);
      if (this.buf.length > this.capacity) this.buf.shift();
    }
  }

  /** Add multiple candles in bulk (seed from historical data). */
  seed(candles: Candle[]): void {
    for (const c of candles) this.upsert(c);
    // Trim to capacity
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  /** Most recent candles, oldest first. */
  get candles(): Candle[] {
    return this.buf.slice().sort((a, b) => a.openTime - b.openTime);
  }

  get size(): number {
    return this.buf.length;
  }

  latest(): Candle | undefined {
    return this.buf[this.buf.length - 1];
  }

  clear(): void {
    this.buf.length = 0;
  }
}

/**
 * Multi-timeframe candle store manager.
 * Holds one CandleStore per timeframe; single access point for the pipeline.
 */
export class MultiTimeframeCandleStore {
  private readonly stores = new Map<CandleInterval, CandleStore>();

  private getOrCreate(tf: CandleInterval): CandleStore {
    if (!this.stores.has(tf)) this.stores.set(tf, new CandleStore(tf));
    return this.stores.get(tf)!;
  }

  upsert(tf: CandleInterval, candle: Candle): void {
    this.getOrCreate(tf).upsert(candle);
  }

  seed(tf: CandleInterval, candles: Candle[]): void {
    this.getOrCreate(tf).seed(candles);
  }

  candles(tf: CandleInterval): Candle[] {
    return this.stores.get(tf)?.candles ?? [];
  }

  store(tf: CandleInterval): CandleStore {
    return this.getOrCreate(tf);
  }

  timeframes(): CandleInterval[] {
    return Array.from(this.stores.keys());
  }
}
