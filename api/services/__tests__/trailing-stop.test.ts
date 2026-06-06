import { describe, it, expect } from "vitest";
import { calcNewTrailingStop, shouldStopOut } from "../trailing-stop";

describe("calcNewTrailingStop — LONG", () => {
  it("moves stop up when price rises", () => {
    // stop=99, price=102, trail=1% → candidate=100.98 > 99 → use 100.98
    const s = calcNewTrailingStop("long", 99, 102, 0.01, [], 102);
    expect(s).toBeCloseTo(100.98, 1);
  });

  it("does NOT move stop down when price falls", () => {
    // stop=101, price=100, trail=1% → candidate=99 < 101 → keep 101
    expect(calcNewTrailingStop("long", 101, 100, 0.01, [], 100)).toBe(101);
  });

  it("ratchets incrementally as price keeps rising", () => {
    let stop = 99;
    stop = calcNewTrailingStop("long", stop, 101, 0.01, [], 101); // 99.99
    stop = calcNewTrailingStop("long", stop, 103, 0.01, [], 103); // 101.97
    stop = calcNewTrailingStop("long", stop, 105, 0.01, [], 105); // 103.95
    expect(stop).toBeCloseTo(103.95, 1);
  });
});

describe("calcNewTrailingStop — SHORT", () => {
  it("moves stop down when price falls", () => {
    // stop=101, price=98, trail=1% → candidate=98.98 < 101 → use 98.98
    const s = calcNewTrailingStop("short", 101, 98, 0.01, [], 98);
    expect(s).toBeCloseTo(98.98, 1);
  });

  it("does NOT move stop up when price rises", () => {
    // stop=99, price=101, trail=1% → candidate=102.01 > 99 → keep 99
    expect(calcNewTrailingStop("short", 99, 101, 0.01, [], 101)).toBe(99);
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
