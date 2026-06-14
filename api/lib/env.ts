import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.secret") });

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

// ─── Trading mode — single source of truth ───────────────────────────────────
// TRADING_MODE=paper        → paper positions, paper wallet, no exchange orders
// TRADING_MODE=live_monitor → real exchange data + alerts, NO new positions/orders
// TRADING_MODE=live_trade   → full execution: real orders, position management
//
// Legacy fallback: if TRADING_MODE unset, derives from PAPER_TRADING + PLACE_ORDERS
function resolveTradingMode(): "paper" | "live_monitor" | "live_trade" {
  const raw = process.env.TRADING_MODE;
  if (raw === "paper" || raw === "live_monitor" || raw === "live_trade") return raw;
  if (process.env.PAPER_TRADING === "true") return "paper";
  if (process.env.PLACE_ORDERS === "true") return "live_trade";
  return "live_monitor";
}
const _tradingMode = resolveTradingMode();

// PLACE_ORDERS is the sole execution toggle:
// true  → auto-executor sends real CoinDCX orders (live positions)
// false → auto-executor creates local paper positions only
// Live data sync (WS, positions, orders, wallet) is always-on when creds exist.
export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  authUrl: required("AUTH_URL"),
  authPlatformUrl: required("AUTH_PLATFORM_URL"),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",

  // ─── Trading mode ───
  tradingMode: _tradingMode,
  paperTrading: _tradingMode === "paper",
  placeOrders: _tradingMode === "live_trade",
  isMonitorMode: _tradingMode === "live_monitor",

  // ─── CoinDCX credentials (fallback when not in DB) ───
  coindcxApiKey: process.env.COINDCX_API_KEY ?? "",
  coindcxApiSecret: process.env.COINDCX_API_SECRET ?? "",

  // Testnet mode — routes Binance market data to testnet endpoints
  useTestnet: process.env.USE_TESTNET === "true",

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
  ollamaTimeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "30000", 10),

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

  // ─── Kronos ───
  kronosEndpoint: process.env.KRONOS_ENDPOINT ?? "http://localhost:8000",
};

// CoinDCX env credentials fallback (used when DB has no stored credentials)
export const coinDCXEnvCreds = env.coindcxApiKey && env.coindcxApiSecret
  ? { apiKey: env.coindcxApiKey, apiSecret: env.coindcxApiSecret }
  : null;

if (!env.encryptionKey) {
  throw new Error("ENCRYPTION_KEY missing");
}

try {
  const buf = Buffer.from(env.encryptionKey, "hex");
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY invalid size (must be 32 bytes, got ${buf.length} bytes)`);
  }
} catch (err: any) {
  throw new Error(`ENCRYPTION_KEY invalid hex formatting: ${err.message}`);
}

