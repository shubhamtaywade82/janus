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

  // ─── Ollama / LLM Advisor ───
  // OLLAMA_BASE_URL    — API base (default: http://localhost:11434 for local Ollama)
  // OLLAMA_MODEL       — model name (default: llama3.2)
  // OLLAMA_API_KEYS    — comma-separated key pool for cloud providers
  // OLLAMA_API_KEY_N   — individual numbered keys (OLLAMA_API_KEY_1, _2, …)
  // OLLAMA_TIMEOUT_MS  — per-request timeout in ms (default: 15000)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaEndpoint: process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434",
  ollamaApiKeys: (process.env.OLLAMA_API_KEYS ?? "").split(",").filter(Boolean),
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2",

  // ─── Bot automation ───
  // BOT_AUTO_START=true — auto-start the executor on server boot (default: false)
  botAutoStart: process.env.BOT_AUTO_START === "true",
  // Auto-executor master switch — set AUTO_EXECUTE=true to enable autonomous trading
  autoExecute: process.env.AUTO_EXECUTE === "true",

  // ─── Observability ───
  // LOG_LEVEL — controls verbosity: debug | info | warn | error (default: info)
  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",

  // ─── Security ───
  // ENCRYPTION_KEY — 32-byte hex key for AES-256-GCM field-level encryption of API credentials
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
};
