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
  const json = JSON.stringify(payload);
  const res = await fetch(`https://api.coindcx.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-APIKEY": apiKey, "X-AUTH-SIGNATURE": sig },
    body: json,
  });
  const text = await res.text();
  return { status: res.status, data: text.slice(0, 800) };
}

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }
  const { apiKey, apiSecret } = creds[0];

  const statuses = ["filled", "completed", "executed", "cancelled", "open", "partially_filled"];
  for (const s of statuses) {
    const r = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/orders", { status: s });
    console.log(`futures/orders status=${s}: ${r.status} ${r.data.slice(0, 100)}`);
  }

  // No status
  const r = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/orders");
  console.log(`futures/orders (no status): ${r.status} ${r.data.slice(0, 200)}`);

  // Wallet transactions (already known to work)
  const wt = await post(apiKey, apiSecret, "/exchange/v1/derivatives/futures/wallets/transactions");
  console.log(`\nwallet transactions: ${wt.status}`);
  console.log(wt.data);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
