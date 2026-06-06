import { describe, it, expect } from "vitest";
import { policyGuard, type PortfolioConstraints } from "../policy-guard";
import { PositionAction as PA } from "../types";
import type { AiRecommendation, ManagedPosition } from "../types";

// Minimal stubs — the FULL_EXIT confidence gate only reads action + confidence.
const position = { side: "LONG", unrealizedPnl: 5, stopLoss: null } as unknown as ManagedPosition;
const portfolio: PortfolioConstraints = {
  availableBalance: 1000,
  totalEquityUsdt: 1000,
  openPositionCount: 1,
};

function rec(confidence: number): AiRecommendation {
  return {
    action: PA.FULL_EXIT,
    confidence,
    reasoning: "test",
    source: "AI",
  } as AiRecommendation;
}

describe("policyGuard — FULL_EXIT confidence gate", () => {
  it("downgrades FULL_EXIT to TIGHTEN_TP below 75% confidence", () => {
    const r = policyGuard(rec(0.70), position, portfolio);
    expect(r.action).toBe(PA.TIGHTEN_TP);
    expect(r.reason).toContain("75%");
  });

  it("downgrades at the 0.74 boundary", () => {
    expect(policyGuard(rec(0.74), position, portfolio).action).toBe(PA.TIGHTEN_TP);
  });

  it("approves FULL_EXIT at 0.75 and above", () => {
    const r = policyGuard(rec(0.75), position, portfolio);
    expect(r.approved).toBe(true);
    expect(r.action).toBe(PA.FULL_EXIT);
  });

  it("approves a high-confidence FULL_EXIT", () => {
    expect(policyGuard(rec(0.9), position, portfolio).action).toBe(PA.FULL_EXIT);
  });
});
