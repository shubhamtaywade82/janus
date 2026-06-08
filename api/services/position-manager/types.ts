// ─── Position Manager — Shared Types ───────────────────────────────────────

export type Exchange = "coindcx" | "binance";
export type PositionSide = "LONG" | "SHORT";
export type PositionSource = "MANUAL" | "BOT";

export type PositionLifecycleState =
  | "DISCOVERED"
  | "SYNCED"
  | "PROTECTED"
  | "MANAGED"
  | "REDUCING"
  | "EXITING"
  | "CLOSED";

export const PositionAction = {
  KEEP_OPEN: "KEEP_OPEN",
  MOVE_TO_BREAKEVEN: "MOVE_TO_BREAKEVEN",
  TRAIL_SL: "TRAIL_SL",
  PARTIAL_EXIT: "PARTIAL_EXIT",
  FULL_EXIT: "FULL_EXIT",
  REDUCE_SIZE: "REDUCE_SIZE",
  SCALE_IN: "SCALE_IN",
  EXTEND_TP: "EXTEND_TP",
  TIGHTEN_TP: "TIGHTEN_TP",
} as const;

export type PositionAction = (typeof PositionAction)[keyof typeof PositionAction];

export type Bias =
  | "STRONG_BULLISH"
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "STRONG_BEARISH";

export type VolatilityRegime = "LOW" | "NORMAL" | "HIGH" | "EXTREME";
export type MarketTrend = "BULLISH" | "BEARISH" | "SIDEWAYS";
export type MarketStructure = "HH_HL" | "LH_LL" | "RANGING" | "UNDEFINED";
export type VolumeProfile = "HIGH" | "NORMAL" | "LOW";
export type FundingBias = "POSITIVE" | "NEGATIVE" | "NEUTRAL";
export type OpportunityCostVerdict = "KEEP" | "REDUCE" | "EXIT";

/** Full enriched position used throughout the manager */
export interface ManagedPosition {
  id: number;
  userId: number;
  exchange: Exchange;
  symbol: string;               // CoinDCX format: B-BTC_USDT
  binanceSymbol: string;        // Binance format: BTCUSDT
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  roe: number;                  // Return on equity %
  liquidationPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  source: PositionSource;
  lifecycleState: PositionLifecycleState;
  isPaper: boolean;
  marginCurrency: string;
  openedAt: Date;
  updatedAt: Date;
  // Derived
  riskRewardRatio: number | null;
  slDistancePct: number | null;  // |entry - sl| / entry
  liqDistancePct: number | null; // |entry - liq| / entry
  holdingMinutes: number;
  // New fields for breakeven and alert deduplication
  breakevenApplied: boolean;
  extremePrice: number | null;
  lastMarkPrice: number | null;
  openedAlertSent: boolean;
  strategyType: string;
}

/** Aggregated market context for a symbol at assessment time */
export interface MarketContext {
  symbol: string;               // Binance symbol
  timestamp: Date;
  trend: MarketTrend;
  volatilityRegime: VolatilityRegime;
  structure: MarketStructure;
  volumeProfile: VolumeProfile;
  fundingBias: FundingBias;
  // Indicators
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  atr14: number | null;         // absolute price
  atrPct: number | null;        // atr / price %
  // Order book
  spreadPct: number | null;
  bidAskImbalance: number | null; // positive = bid heavy
  // CVD
  cvdTrend: "bullish" | "bearish" | "neutral";
  // Funding & OI
  fundingRate: number | null;
  openInterestChange: number | null;   // % change recent
  // Score context
  confluenceScore: number | null;
  confluenceDirection: "long" | "short" | "neutral";
  // Last price
  lastPrice: number;
}

/** Output from BiasEvaluator */
export interface BiasResult {
  bias: Bias;
  score: number;       // -100 to +100 (negative = bearish, positive = bullish)
  confidence: number;  // 0–1
  factors: string[];
}

/** Output from StopLossCalculator */
export interface SLResult {
  stopLoss: number;
  mode: "ATR" | "SWING" | "VWAP" | "PERCENTAGE";
  distancePct: number;
}

/** Output from TakeProfitCalculator */
export interface TPResult {
  tp1: number;
  tp2: number;
  tp3: number;
  primaryTP: number;  // = tp1
}

/** AI recommendation for a managed position */
export interface AiRecommendation {
  action: PositionAction;
  confidence: number;           // 0–1
  reasoning: string;
  newStopLoss?: number;         // for TRAIL_SL / MOVE_TO_BREAKEVEN
  newTakeProfit?: number;       // for EXTEND_TP / TIGHTEN_TP
  exitSizePct?: number;         // for PARTIAL_EXIT / REDUCE_SIZE (0-1)
  source: "AI" | "CODE";        // did AI or fallback produce this?
  provider?: string;            // e.g. "anthropic", "openai", "ollama"
  latencyMs?: number;
}

/** Policy validation result */
export interface PolicyResult {
  approved: boolean;
  action: PositionAction;       // possibly downgraded action
  reason: string;
  overrides?: Partial<AiRecommendation>;
}

/** Opportunity cost assessment result */
export interface OpportunityCostResult {
  verdict: OpportunityCostVerdict;
  reason: string;
  bestOpportunityScore: number | null;
  currentPositionScore: number;
}

/** Full assessment record stored to DB */
export interface AssessmentRecord {
  positionId: number;
  symbol: string;
  lifecycleState: PositionLifecycleState;
  marketContext: MarketContext;
  bias: BiasResult;
  recommendation: AiRecommendation;
  policyResult: PolicyResult;
  opportunityCost: OpportunityCostResult | null;
  actionTaken: PositionAction;
  assessedAt: Date;
}

/** Protection order status */
export interface ProtectionStatus {
  hasSl: boolean;
  hasTp: boolean;
  needsProtection: boolean;
  slOrderId?: string;
  tpOrderId?: string;
}

// ─── Position Manager Config ────────────────────────────────────────────────

export interface PositionManagerConfig {
  enabled: boolean;
  assessIntervalMs: number;     // how often to assess each position (default: 30s)
  opportunityCostIntervalMs: number; // how often to run opp-cost (default: 10min)
  useAi: boolean;               // try AI before code-based fallback
  aiTimeoutMs: number;          // max wait for AI response (default: 90s for local Ollama cold-start)
  autoApplyActions: boolean;    // execute actions automatically vs notify only
  protectionEnabled: boolean;   // auto-place SL/TP on unprotected positions
  trailingEnabled: boolean;     // run trailing stop logic
  userId: number;               // primary user to manage
}

export const DEFAULT_POSITION_MANAGER_CONFIG: PositionManagerConfig = {
  enabled: true,
  assessIntervalMs: 30_000,
  opportunityCostIntervalMs: 600_000,
  useAi: true,
  aiTimeoutMs: 90_000,
  autoApplyActions: true,
  protectionEnabled: true,
  trailingEnabled: true,
  userId: 1,
};
