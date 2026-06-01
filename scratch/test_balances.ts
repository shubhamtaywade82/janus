import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { getBalances } from "../api/services/coindcx.ts";
import * as dotenv from "dotenv";

dotenv.config();

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

  try {
    const balances = await getBalances({
      apiKey: creds[0].apiKey,
      apiSecret: creds[0].apiSecret,
    });
    console.log("Spot/Main Balances:", JSON.stringify(balances.slice(0, 10), null, 2));
  } catch (err: any) {
    console.error("Error fetching balances:", err.message);
  }
}

test().then(() => process.exit(0));
