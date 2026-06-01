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

  // Let's test with timestamp in SECONDS
  const timeStampSeconds = Math.floor(Date.now() / 1000);
  const bodySeconds = { timestamp: timeStampSeconds };
  const compactJsonSeconds = JSON.stringify(bodySeconds);
  const signatureSeconds = generateSignature(compactJsonSeconds, apiSecret);

  console.log("Testing with SECONDS timestamp:", timeStampSeconds);
  try {
    const res = await fetch("https://api.coindcx.com/api/v1/derivatives/futures/data/conversions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signatureSeconds,
      },
      body: compactJsonSeconds,
    });
    if (!res.ok) {
      console.log("Seconds result - status:", res.status, await res.text());
    } else {
      console.log("Seconds result - success:", await res.json());
    }
  } catch (err: any) {
    console.error("Seconds fetch failed:", err.message);
  }

  // Let's also test with timestamp in MILLISECONDS
  const timeStampMs = Date.now();
  const bodyMs = { timestamp: timeStampMs };
  const compactJsonMs = JSON.stringify(bodyMs);
  const signatureMs = generateSignature(compactJsonMs, apiSecret);

  console.log("Testing with MILLISECONDS timestamp:", timeStampMs);
  try {
    const res = await fetch("https://api.coindcx.com/api/v1/derivatives/futures/data/conversions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signatureMs,
      },
      body: compactJsonMs,
    });
    if (!res.ok) {
      console.log("Ms result - status:", res.status, await res.text());
    } else {
      console.log("Ms result - success:", await res.json());
    }
  } catch (err: any) {
    console.error("Ms fetch failed:", err.message);
  }
}

test().then(() => process.exit(0));
