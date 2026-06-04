export class FeeCalculator {
  static feeFromNotional(notional: number, feeRate: number): number {
    return notional * feeRate;
  }

  static notional(price: number, quantity: number, contractMultiplier = 1): number {
    return price * quantity * contractMultiplier;
  }

  static totalFeeForOrder(
    price: number,
    quantity: number,
    contractMultiplier: number,
    isMaker: boolean,
    makerRate: number,
    takerRate: number
  ): number {
    const notional = this.notional(price, quantity, contractMultiplier);
    return this.feeFromNotional(notional, isMaker ? makerRate : takerRate);
  }
}
