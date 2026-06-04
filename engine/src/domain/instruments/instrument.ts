import type { ExchangeId } from "../common/types.js";

export interface Instrument {
  symbol: string;           // canonical symbol e.g. BTCUSDT
  exchange: ExchangeId;
  tickSize: number;
  lotSize: number;
  contractMultiplier: number;
  settlementCurrency: string;
  quoteCurrency: string;
  baseCurrency: string;
  feeMaker: number;
  feeTaker: number;
  /** Exchange-native symbol (e.g. "BTCUSD" for Delta, "B-BTC_USDT" for CoinDCX) */
  nativeSymbol: string;
  minOrderSize: number;
  maxLeverage: number;
}
