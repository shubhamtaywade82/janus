import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { createHmac } from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

function sign(secret: string, body: Record<string, any>): string {
  const sorted = JSON.stringify(body, Object.keys(body).sort());
  return createHmac("sha256", secret).update(sorted).digest("hex");
}

async function post(apiKey: string, apiSecret: string, path: string, body: Record<string, any> = {}) {
  const payload = { ...body, timestamp: Date.now() };
  const sig = sign(apiSecret, payload);
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  const res = await fetch(`https://api.coindcx.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-APIKEY": apiKey, "X-AUTH-SIGNATURE": sig },
    body: json,
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 200) };
}

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }
  const { apiKey, apiSecret } = creds[0];

  const endpoints = [
    "/exchange/v1/derivatives/futures/wallet",
    "/exchange/v1/derivatives/futures/wallets",
    "/exchange/v1/derivatives/futures/balance",
    "/exchange/v1/derivatives/futures/account/balance",
    "/exchange/v1/derivatives/futures/positions",        // known-good baseline
    "/exchange/v1/users/balances",                       // known-good baseline
    "/exchange/v1/derivatives/futures/cross_margin_details",
    "/api/v1/derivatives/futures/data/wallet",
  ];

  for (const ep of endpoints) {
    try {
      const r = await post(apiKey, apiSecret, ep);
      console.log(`${r.status}  ${ep}  →  ${r.body}`);
    } catch (e: any) {
      console.log(`ERR  ${ep}  →  ${e.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
