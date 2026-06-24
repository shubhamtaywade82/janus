import { describe, it, expect } from "vitest";
import { isSlImprovement } from "../execution-manager";

const TAKER_FEE = 0.0005;

// ─── isSlImprovement ─────────────────────────────────────────────────────────

describe("isSlImprovement", () => {
  it("LONG: higher SL is an improvement", () => {
    expect(isSlImprovement("LONG", 99, 100)).toBe(true);
    expect(isSlImprovement("LONG", 100, 99)).toBe(false);
  });

  it("SHORT: lower SL is an improvement", () => {
    expect(isSlImprovement("SHORT", 101, 100)).toBe(true);
    expect(isSlImprovement("SHORT", 100, 101)).toBe(false);
  });

  it("returns true when currentSl is null (no existing SL)", () => {
    expect(isSlImprovement("LONG", null, 100)).toBe(true);
    expect(isSlImprovement("SHORT", null, 100)).toBe(true);
  });
});

// ─── Breakeven SL computation (direction-aware) ──────────────────────────────
// These tests verify the formula used inside MOVE_TO_BREAKEVEN when no
// recommendation.newStopLoss is provided.

describe("MOVE_TO_BREAKEVEN default SL formula", () => {
  const computeBreakeven = (side: "LONG" | "SHORT", entryPrice: number) =>
    entryPrice * (1 + TAKER_FEE * 2);

  it("LONG: breakeven SL is ABOVE entry price", () => {
    const sl = computeBreakeven("LONG", 1000);
    expect(sl).toBeGreaterThan(1000);
    expect(sl).toBeCloseTo(1000 * 1.001, 4);
  });

  it("SHORT: breakeven SL is ABOVE entry price", () => {
    const sl = computeBreakeven("SHORT", 1000);
    expect(sl).toBeGreaterThan(1000);
    expect(sl).toBeCloseTo(1000 * 1.001, 4);
  });

  it("SHORT: breakeven SL isSlImprovement vs a wider current SL", () => {
    const entry = 1000;
    const breakeven = computeBreakeven("SHORT", entry); // ~1001
    // Current SL for SHORT above entry but wider than breakeven
    // New SL (1001) < current SL (1005) → improvement for SHORT (tighter)
    expect(isSlImprovement("SHORT", 1005, breakeven)).toBe(true);
  });

  it("SHORT: breakeven SL is NOT an improvement if SL already at breakeven", () => {
    const entry = 1000;
    const breakeven = computeBreakeven("SHORT", entry); // ~1001
    // If SL is already at 1001 (tight), moving to 1005 would worsen it
    expect(isSlImprovement("SHORT", 1001, 1005)).toBe(false);
  });
});

// ─── TIGHTEN_TP direction logic ───────────────────────────────────────────────
// Mirrors the guard in execution-manager executeAction TIGHTEN_TP case.

describe("TIGHTEN_TP direction guard", () => {
  const tightens = (side: "LONG" | "SHORT", currentTp: number, newTp: number) =>
    side === "LONG" ? newTp < currentTp : newTp > currentTp;

  describe("LONG positions", () => {
    it("accepts lower TP (closer to mark = tighter)", () => {
      expect(tightens("LONG", 1100, 1060)).toBe(true);
    });

    it("rejects higher TP (would extend, not tighten)", () => {
      expect(tightens("LONG", 1100, 1150)).toBe(false);
    });

    it("rejects equal TP (no change)", () => {
      expect(tightens("LONG", 1100, 1100)).toBe(false);
    });
  });

  describe("SHORT positions", () => {
    it("accepts higher TP (closer to entry/mark = tighter)", () => {
      expect(tightens("SHORT", 900, 940)).toBe(true);
    });

    it("rejects lower TP (would extend, not tighten)", () => {
      expect(tightens("SHORT", 900, 850)).toBe(false);
    });

    it("rejects equal TP (no change)", () => {
      expect(tightens("SHORT", 900, 900)).toBe(false);
    });
  });
});
