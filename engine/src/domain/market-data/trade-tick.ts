import type { Side } from "../common/types.js";

export interface TradeTick {
  id: string;
  symbol: string;
  exchange: string;
  price: number;
  quantity: number;
  side: Side;
  isMaker: boolean;
  ts: number;
}
