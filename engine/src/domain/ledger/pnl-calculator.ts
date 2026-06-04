import type { PositionSide } from "../common/types.js";

export class PnLCalculator {
  static realizedPnL(
    side: PositionSide,
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    contractMultiplier = 1
  ): number {
    if (side === "long") {
      return (exitPrice - entryPrice) * quantity * contractMultiplier;
    }
    return (entryPrice - exitPrice) * quantity * contractMultiplier;
  }

  static unrealizedPnL(
    side: PositionSide,
    entryPrice: number,
    markPrice: number,
    quantity: number,
    contractMultiplier = 1
  ): number {
    return this.realizedPnL(side, entryPrice, markPrice, quantity, contractMultiplier);
  }

  static netProfit(realizedPnl: number, totalFees: number): number {
    return realizedPnl - totalFees;
  }

  static roe(pnl: number, margin: number): number {
    if (margin <= 0) return 0;
    return pnl / margin;
  }
}
