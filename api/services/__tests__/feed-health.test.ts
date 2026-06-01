import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedHealth, calcBackoffMs } from "../feed-health";

describe("calcBackoffMs", () => {
  it("returns 1000ms on first attempt (attempt=0)", () => {
    expect(calcBackoffMs(0)).toBe(1000);
  });
  it("doubles each attempt", () => {
    expect(calcBackoffMs(1)).toBe(2000);
    expect(calcBackoffMs(2)).toBe(4000);
    expect(calcBackoffMs(3)).toBe(8000);
    expect(calcBackoffMs(4)).toBe(16000);
    expect(calcBackoffMs(5)).toBe(32000);
  });
  it("caps at 32000ms", () => {
    expect(calcBackoffMs(10)).toBe(32000);
    expect(calcBackoffMs(20)).toBe(32000);
  });
});

describe("FeedHealth", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("starts in connected status with 0 reconnect attempts", () => {
    const h = new FeedHealth("BTCUSDT");
    expect(h.status).toBe("connected");
    expect(h.reconnectAttempts).toBe(0);
  });

  it("stays connected after receiving a message", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(2000);
    h.tick();
    expect(h.status).toBe("connected");
  });

  it("marks degraded after 3s silence", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(3100);
    h.tick();
    expect(h.status).toBe("degraded");
  });

  it("marks reconnecting after 10s silence", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(10_100);
    h.tick();
    expect(h.status).toBe("reconnecting");
    expect(h.reconnectAttempts).toBe(1);
  });

  it("resets to connected and clears attempts on new message", () => {
    const h = new FeedHealth("BTCUSDT");
    h.recordMessage();
    vi.advanceTimersByTime(10_100);
    h.tick();
    expect(h.status).toBe("reconnecting");
    h.recordMessage();
    expect(h.status).toBe("connected");
    expect(h.reconnectAttempts).toBe(0);
  });

  it("backoffMs returns correct value based on attempts", () => {
    const h = new FeedHealth("BTCUSDT");
    h.reconnectAttempts = 3;
    expect(h.backoffMs()).toBe(8000); // calcBackoffMs(3-1=2) = 4000? No: backoffMs uses reconnectAttempts-1
    // Wait: backoffMs() = calcBackoffMs(reconnectAttempts) — let me verify implementation
    // In feed-health.ts: backoffMs() { return calcBackoffMs(this.reconnectAttempts); }
    // calcBackoffMs(3) = Math.min(1000 * 2^3, 32000) = 8000
    expect(h.backoffMs()).toBe(8000);
  });
});
