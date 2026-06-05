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
  console.log("Connecting to:", url);
  const sql = getPostgresClient(url!);
  try {
    const result = await sql`SELECT 1 as connected`;
    console.log("Success:", result);
  } catch (err) {
    console.error("Connection failed:", err);
  } finally {
    await sql.end();
  }
}

main();
