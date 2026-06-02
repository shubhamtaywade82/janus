import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  authUrl: required("AUTH_URL"),
  authPlatformUrl: required("AUTH_PLATFORM_URL"),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // Safety flag — set PLACE_ORDERS=true to enable live order execution
  // Default OFF to prevent accidental trades
  placeOrders: process.env.PLACE_ORDERS === "true",
  // Auto-executor master switch — set AUTO_EXECUTE=true to enable autonomous trading
  autoExecute: process.env.AUTO_EXECUTE === "true",
  // Ollama / LLM configuration
  ollamaEndpoint: process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434",
  ollamaApiKeys: (process.env.OLLAMA_API_KEYS ?? "").split(",").filter(Boolean),
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3",
};
