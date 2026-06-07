import { describe, it, expect } from "vitest";
import { isSlImprovement } from "../execution-manager";

describe("isSlImprovement", () => {
  it("accepts a higher SL for LONG", () => {
    expect(isSlImprovement("LONG", 1600, 1650)).toBe(true);
  });

  it("rejects a lower SL for LONG", () => {
    expect(isSlImprovement("LONG", 1600, 1550)).toBe(false);
  });

  it("accepts a lower SL for SHORT", () => {
    expect(isSlImprovement("SHORT", 60000, 59000)).toBe(true);
  });

  it("rejects a higher SL for SHORT", () => {
    expect(isSlImprovement("SHORT", 60000, 61000)).toBe(false);
  });

  it("accepts any SL when current is null", () => {
    expect(isSlImprovement("LONG", null, 100)).toBe(true);
    expect(isSlImprovement("SHORT", null, 99999)).toBe(true);
  });

  it("rejects equal SL (strict inequality)", () => {
    expect(isSlImprovement("LONG", 1600, 1600)).toBe(false);
    expect(isSlImprovement("SHORT", 60000, 60000)).toBe(false);
  });
});
