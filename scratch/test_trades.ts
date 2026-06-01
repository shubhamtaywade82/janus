import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { getFuturesOrders } from "../api/services/coindcx.ts";
import { createHmac } from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

function sign(secret: string, body: Record<string, any>): string {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
}

async function post(apiKey: string, apiSecret: string, path: string, body: Record<string, any> = {}) {
  const payload = { ...body, timestamp: Date.now() };
  const sig = sign(apiSecret, payload);
  const json = JSON.stringify(payload);
  const res = await fetch(`https://api.coindcx.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-APIKEY": apiKey, "X-AUTH-SIGNATURE": sig },
    body: json,
  });
  const text = await res.text();
  return { status: res.status, data: text.slice(0, 500) };
}

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }
  const { apiKey, apiSecret } = creds[0];

  // Try futures closed orders
  console.log("\n--- Futures closed orders ---");
  const r1 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/orders", { status: "closed" });
  console.log(r1.status, r1.data);

  // Try futures fills/trades endpoint
  console.log("\n--- Futures fills ---");
  const r2 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/fills");
  console.log(r2.status, r2.data);

  // Try futures order history
  console.log("\n--- Futures order history ---");
  const r3 = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/orders/history");
  console.log(r3.status, r3.data);

  // Try exchange trades
  console.log("\n--- Exchange user trades ---");
  const r4 = await post(apiKey, apiSecret, "/exchange/v1/orders/trade_history");
  console.log(r4.status, r4.data);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
