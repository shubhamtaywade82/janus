/**
 * SymbolMapping — single source of truth for cross-exchange symbol translation.
 * Strategies operate on `strategySymbol` only. Infrastructure adapters translate
 * to/from exchange-native representations using this registry.
 */
export interface SymbolMapping {
  /** Canonical, uppercase. Used by domain layer. e.g. "BTCUSDT" */
  strategySymbol: string;
  /** Binance WS stream name (lowercase). e.g. "btcusdt" */
  binanceSymbol: string;
  /** Binance REST symbol (uppercase). e.g. "BTCUSDT" */
  binanceRestSymbol: string;
  /** CoinDCX native pair. e.g. "B-BTC_USDT" */
  coindcxSymbol: string;
  /** Delta Exchange perpetual symbol. e.g. "BTCUSDT" (Delta India) */
  deltaSymbol: string;
}

export type ExchangeSymbolKey = keyof Pick<
  SymbolMapping,
  "binanceSymbol" | "binanceRestSymbol" | "coindcxSymbol" | "deltaSymbol"
>;

export class SymbolRegistry {
  private readonly byStrategy = new Map<string, SymbolMapping>();
  private readonly byBinance = new Map<string, SymbolMapping>();
  private readonly byCoinDCX = new Map<string, SymbolMapping>();
  private readonly byDelta = new Map<string, SymbolMapping>();

  constructor(mappings: SymbolMapping[]) {
    for (const m of mappings) {
      this.byStrategy.set(m.strategySymbol.toUpperCase(), m);
      this.byBinance.set(m.binanceSymbol.toLowerCase(), m);
      this.byBinance.set(m.binanceRestSymbol.toUpperCase(), m);
      this.byCoinDCX.set(m.coindcxSymbol, m);
      this.byDelta.set(m.deltaSymbol, m);
    }
  }

  fromStrategy(symbol: string): SymbolMapping | undefined {
    return this.byStrategy.get(symbol.toUpperCase());
  }

  fromBinance(symbol: string): SymbolMapping | undefined {
    return this.byBinance.get(symbol.toLowerCase()) ?? this.byBinance.get(symbol.toUpperCase());
  }

  fromCoinDCX(symbol: string): SymbolMapping | undefined {
    return this.byCoinDCX.get(symbol);
  }

  fromDelta(symbol: string): SymbolMapping | undefined {
    return this.byDelta.get(symbol);
  }

  all(): SymbolMapping[] {
    return [...this.byStrategy.values()];
  }
}

/** Default supported pairs */
export const DEFAULT_SYMBOL_MAPPINGS: SymbolMapping[] = [
  {
    strategySymbol: "BTCUSDT",
    binanceSymbol: "btcusdt",
    binanceRestSymbol: "BTCUSDT",
    coindcxSymbol: "B-BTC_USDT",
    deltaSymbol: "BTCUSDT",
  },
  {
    strategySymbol: "ETHUSDT",
    binanceSymbol: "ethusdt",
    binanceRestSymbol: "ETHUSDT",
    coindcxSymbol: "B-ETH_USDT",
    deltaSymbol: "ETHUSDT",
  },
  {
    strategySymbol: "SOLUSDT",
    binanceSymbol: "solusdt",
    binanceRestSymbol: "SOLUSDT",
    coindcxSymbol: "B-SOL_USDT",
    deltaSymbol: "SOLUSDT",
  },
  {
    strategySymbol: "BNBUSDT",
    binanceSymbol: "bnbusdt",
    binanceRestSymbol: "BNBUSDT",
    coindcxSymbol: "B-BNB_USDT",
    deltaSymbol: "BNBUSDT",
  },
  {
    strategySymbol: "XRPUSDT",
    binanceSymbol: "xrpusdt",
    binanceRestSymbol: "XRPUSDT",
    coindcxSymbol: "B-XRP_USDT",
    deltaSymbol: "XRPUSDT",
  },
];
