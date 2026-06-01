import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { getFuturesWallet } from "../api/services/coindcx.ts";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);

  if (!creds[0]) { console.log("No creds"); return; }

  try {
    const inr = await getFuturesWallet({ apiKey: creds[0].apiKey, apiSecret: creds[0].apiSecret }, "INR");
    console.log("Futures Wallet INR:", JSON.stringify(inr, null, 2));
  } catch(e: any) { console.error("INR wallet error:", e.message); }

  try {
    const all = await getFuturesWallet({ apiKey: creds[0].apiKey, apiSecret: creds[0].apiSecret });
    console.log("Futures Wallet (all):", JSON.stringify(all, null, 2));
  } catch(e: any) { console.error("All wallet error:", e.message); }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
