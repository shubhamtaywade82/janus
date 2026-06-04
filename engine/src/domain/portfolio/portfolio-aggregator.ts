import type { Position } from "../positions/position.js";
import type { Portfolio } from "./portfolio.js";
import type { ExchangeId } from "../common/types.js";

export class PortfolioAggregator {
  static fromPositions(
    accountId: string,
    exchange: ExchangeId,
    cashBalance: number,
    positions: Position[],
    totalFees: number,
    totalRealizedPnl: number
  ): Portfolio {
    const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const usedMargin = positions.reduce((sum, p) => sum + p.margin, 0);
    const equity = cashBalance + unrealizedPnl;
    const freeMargin = equity - usedMargin;

    return {
      accountId,
      exchange,
      cashBalance,
      equity,
      usedMargin,
      freeMargin,
      realizedPnl: totalRealizedPnl,
      unrealizedPnl,
      totalFees,
      netProfit: totalRealizedPnl - totalFees,
      updatedAt: Date.now(),
    };
  }
}
