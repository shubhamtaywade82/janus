import Decimal from "decimal.js";
import { getDb } from "../queries/connection";
import { tradingAccounts } from "@db/schema";
import { and, eq } from "drizzle-orm";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL" | "buy" | "sell";
  orderType: "MARKET" | "LIMIT" | "market" | "limit";
  quantity: string;
  price: string;
  leverage: number;
  stopLoss?: string;
}

export class RiskManager {
  private static MAINTENANCE_MARGIN_RATE = new Decimal("0.05"); // 5% MMR

  public static async validateOrder(
    userId: number,
    params: OrderParams,
    isPaper: boolean,
    currency: "USDT" | "INR" = "USDT"
  ): Promise<boolean> {
    if (params.leverage > 10) {
      throw new Error("Risk Breach: Maximum permitted leverage is 10x");
    }

    const qty = new Decimal(params.quantity);
    const price = new Decimal(params.price);
    const leverage = new Decimal(params.leverage);
    const side = params.side.toUpperCase();

    const notionalValue = qty.mul(price);
    const requiredMargin = notionalValue.div(leverage);

    const db = getDb();
    // Query existing tradingAccounts instead of the wallets table (using exact mode and currency)
    const account = await db.query.tradingAccounts.findFirst({
      where: and(
        eq(tradingAccounts.userId, userId),
        eq(tradingAccounts.mode, isPaper ? "paper" : "live"),
        eq(tradingAccounts.currency, currency)
      ),
    });

    if (!account || new Decimal(account.availableBalance).lt(requiredMargin)) {
      throw new Error(
        `Risk Breach: Insufficient margin. Allocated: ${requiredMargin.toFixed(8)} ${currency} required.`
      );
    }

    // Process structural buffer conditions
    if (params.stopLoss) {
      const stopLoss = new Decimal(params.stopLoss);
      const entryPrice = price;

      // Calculate liquidation target
      const liquidationPrice =
        side === "BUY"
          ? entryPrice.mul(
              new Decimal(1)
                .sub(new Decimal(1).div(leverage))
                .add(this.MAINTENANCE_MARGIN_RATE)
            )
          : entryPrice.mul(
              new Decimal(1)
                .add(new Decimal(1).div(leverage))
                .sub(this.MAINTENANCE_MARGIN_RATE)
            );

      const liqDistance = entryPrice.sub(liquidationPrice).abs();
      const stopDistance = entryPrice.sub(stopLoss).abs();

      if (liqDistance.lt(stopDistance.mul(2))) {
        throw new Error(
          "Risk Breach: Distance to liquidation must be at least twice the distance to stop loss."
        );
      }
    }

    return true;
  }
}
