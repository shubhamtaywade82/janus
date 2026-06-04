import type { TradeSignal } from "../signals/trade-signal.js";
import type { Portfolio } from "../portfolio/portfolio.js";

export interface RiskDecision {
  approved: boolean;
  reason?: string;
  adjustedQuantity?: number;
  maxLoss?: number;
}

export interface RiskPolicyConfig {
  minConfidence: number;
  maxRiskPctPerTrade: number;
  maxOpenPositions: number;
  maxLeverage: number;
  maxDrawdownPct: number;
}

export const DEFAULT_RISK_CONFIG: RiskPolicyConfig = {
  minConfidence: 0.70,
  maxRiskPctPerTrade: 0.005,  // 0.5% of equity per trade
  maxOpenPositions: 5,
  maxLeverage: 10,
  maxDrawdownPct: 0.15,       // halt if drawdown > 15%
};
