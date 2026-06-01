import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const res = await fetch("https://api.coindcx.com/exchange/v1/markets_details");
  const data: any[] = await res.json();
  console.log("Total markets:", data.length);
  console.log("Sample keys:", Object.keys(data[0] || {}));
  // Check what BTC looks like
  const btc = data.find((m: any) => m.coindcx_code === "BTCUSDT" || m.symbol === "BTCUSDT");
  console.log("BTC sample:", JSON.stringify(btc, null, 2));
  // Check for any futures-like market
  const sample = data.slice(0, 3);
  console.log("First 3:", JSON.stringify(sample, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
