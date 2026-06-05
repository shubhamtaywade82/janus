import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

const DATABASE_URL = process.env.DATABASE_URL || "postgresql:///janus_development?host=/var/run/postgresql";

async function main() {
  console.log(`Connecting to: ${DATABASE_URL}`);
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  console.log("Seeding a mock LONG signal for BTCUSDT...");
  const [newSignal] = await db
    .insert(schema.signals)
    .values({
      symbol: "BTCUSDT",
      direction: "long",
      microScore: "85.00",
      intraScore: "90.00",
      compositeScore: "88.00",
      threshold: "70.00",
      isGated: true,
      metadata: {
        rsi: 65,
        ema20: 67000,
        ema50: 66500,
        spread: 0.001,
        imbalance: 1.5,
      },
      createdAt: new Date(),
    })
    .returning();

  console.log(`Successfully seeded signal! ID: ${newSignal.id}.`);
  console.log("Checking if the auto-executor picks it up. Make sure the server is running.");
  
  await client.end();
}

main().catch(console.error);
