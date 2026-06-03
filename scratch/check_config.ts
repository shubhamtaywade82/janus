import postgres from 'postgres';
import 'dotenv/config';

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
    return;
  }
  const sql = getPostgresClient(url);
  try {
    const config = await sql`SELECT * FROM auto_executor_config LIMIT 5`;
    console.log("Auto-executor configs:", JSON.stringify(config, null, 2));

    const keys = await sql`SELECT id, label, provider, endpoint, model, priority, is_active FROM llm_api_keys`;
    console.log("LLM API Keys:", JSON.stringify(keys, null, 2));
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await sql.end();
  }
}

main();
