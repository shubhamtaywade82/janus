import { getDb } from "../api/queries/connection.ts";
import { exchangeCredentials } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { getFuturesPositions } from "../api/services/coindcx.ts";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const db = getDb();
  const creds = await db.select().from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, 1), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  if (!creds[0]) { console.log("No creds"); return; }

  const positions = await getFuturesPositions({ apiKey: creds[0].apiKey, apiSecret: creds[0].apiSecret });
  console.log("Total positions returned:", positions.length);
  console.log("All positions raw:");
  console.log(JSON.stringify(positions, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
