import { describe, it, expect } from "vitest";
import { PnLCalculator } from "../ledger/pnl-calculator.js";

describe("PnLCalculator", () => {
  it("computes long realized PnL correctly", () => {
    const pnl = PnLCalculator.realizedPnL("long", 100, 110, 10, 1);
    expect(pnl).toBeCloseTo(100);
  });

  it("computes short realized PnL correctly", () => {
    const pnl = PnLCalculator.realizedPnL("short", 100, 90, 10, 1);
    expect(pnl).toBeCloseTo(100);
  });

  it("returns negative PnL for a losing long", () => {
    const pnl = PnLCalculator.realizedPnL("long", 100, 90, 10, 1);
    expect(pnl).toBeCloseTo(-100);
  });

  it("applies contract multiplier", () => {
    const pnl = PnLCalculator.realizedPnL("long", 100, 110, 1, 10);
    expect(pnl).toBeCloseTo(100);
  });

  it("netProfit subtracts fees", () => {
    expect(PnLCalculator.netProfit(500, 30)).toBeCloseTo(470);
  });
});
