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
  const text = await res.text();
  return { status: res.status, data: text.slice(0, 1000) };
}

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }
  const { apiKey, apiSecret } = creds[0];

  const endpoints = [
    ["/exchange/v1/derivatives/futures/positions", {}],
    ["/exchange/v1/derivatives/futures/positions", { status: "open" }],
    ["/exchange/v1/derivatives/futures/positions", { margin_currency_short_name: ["INR"] }],
    ["/exchange/v1/derivatives/futures/positions", { margin_currency_short_name: ["INR", "USDT"] }],
    ["/exchange/v1/derivatives/futures/open_positions", {}],
    ["/exchange/v1/derivatives/futures/account/positions", {}],
  ] as [string, Record<string, any>][];

  for (const [path, body] of endpoints) {
    const r = await post(apiKey, apiSecret, path, body);
    const preview = r.data.length > 3 ? r.data : "(empty)";
    console.log(`${r.status}  ${path}  body=${JSON.stringify(body)}  →  ${preview.slice(0, 200)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
