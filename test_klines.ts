import { fetchKlines } from "./api/services/binance.ts";
async function main() {
  const klines = await fetchKlines("ETHUSDT", "1m", 50);
  console.log("klines length:", klines.length);
}
main().catch(console.error).finally(() => process.exit(0));
