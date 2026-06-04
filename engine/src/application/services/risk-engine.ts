import type { TradeSignal } from "../../domain/signals/trade-signal.js";
import type { Portfolio } from "../../domain/portfolio/portfolio.js";
import type { RiskDecision, RiskPolicyConfig } from "../../domain/risk/risk-policy.js";
import { DEFAULT_RISK_CONFIG } from "../../domain/risk/risk-policy.js";
import { SizingPolicy } from "../../domain/risk/sizing-policy.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import { DomainEvents } from "../../domain/common/events.js";

export class RiskEngine {
  constructor(
    private readonly config: RiskPolicyConfig = DEFAULT_RISK_CONFIG,
    private readonly eventBus?: EventBusPort
  ) {}

  evaluate(signal: TradeSignal, portfolio: Portfolio, openPositionCount: number): RiskDecision {
    if (signal.confidence < this.config.minConfidence) {
      return this.reject(`confidence ${signal.confidence.toFixed(2)} < ${this.config.minConfidence}`, signal);
    }

    if (openPositionCount >= this.config.maxOpenPositions) {
      return this.reject(`max open positions (${this.config.maxOpenPositions}) reached`, signal);
    }

    if (portfolio.equity <= 0) {
      return this.reject("zero or negative equity", signal);
    }

    const drawdown = portfolio.cashBalance > 0
      ? 1 - portfolio.equity / portfolio.cashBalance
      : 0;
    if (drawdown > this.config.maxDrawdownPct) {
      return this.reject(`drawdown ${(drawdown * 100).toFixed(1)}% exceeds limit`, signal);
    }

    let quantity = signal.quantity;

    if (signal.stopLoss && signal.entryPrice) {
      quantity = SizingPolicy.fixedFractional({
        equity: portfolio.equity,
        riskPct: this.config.maxRiskPctPerTrade,
        entryPrice: signal.entryPrice,
        stopLossPrice: signal.stopLoss,
        contractMultiplier: 1,
      });
    }

    if (quantity <= 0) {
      return this.reject("computed quantity is zero", signal);
    }

    const decision: RiskDecision = {
      approved: true,
      adjustedQuantity: quantity,
      maxLoss: portfolio.equity * this.config.maxRiskPctPerTrade,
    };

    this.eventBus?.publish(DomainEvents.RISK_APPROVED, { signal, decision });
    return decision;
  }

  private reject(reason: string, signal: TradeSignal): RiskDecision {
    const decision: RiskDecision = { approved: false, reason };
    this.eventBus?.publish(DomainEvents.RISK_REJECTED, { signal, reason });
    return decision;
  }
}
