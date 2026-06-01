import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // Public markets details
  const res = await fetch("https://api.coindcx.com/exchange/v1/markets_details");
  const data: any[] = await res.json();
  const futures = data.filter((m: any) =>
    (m.symbol || m.coindcx_code || "").startsWith("B-")
  ).slice(0, 2);
  console.log("Futures market details sample:");
  console.log(JSON.stringify(futures, null, 2));

  // Also check futures-specific public endpoint
  const res2 = await fetch("https://api.coindcx.com/exchange/v1/futures/data/instruments");
  console.log("\nFutures instruments status:", res2.status, (await res2.text()).slice(0, 200));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
