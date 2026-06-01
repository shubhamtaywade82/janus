import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const res = await fetch("https://api.coindcx.com/exchange/v1/markets_details");
  const data: any[] = await res.json();
  const futures = data.filter((m: any) => m.pair?.startsWith("B-") || m.ecode === "B");
  console.log("Futures count:", futures.length);
  console.log("Sample:", JSON.stringify(futures.slice(0, 2), null, 2));
  const withLeverage = futures.filter((m: any) => m.max_leverage !== null);
  console.log("With leverage:", withLeverage.length);
  console.log("Leverage sample:", JSON.stringify(withLeverage.slice(0, 2), null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
