/**
 * Symbol precision utilities for CoinDCX futures.
 */

const SYMBOL_DEFAULTS: Record<string, { priceDecimals: number; qtyDecimals: number }> = {
  BTCUSDT: { priceDecimals: 2, qtyDecimals: 4 },
  ETHUSDT: { priceDecimals: 2, qtyDecimals: 4 },
  SOLUSDT: { priceDecimals: 2, qtyDecimals: 3 },
  BNBUSDT: { priceDecimals: 2, qtyDecimals: 3 },
  XRPUSDT: { priceDecimals: 4, qtyDecimals: 1 },
  ADAUSDT: { priceDecimals: 4, qtyDecimals: 1 },
  DOGEUSDT: { priceDecimals: 5, qtyDecimals: 0 },
  AVAXUSDT: { priceDecimals: 2, qtyDecimals: 2 },
};

/**
 * Format a price based on symbol base_currency_precision
 */
export function formatPrice(price: string | number | null | undefined, symbol?: string, precision?: number): string {
  if (price === null || price === undefined || price === "") return "--";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return "--";

  if (precision !== undefined) {
    return num.toFixed(precision);
  }

  if (symbol) {
    const cleanSym = symbol.replace("B-", "").replace("_", "");
    const decimals = SYMBOL_DEFAULTS[cleanSym]?.priceDecimals ?? 2;
    return num.toFixed(decimals);
  }

  return num.toFixed(2);
}

/**
 * Format a quantity/size based on symbol target_currency_precision
 */
export function formatQty(qty: string | number | null | undefined, symbol?: string, precision?: number): string {
  if (qty === null || qty === undefined || qty === "") return "--";
  const num = typeof qty === "string" ? parseFloat(qty) : qty;
  if (isNaN(num)) return "--";

  if (precision !== undefined) {
    return num.toFixed(precision);
  }

  if (symbol) {
    const cleanSym = symbol.replace("B-", "").replace("_", "");
    const decimals = SYMBOL_DEFAULTS[cleanSym]?.qtyDecimals ?? 4;
    return num.toFixed(decimals);
  }

  return num.toFixed(4);
}

/**
 * Get price decimals for a symbol
 */
export function getPriceDecimals(symbol?: string): number {
  if (!symbol) return 2;
  const cleanSym = symbol.replace("B-", "").replace("_", "");
  return SYMBOL_DEFAULTS[cleanSym]?.priceDecimals ?? 2;
}
