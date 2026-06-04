export class SizingPolicy {
  /**
   * Fixed fractional sizing: risk a fixed % of equity per trade,
   * using stop-loss distance to determine quantity.
   */
  static fixedFractional(params: {
    equity: number;
    riskPct: number;
    entryPrice: number;
    stopLossPrice: number;
    contractMultiplier: number;
  }): number {
    const { equity, riskPct, entryPrice, stopLossPrice, contractMultiplier } = params;
    const riskAmount = equity * riskPct;
    const priceDelta = Math.abs(entryPrice - stopLossPrice) * contractMultiplier;
    if (priceDelta <= 0) return 0;
    return riskAmount / priceDelta;
  }

  /** Clamp quantity to lot-size increments */
  static roundToLotSize(quantity: number, lotSize: number): number {
    return Math.floor(quantity / lotSize) * lotSize;
  }
}
