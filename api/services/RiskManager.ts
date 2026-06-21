import Decimal from "decimal.js";
import { getDb } from "../queries/connection";
import { tradingAccounts } from "@db/schema";
import { and, eq } from "drizzle-orm";
import { usdtToWallet } from "./paper-currency";
import { MAX_SYSTEM_LEVERAGE } from "../../contracts/constants";
import { getFuturesInstrumentInfo } from "./coindcx";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL" | "buy" | "sell";
  orderType: "MARKET" | "LIMIT" | "market" | "limit";
  quantity: string;
  price: string;
  leverage: number;
  stopLoss?: string;
  takeProfit?: string;
}

// Exchange-specific MMR cache (Binance futures MMR ≈ 0.4% for most pairs)
const MMR_CACHE = new Map<string, { rate: Decimal; fetchedAt: number }>();
const MMR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MMR = new Decimal("0.004"); // 0.4% — realistic Binance futures MMR

async function getMaintenanceMarginRate(symbol: string): Promise<Decimal> {
  const cached = MMR_CACHE.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < MMR_CACHE_TTL_MS) {
    return cached.rate;
  }
  try {
    const info = await getFuturesInstrumentInfo(symbol);
    if (info?.maintenance_margin_rate) {
      const rate = new Decimal(info.maintenance_margin_rate);
      MMR_CACHE.set(symbol, { rate, fetchedAt: Date.now() });
      return rate;
    }
  } catch {
    // Fallback to default
  }
  return DEFAULT_MMR;
}

export class RiskManager {
  public static async validateOrder(
    userId: number,
    params: OrderParams,
    isPaper: boolean,
    currency: "USDT" | "INR" = "USDT"
  ): Promise<boolean> {
    if (params.leverage > MAX_SYSTEM_LEVERAGE) {
      throw new Error(`Risk Breach: Maximum permitted leverage is ${MAX_SYSTEM_LEVERAGE}x`);
    }

    const qty = new Decimal(params.quantity);
    const price = new Decimal(params.price);
    const leverage = new Decimal(params.leverage);
    const side = params.side.toUpperCase();

    const notionalValue = qty.mul(price);
    let requiredMargin = notionalValue.div(leverage);
    if (isPaper && currency === "INR") {
      requiredMargin = new Decimal(await usdtToWallet(requiredMargin.toNumber(), "INR"));
    }

    const db = getDb();
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

      // Fetch realistic MMR for this symbol (or use default 0.4%)
      const mmr = await getMaintenanceMarginRate(params.symbol);

      // Calculate liquidation target using realistic MMR
      // For isolated margin LONG: liq = entry * (1 - 1/leverage + mmr)
      // For isolated margin SHORT: liq = entry * (1 + 1/leverage - mmr)
      const liquidationPrice =
        side === "BUY"
          ? entryPrice.mul(
              new Decimal(1)
                .sub(new Decimal(1).div(leverage))
                .add(mmr)
            )
          : entryPrice.mul(
              new Decimal(1)
                .add(new Decimal(1).div(leverage))
                .sub(mmr)
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
