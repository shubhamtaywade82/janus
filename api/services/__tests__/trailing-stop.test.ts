import { describe, it, expect } from "vitest";
import { calcNewTrailingStop, shouldStopOut } from "../trailing-stop";

describe("calcNewTrailingStop — LONG", () => {
  it("moves stop up when price rises", () => {
    // stop=99, price=102, trail=1%, entry=100 → candidate=100.98 > 99 → use 100.98
    const s = calcNewTrailingStop("long", 99, 102, 0.01, [], 100);
    expect(s).toBeCloseTo(100.98, 1);
  });

  it("does NOT move stop down when price falls", () => {
    // stop=101, price=100, trail=1%, entry=100 → keep 101
    expect(calcNewTrailingStop("long", 101, 100, 0.01, [], 100)).toBe(101);
  });

  it("ratchets incrementally as price keeps rising", () => {
    let stop = 99;
    stop = calcNewTrailingStop("long", stop, 101, 0.01, [], 100); // 99.99
    stop = calcNewTrailingStop("long", stop, 103, 0.01, [], 100); // 101.97
    stop = calcNewTrailingStop("long", stop, 105, 0.01, [], 100); // 103.95
    expect(stop).toBeCloseTo(103.95, 1);
  });
});

describe("calcNewTrailingStop — SHORT", () => {
  it("moves stop down when price falls", () => {
    // stop=101, price=98, trail=1%, entry=100 → candidate=98.98 < 101 → use 98.98
    const s = calcNewTrailingStop("short", 101, 98, 0.01, [], 100);
    expect(s).toBeCloseTo(98.98, 1);
  });

  it("does NOT move stop up when price rises", () => {
    // stop=99, price=101, trail=1%, entry=100 → keep 99
    expect(calcNewTrailingStop("short", 99, 101, 0.01, [], 100)).toBe(99);
  });
});

describe("calcNewTrailingStop — SHORT breakeven at 1:1 RR", () => {
  const TAKER_FEE = 0.0005;

  it("places breakeven BELOW entry (not above) with tight trail at 1:1 RR", () => {
    // entry=1000, trail=0.5%: initialRisk = 5. We test at 1:1 RR (price=995) to trigger breakeven
    const strategyCfg = {
      minPostBreakevenSlPct: 0.001, // 0.1% matches TAKER_FEE * 2
      tp1ActivationThresholdPct: 0.1,
      minAdverseMovePct: 0.001,
    };
    const stop = calcNewTrailingStop("short", 1005, 995, 0.005, [], 1000, strategyCfg);
    expect(stop).toBeLessThan(1000); // must be below entry
    expect(stop).toBeCloseTo(1000 * (1 - TAKER_FEE * 2), 2);
  });

  it("is a no-op when SL is already below breakeven", () => {
    // entry=1000, trail=0.5%, SL already at 985 (well below entry)
    const stop = calcNewTrailingStop("short", 985, 990, 0.005, [], 1000);
    expect(stop).toBeLessThanOrEqual(985);
    expect(stop).toBeLessThan(1000);
  });

  it("LONG breakeven stays above entry at 1:1 RR", () => {
    // entry=1000, trail=0.5%: initialRisk=5. Test at 1:1 RR (price=1005) to trigger breakeven
    const strategyCfg = {
      minPostBreakevenSlPct: 0.001,
      tp1ActivationThresholdPct: 0.1,
      minAdverseMovePct: 0.001,
    };
    const stop = calcNewTrailingStop("long", 995, 1005, 0.005, [], 1000, strategyCfg);
    expect(stop).toBeGreaterThan(1000);
    expect(stop).toBeCloseTo(1000 * (1 + TAKER_FEE * 2), 2);
  });
});

describe("shouldStopOut", () => {
  it("stops out long when price <= stop", () => {
    expect(shouldStopOut("long", 98.5, 99)).toBe(true);
    expect(shouldStopOut("long", 99.0, 99)).toBe(true);
    expect(shouldStopOut("long", 99.1, 99)).toBe(false);
  });

  it("stops out short when price >= stop", () => {
    expect(shouldStopOut("short", 101.0, 100.5)).toBe(true);
    expect(shouldStopOut("short", 100.5, 100.5)).toBe(true);
    expect(shouldStopOut("short", 100.4, 100.5)).toBe(false);
  });
});
