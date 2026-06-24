export const Session = {
  cookieName: "janus_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;

// ─── Symbol Validation ───
// Single source of truth for supported trading pairs across all modules.
export const SUPPORTED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
] as const;

export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export const SYMBOL_MIN_SL_PCT: Record<SupportedSymbol, number> = {
  BTCUSDT: 0.0025,  // 0.25%
  ETHUSDT: 0.0030,  // 0.30%
  SOLUSDT: 0.0040,  // 0.40%
  XRPUSDT: 0.0030,  // 0.30%
  DOGEUSDT: 0.0050,  // 0.50%
  ADAUSDT: 0.0040,  // 0.40%
  AVAXUSDT: 0.0040,  // 0.40%
  BNBUSDT: 0.0040,  // 0.40%
} as const;

export const DEFAULT_MIN_SL_PCT = 0.003; // 0.30%

export const MIN_SYSTEM_LEVERAGE = 5;
export const MAX_SYSTEM_LEVERAGE = 15;

export function clampSystemLeverage(leverage: number): number {
  return Math.max(MIN_SYSTEM_LEVERAGE, Math.min(leverage, MAX_SYSTEM_LEVERAGE));
}
