import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    const queryClient = env.databaseUrl.includes("run/postgresql")
      ? postgres({
          host: "/var/run/postgresql",
          database: "janus_development",
          username: "nemesis",
        })
      : postgres(env.databaseUrl);
    instance = drizzle(queryClient, { schema: fullSchema });
  }
  return instance;
}
