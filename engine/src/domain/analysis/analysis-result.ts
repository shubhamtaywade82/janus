import type { MarketStructure } from "./market-structure.js";
import type { OrderBlockAnalysis } from "./order-block.js";
import type { FvgAnalysis } from "./fvg.js";
import type { LiquidityAnalysis } from "./liquidity.js";
import type { VolumeProfileAnalysis } from "./volume-profile.js";

// ─── Open Interest ────────────────────────────────────────────────────────────

export type OiInterpretation =
  | "NEW_LONGS"         // price ↑ + OI ↑
  | "NEW_SHORTS"        // price ↓ + OI ↑
  | "SHORT_COVERING"    // price ↑ + OI ↓
  | "LONG_LIQUIDATION"  // price ↓ + OI ↓
  | "UNKNOWN";

export interface OpenInterestAnalysis {
  current: number;
  change24hPct: number;
  interpretation: OiInterpretation;
  conviction: "HIGH" | "MEDIUM" | "LOW";
}

// ─── Funding ──────────────────────────────────────────────────────────────────

export type FundingSentiment = "LONG_HEAVY" | "SHORT_HEAVY" | "NEUTRAL";

export interface FundingAnalysis {
  current: number; // e.g. 0.0001 = 0.01%
  sentiment: FundingSentiment;
  squeezeRisk: "LONG_SQUEEZE" | "SHORT_SQUEEZE" | "NONE";
  extremeThreshold: boolean; // > |0.1%|
}

// ─── CVD ──────────────────────────────────────────────────────────────────────

export type CvdSignal = "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | "CONFIRMING" | "NEUTRAL";

export interface CvdAnalysis {
  current: number;
  sessionDelta: number;
  trend: CvdSignal;
  signalStrength: "STRONG" | "MODERATE" | "WEAK";
  priceHigherLow: boolean;
  cvdHigherLow: boolean;
}

// ─── Volume ───────────────────────────────────────────────────────────────────

export interface VolumeAnalysis {
  relativeVolume: number; // current / average
  accumulationDetected: boolean;
  distributionDetected: boolean;
  climaxVolumeDetected: boolean;
  volumeScore: { bullish: number; bearish: number };
}

// ─── Order Book ───────────────────────────────────────────────────────────────

export interface OrderBookAnalysis {
  bidVolume: number;
  askVolume: number;
  imbalanceRatio: number;
  dominantSide: "BUYERS" | "SELLERS" | "NEUTRAL";
  absorptionDetected: boolean;
  spoofingDetected: boolean;
  wallLevels: { side: "BID" | "ASK"; price: number; size: number }[];
}

// ─── Signals ──────────────────────────────────────────────────────────────────

export interface SignalAnalysis {
  reversal: { detected: boolean; confidence: number };
  continuation: { detected: boolean; confidence: number };
  squeeze: { type: "LONG_SQUEEZE" | "SHORT_SQUEEZE" | "NONE"; confidence: number };
  accumulation: { detected: boolean; confidence: number };
  distribution: { detected: boolean; confidence: number };
  overallBias: "STRONG_BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG_BEAR";
  compositeScore: number; // 0-100
}

// ─── Trade Setup ──────────────────────────────────────────────────────────────

export type SetupType =
  | "TREND_CONTINUATION_LONG"
  | "TREND_CONTINUATION_SHORT"
  | "COUNTER_TREND_LONG"
  | "COUNTER_TREND_SHORT"
  | "RANGE_LONG"
  | "RANGE_SHORT"
  | "SQUEEZE_LONG"
  | "SQUEEZE_SHORT"
  | "NO_TRADE";

export interface TradeSetup {
  setupType: SetupType;
  entryZone: { low: number; high: number };
  stopLoss: number;
  targets: number[];
  riskReward: number;
  confidence: number; // 0-100
  invalidation: string;
  notes: string;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export type MarketPhase =
  | "ACCUMULATION"
  | "MARKUP"
  | "DISTRIBUTION"
  | "MARKDOWN"
  | "CONSOLIDATION"
  | "UNKNOWN";

export type RecommendedAction =
  | "BUY"
  | "SELL"
  | "WAIT_FOR_CONFIRMATION"
  | "REDUCE_POSITION"
  | "HOLD"
  | "AVOID";

export interface AnalysisSummary {
  verdict: string;
  marketPhase: MarketPhase;
  recommendedAction: RecommendedAction;
  confidence: number;
  keyLevels: { label: string; price: number }[];
}

// ─── Top-Level Result ─────────────────────────────────────────────────────────

export interface AnalysisResult {
  symbol: string;
  exchange: string;
  timestamp: number;
  currentPrice: number;

  marketStructure: MarketStructure;
  liquidity: LiquidityAnalysis;
  orderBlocks: OrderBlockAnalysis;
  fvgs: FvgAnalysis;
  volume: VolumeAnalysis;
  openInterest: OpenInterestAnalysis;
  funding: FundingAnalysis;
  cvd: CvdAnalysis;
  orderBook: OrderBookAnalysis;
  volumeProfile: VolumeProfileAnalysis;
  signals: SignalAnalysis;
  setup: TradeSetup;
  summary: AnalysisSummary;
}
