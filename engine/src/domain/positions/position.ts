import type { PositionSide, ExchangeId } from "../common/types.js";

export interface Position {
  symbol: string;
  exchange: ExchangeId;
  side: PositionSide;
  netQuantity: number;
  averageEntryPrice: number;
  markPrice: number;
  liquidationPrice?: number;
  leverage: number;
  margin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  openedAt?: number;
  closedAt?: number;
}
