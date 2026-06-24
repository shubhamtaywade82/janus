import { tradingRouter } from "../api/routers/trading-router";
import { autoExecutorRouter } from "../api/routers/auto-executor-router";
import { getPaperWallet } from "../api/services/paper-wallet";

async function main() {
  // Let's call getPaperWallet directly for userId = 1, starting = 100000, currency = "INR"
  console.log("=== getPaperWallet(1, 100000, 'INR') ===");
  const walletINR = await getPaperWallet(1, 100000, "INR");
  console.log(JSON.stringify(walletINR, null, 2));

  console.log("\n=== getPaperWallet(1, 100000, 'USDT') ===");
  const walletUSDT = await getPaperWallet(1, 100000, "USDT");
  console.log(JSON.stringify(walletUSDT, null, 2));
}

main().catch(console.error);
