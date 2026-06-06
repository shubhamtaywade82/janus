import type { Fill } from "../fills/fill.js";
import type { Position } from "./position.js";
import type { PositionSide, ExchangeId } from "../common/types.js";

/**
 * Derives position state purely from fills (fill-ledger-first invariant).
 */
export class PositionAggregator {
  static fromFills(
    symbol: string,
    exchange: ExchangeId,
    fills: Fill[],
    markPrice: number,
    contractMultiplier = 1
  ): Position | null {
    let netQty = 0;
    let totalBuyQty = 0;
    let totalBuyNotional = 0;
    let totalSellQty = 0;
    let totalSellNotional = 0;
    let totalFees = 0;
    const realizedPnl = 0;
    let openedAt: number | undefined;

    const sorted = [...fills].sort((a, b) => a.ts - b.ts);

    for (const fill of sorted) {
      totalFees += fill.fee;
      if (fill.side === "buy") {
        totalBuyQty += fill.quantity;
        totalBuyNotional += fill.price * fill.quantity * contractMultiplier;
        netQty += fill.quantity;
        if (!openedAt) openedAt = fill.ts;
      } else {
        totalSellQty += fill.quantity;
        totalSellNotional += fill.price * fill.quantity * contractMultiplier;
        netQty -= fill.quantity;
      }
    }

    if (Math.abs(netQty) < 1e-10) return null;

    const side: PositionSide = netQty > 0 ? "long" : "short";
    const avgEntry =
      side === "long"
        ? totalBuyNotional / totalBuyQty / contractMultiplier
        : totalSellNotional / totalSellQty / contractMultiplier;

    const quantity = Math.abs(netQty);
    const unrealizedPnl =
      side === "long"
        ? (markPrice - avgEntry) * quantity * contractMultiplier
        : (avgEntry - markPrice) * quantity * contractMultiplier;

    return {
      symbol,
      exchange,
      side,
      netQuantity: quantity,
      averageEntryPrice: avgEntry,
      markPrice,
      leverage: 1,
      margin: 0,
      realizedPnl,
      unrealizedPnl,
      totalFees,
      openedAt,
    };
  }
}
