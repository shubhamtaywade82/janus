import { RiskManager } from "./api/services/RiskManager.ts";
import Decimal from "decimal.js";

async function main() {
  try {
    await RiskManager.validateOrder(
      1,
      {
        symbol: "B-ETH_USDT",
        quantity: "0.5",
        price: "3500",
        side: "BUY",
        leverage: 10,
        orderType: "MARKET"
      },
      true,
      "INR"
    );
    console.log("Success");
  } catch (err) {
    console.error(err);
  }
}
main().catch(console.error).finally(() => process.exit(0));
