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
    const totalLogs = await sql`SELECT COUNT(*)::int as count FROM system_logs`;
    console.log("Total rows in system_logs:", totalLogs[0].count);

    const llmLogs = await sql`SELECT COUNT(*)::int as count FROM system_logs WHERE component = 'llm-advisor'`;
    console.log("LLM Advisor rows in system_logs:", llmLogs[0].count);

    if (llmLogs[0].count > 0) {
      const sample = await sql`SELECT id, component, level, message, metadata, created_at FROM system_logs WHERE component = 'llm-advisor' ORDER BY created_at DESC LIMIT 5`;
      console.log("Latest 5 LLM Advisor logs:", JSON.stringify(sample, null, 2));
    }
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await sql.end();
  }
}

main();
