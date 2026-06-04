import type { ExchangeId } from "../common/types.js";

export interface Portfolio {
  accountId: string;
  exchange: ExchangeId;
  cashBalance: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  netProfit: number;
  updatedAt: number;
}
