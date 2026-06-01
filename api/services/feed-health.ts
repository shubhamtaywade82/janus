import { EventEmitter } from "events";

export type FeedStatus = "connected" | "degraded" | "reconnecting" | "rest_fallback";

export const feedHealthEvents = new EventEmitter();
feedHealthEvents.setMaxListeners(50);

export function calcBackoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 32_000);
}

export class FeedHealth {
  symbol: string;
  status: FeedStatus = "connected";
  lastMessageAt: number = Date.now();
  reconnectAttempts: number = 0;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  recordMessage() {
    this.lastMessageAt = Date.now();
    if (this.status !== "connected") {
      this.status = "connected";
      this.reconnectAttempts = 0;
      feedHealthEvents.emit("recovered", { symbol: this.symbol });
    }
  }

  tick() {
    const silenceMs = Date.now() - this.lastMessageAt;
    if (silenceMs > 10_000 && this.status !== "reconnecting") {
      this.status = "reconnecting";
      this.reconnectAttempts++;
      feedHealthEvents.emit("reconnecting", {
        symbol: this.symbol,
        attempt: this.reconnectAttempts,
        backoffMs: calcBackoffMs(this.reconnectAttempts - 1),
      });
    } else if (silenceMs > 3_000 && this.status === "connected") {
      this.status = "degraded";
      feedHealthEvents.emit("degraded", { symbol: this.symbol });
    }
  }

  backoffMs(): number {
    return calcBackoffMs(this.reconnectAttempts);
  }
}

export const feedHealthRegistry = new Map<string, FeedHealth>();

export function getOrCreateFeedHealth(symbol: string): FeedHealth {
  if (!feedHealthRegistry.has(symbol)) {
    feedHealthRegistry.set(symbol, new FeedHealth(symbol));
  }
  return feedHealthRegistry.get(symbol)!;
}
