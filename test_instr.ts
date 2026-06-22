import { getFuturesInstrumentInfo } from "./api/services/coindcx.ts";
async function main() {
  const info = await getFuturesInstrumentInfo("B-DOGE_USDT");
  console.log(info);
}
main().catch(console.error).finally(() => process.exit(0));
