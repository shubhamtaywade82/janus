export type ExchangeProfile = "delta" | "coindcx";

export interface EngineConfig {
  /** Which exchange profiles to activate */
  exchanges: ExchangeProfile[];

  delta?: {
    apiKey: string;
    apiSecret: string;
    baseUrl?: string;
    wsUrl?: string;
  };

  coindcx?: {
    apiKey: string;
    apiSecret: string;
  };

  risk: {
    minConfidence: number;
    maxRiskPctPerTrade: number;
    maxOpenPositions: number;
    maxLeverage: number;
    maxDrawdownPct: number;
  };

  accountId: string;
}

export function loadConfig(): EngineConfig {
  return {
    exchanges: (process.env.ACTIVE_EXCHANGES ?? "coindcx").split(",") as ExchangeProfile[],

    delta: process.env.DELTA_API_KEY
      ? {
          apiKey: process.env.DELTA_API_KEY,
          apiSecret: process.env.DELTA_API_SECRET!,
          baseUrl: process.env.DELTA_BASE_URL,
          wsUrl: process.env.DELTA_WS_URL,
        }
      : undefined,

    coindcx: process.env.COINDCX_API_KEY
      ? {
          apiKey: process.env.COINDCX_API_KEY,
          apiSecret: process.env.COINDCX_API_SECRET!,
        }
      : undefined,

    risk: {
      minConfidence: parseFloat(process.env.RISK_MIN_CONFIDENCE ?? "0.70"),
      maxRiskPctPerTrade: parseFloat(process.env.RISK_MAX_PCT_PER_TRADE ?? "0.005"),
      maxOpenPositions: parseInt(process.env.RISK_MAX_OPEN_POSITIONS ?? "5", 10),
      maxLeverage: parseInt(process.env.RISK_MAX_LEVERAGE ?? "10", 10),
      maxDrawdownPct: parseFloat(process.env.RISK_MAX_DRAWDOWN_PCT ?? "0.15"),
    },

    accountId: process.env.ENGINE_ACCOUNT_ID ?? "default",
  };
}
