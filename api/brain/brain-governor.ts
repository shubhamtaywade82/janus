import { globalRiskEngine, getOrCreateSession } from "../services/risk-engine";
import { marketStateManager } from "../services/market-state";
import { getPaperWallet } from "../services/paper-wallet";
import type { BrainDecision } from "./schemas";

export interface GovernorOutcome {
  approved: boolean;
  reason?: string;
  adjustedSizePct?: number;
}

export const brainGovernor = {
  /**
   * Run safety checks on a proposed decision
   */
  check: async (
    userId: number,
    decision: BrainDecision,
    _marketData: any
  ): Promise<GovernorOutcome> => {
    // 1. Stale feed check
    const now = Date.now();
    const state = marketStateManager.get(decision.symbol || "BTCUSDT");
    
    if (state && now - state.updatedAt > 5000) {
      return {
        approved: false,
        reason: `Price feed is stale: last update was ${((now - state.updatedAt) / 1000).toFixed(1)} seconds ago (max allowed: 5s)`,
      };
    }

    // 2. Reject size increases beyond deterministic cap
    let proposedSize = decision.sizePct || 0;
    if (decision.mode === "enter") {
      if (proposedSize > 5.0) {
        console.warn(`[Governor] Reducing proposed size from ${proposedSize}% to safety cap 5.0%`);
        proposedSize = 5.0;
      }
    }

    // 3. Run primary RiskEngine logic
    const wallet = await getPaperWallet(userId);
    const session = await getOrCreateSession(userId, wallet.equity);

    const checkResult = globalRiskEngine.checkTradeAllowed(session, {
      walletBalance: wallet.balance,
      notional: wallet.equity * (proposedSize / 100),
      usedMargin: wallet.lockedMargin,
    });

    if (!checkResult.approved) {
      return {
        approved: false,
        reason: `Risk Engine block: ${checkResult.reason}`,
      };
    }

    return {
      approved: true,
      adjustedSizePct: proposedSize,
    };
  }
};
