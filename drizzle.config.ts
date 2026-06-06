import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const dbCredentials = connectionString.includes("run/postgresql")
  ? {
      host: "/var/run/postgresql",
      database: "janus_development",
      user: "nemesis",
    }
  : {
      url: connectionString,
    };

export default defineConfig({
  schema: ["./db/schema.ts", "./db/position-manager-schema.ts"],
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials,
});
