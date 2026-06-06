import postgres from 'postgres';
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

function getPostgresClient(connectionString: string) {
  if (connectionString.startsWith("/") || connectionString.includes("run/postgresql")) {
    return postgres({
      host: "/var/run/postgresql",
      database: "janus_development",
      username: "nemesis",
    });
  }
  return postgres(connectionString);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = getPostgresClient(url);
  try {
    const targetTables = [
      'brain_episodes',
      'brain_strategies',
      'brain_reflections',
      'brain_candidate_rules',
      'brain_actions',
      'brain_tools',
      'paper_accounts',
      'paper_positions',
      'paper_trades',
      'paper_equity_snapshots'
    ];

    console.log("Checking tables in database...");
    for (const table of targetTables) {
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = ${table}
        ) as exists;
      `;
      const exists = result[0]?.exists;
      console.log(`Table '${table}': ${exists ? '✓ CREATED' : '✗ MISSING'}`);
    }
  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await sql.end();
  }
}

main();
