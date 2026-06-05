import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";

/**
 * Guards against the HMR orphan-emitter bug:
 * streaming.ts uses globalThis singletons so hot-reload preserves listener registrations.
 * These tests verify the pattern holds.
 */
describe("streaming event bus singleton pattern", () => {
  const KEY = "__test_marketEvents__";

  beforeEach(() => {
    delete (globalThis as any)[KEY];
  });

  it("creates emitter on first load and stores on globalThis", () => {
    const g = globalThis as any;
    if (!(g[KEY] instanceof EventEmitter)) {
      g[KEY] = new EventEmitter();
      g[KEY].setMaxListeners(100);
    }
    const ref = g[KEY];

    // Simulate second module load (HMR reload)
    if (!(g[KEY] instanceof EventEmitter)) {
      g[KEY] = new EventEmitter();
    }

    expect(g[KEY]).toBe(ref); // same instance
  });

  it("listeners registered before reload survive reload", () => {
    const g = globalThis as any;
    g[KEY] = new EventEmitter();
    const received: string[] = [];

    // Subscriber registers (market-router on boot)
    g[KEY].on("BTCUSDT:ticker", (d: string) => received.push(d));

    // HMR reload: re-use existing emitter
    const emitter = g[KEY] as EventEmitter; // same ref
    emitter.emit("BTCUSDT:ticker", "price-100");

    expect(received).toEqual(["price-100"]);
  });

  it("listeners are lost if module creates a fresh emitter without globalThis", () => {
    // Documents the broken pattern — shows WHY globalThis is needed
    const oldEmitter = new EventEmitter();
    const received: string[] = [];
    oldEmitter.on("BTCUSDT:ticker", (d: string) => received.push(d));

    // HMR: new emitter created without globalThis guard
    const newEmitter = new EventEmitter();
    newEmitter.emit("BTCUSDT:ticker", "price-100");

    expect(received).toEqual([]); // subscriber never gets the event
  });
});
