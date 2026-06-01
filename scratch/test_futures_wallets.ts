import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function test() {
  const db = getDb();
  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.userId, 1),
        eq(exchangeCredentials.exchange, "coindcx")
      )
    )
    .limit(1);

  if (!creds || creds.length === 0) {
    console.log("No credentials.");
    return;
  }

  const apiKey = creds[0].apiKey;
  const apiSecret = creds[0].apiSecret;

  const timestamp = Date.now();
  const payload = { timestamp };
  const compactJson = JSON.stringify(payload);
  const signature = generateSignature(compactJson, apiSecret);

  const headers = {
    "Content-Type": "application/json",
    "X-AUTH-APIKEY": apiKey,
    "X-AUTH-SIGNATURE": signature,
  };

  try {
    const res = await fetch("https://api.coindcx.com/exchange/v1/derivatives/futures/cross_margin_details", {
      method: "POST",
      headers,
      body: compactJson,
    });
    if (!res.ok) {
      console.log("Error status:", res.status, await res.text());
    } else {
      console.log("Cross Margin Details Data:", await res.json());
    }
  } catch (err: any) {
    console.error("Fetch failed:", err.message);
  }
}

test().then(() => process.exit(0));
