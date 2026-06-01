import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { createHmac } from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

function sign(secret: string, body: Record<string, any>): string {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
}

async function post(apiKey: string, apiSecret: string, path: string, body: Record<string, any> = {}) {
  const payload = { ...body, timestamp: Date.now() };
  const sig = sign(apiSecret, payload);
  const res = await fetch(`https://api.coindcx.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-APIKEY": apiKey, "X-AUTH-SIGNATURE": sig },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.text() };
}

async function get(path: string) {
  const res = await fetch(`https://api.coindcx.com${path}`);
  return { status: res.status, data: (await res.text()).slice(0, 600) };
}

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }
  const { apiKey, apiSecret } = creds[0];

  // Public futures market/instrument info
  console.log("\n--- Public futures markets ---");
  const r1 = await get("/exchange/v1/derivatives/futures/data/markets_details");
  console.log(r1.status, r1.data);

  // Account leverage settings
  console.log("\n--- Account leverage settings ---");
  const r2 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/leverage");
  console.log(r2.status, r2.data.slice(0, 400));

  // Get leverage for specific pair
  console.log("\n--- Leverage for BTCUSDT ---");
  const r3 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/leverage", { pair: "B-BTC_USDT" });
  console.log(r3.status, r3.data.slice(0, 400));

  // Account info / settings
  console.log("\n--- Account settings ---");
  const r4 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/account");
  console.log(r4.status, r4.data.slice(0, 400));

  // Get margin mode
  console.log("\n--- Margin mode ---");
  const r5 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/margin_mode");
  console.log(r5.status, r5.data.slice(0, 400));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
