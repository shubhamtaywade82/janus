import type {
  AiRecommendation,
  ManagedPosition,
  PolicyResult,
} from "./types";
import { PositionAction as PA } from "./types";
import { positionStore } from "./position-store";
import { isSlImprovement } from "./execution-manager";

// ─── Policy Guard ────────────────────────────────────────────────────────────
// Validates AI / code-based recommendations against hard risk rules.
// May downgrade the action (e.g., SCALE_IN → KEEP_OPEN) if constraints not met.

const MAX_CORRELATION_SAME_SIDE = 4;   // max open positions on same side
const MIN_FREE_MARGIN_FOR_SCALE = 50;  // USDT

export interface PortfolioConstraints {
  availableBalance: number;
  totalEquityUsdt: number;
  openPositionCount: number;
}

export function policyGuard(
  recommendation: AiRecommendation,
  position: ManagedPosition,
  portfolio: PortfolioConstraints
): PolicyResult {
  const { action, confidence } = recommendation;

  // ── SCALE_IN: strict checks ─────────────────────────────────────────────
  if (action === PA.SCALE_IN) {
    if (portfolio.availableBalance < MIN_FREE_MARGIN_FOR_SCALE) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: `SCALE_IN rejected: insufficient free margin (${portfolio.availableBalance.toFixed(2)} < ${MIN_FREE_MARGIN_FOR_SCALE} USDT)`,
      };
    }

    const sameSide = positionStore.sameSideCount(position.side);
    if (sameSide >= MAX_CORRELATION_SAME_SIDE) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: `SCALE_IN rejected: correlation limit reached (${sameSide} ${position.side} positions open)`,
      };
    }

    const positionRisk = position.margin / portfolio.totalEquityUsdt;
    if (positionRisk > 0.25) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: `SCALE_IN rejected: single-position risk already at ${(positionRisk * 100).toFixed(1)}% of equity`,
      };
    }

  }

  // ── FULL_EXIT / PARTIAL_EXIT: require minimum confidence ──────────────
  if (action === PA.FULL_EXIT && confidence < 0.75) {
    return {
      approved: true,
      action: PA.TIGHTEN_TP,
      reason: `FULL_EXIT downgraded to TIGHTEN_TP: confidence ${(confidence * 100).toFixed(0)}% < 75% threshold`,
    };
  }

  if (action === PA.PARTIAL_EXIT && confidence < 0.45) {
    return {
      approved: false,
      action: PA.KEEP_OPEN,
      reason: `PARTIAL_EXIT rejected: confidence ${(confidence * 100).toFixed(0)}% < 45% threshold`,
    };
  }

  // ── TRAIL_SL: ensure new SL is better than current ────────────────────
  if (action === PA.TRAIL_SL && recommendation.newStopLoss !== undefined) {
    const newSl = recommendation.newStopLoss;
    const currentSl = position.stopLoss;
    if (currentSl !== null) {
      if (!isSlImprovement(position.side, currentSl, newSl)) {
        return {
          approved: false,
          action: PA.KEEP_OPEN,
          reason: `TRAIL_SL rejected: new SL (${newSl.toFixed(4)}) is worse than current (${currentSl.toFixed(4)})`,
        };
      }
    }
  }

  // ── MOVE_TO_BREAKEVEN: only if profitable ────────────────────────────
  if (action === PA.MOVE_TO_BREAKEVEN) {
    if (position.unrealizedPnl <= 0) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: "MOVE_TO_BREAKEVEN rejected: position not yet in profit",
      };
    }
  }

  // All checks passed
  return {
    approved: true,
    action,
    reason: "Policy checks passed",
  };
}
