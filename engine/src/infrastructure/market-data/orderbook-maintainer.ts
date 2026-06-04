import type {
  OrderbookSnapshot,
  OrderbookUpdate,
  OrderLevel,
  OrderbookMetrics,
} from "../../domain/market-data/orderbook.js";

type SideMap = Map<number, number>;

export class OrderbookMaintainer {
  private bids: SideMap = new Map();
  private asks: SideMap = new Map();
  private _sequence = 0;
  private _symbol: string;
  private _exchange: string;

  constructor(symbol: string, exchange: string) {
    this._symbol = symbol;
    this._exchange = exchange;
  }

  get sequence(): number {
    return this._sequence;
  }

  applySnapshot(snapshot: OrderbookSnapshot): void {
    this.bids.clear();
    this.asks.clear();
    for (const level of snapshot.bids) this.bids.set(level.price, level.size);
    for (const level of snapshot.asks) this.asks.set(level.price, level.size);
    this._sequence = snapshot.sequence;
  }

  applyUpdate(update: OrderbookUpdate): boolean {
    if (update.sequence <= this._sequence) return false;
    const side = update.side === "buy" ? this.bids : this.asks;
    if (update.size <= 0) {
      side.delete(update.price);
    } else {
      side.set(update.price, update.size);
    }
    this._sequence = update.sequence;
    return true;
  }

  bestBid(): number | undefined {
    if (this.bids.size === 0) return undefined;
    return Math.max(...this.bids.keys());
  }

  bestAsk(): number | undefined {
    if (this.asks.size === 0) return undefined;
    return Math.min(...this.asks.keys());
  }

  spread(): number | undefined {
    const bid = this.bestBid();
    const ask = this.bestAsk();
    if (bid === undefined || ask === undefined) return undefined;
    return ask - bid;
  }

  metrics(depth = 10): OrderbookMetrics | null {
    const bid = this.bestBid();
    const ask = this.bestAsk();
    if (bid === undefined || ask === undefined) return null;

    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    const spreadBps = (spread / mid) * 10_000;

    const topBids = this.topLevels("bids", depth);
    const topAsks = this.topLevels("asks", depth);

    const bidDepth = topBids.reduce((s, l) => s + l.size, 0);
    const askDepth = topAsks.reduce((s, l) => s + l.size, 0);
    const total = bidDepth + askDepth;

    return {
      bestBid: bid,
      bestAsk: ask,
      spread,
      spreadBps,
      midPrice: mid,
      bidDepth,
      askDepth,
      imbalance: total > 0 ? (bidDepth - askDepth) / total : 0,
    };
  }

  topLevels(side: "bids" | "asks", depth: number): OrderLevel[] {
    const map = side === "bids" ? this.bids : this.asks;
    const prices = Array.from(map.keys());
    const sorted =
      side === "bids" ? prices.sort((a, b) => b - a) : prices.sort((a, b) => a - b);
    return sorted.slice(0, depth).map((price) => ({ price, size: map.get(price)! }));
  }

  toSnapshot(ts = Date.now()): OrderbookSnapshot {
    return {
      symbol: this._symbol,
      exchange: this._exchange,
      bids: this.topLevels("bids", 20),
      asks: this.topLevels("asks", 20),
      sequence: this._sequence,
      ts,
    };
  }
}
