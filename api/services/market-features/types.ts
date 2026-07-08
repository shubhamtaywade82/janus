import { DailyTrendBias } from "../trend-bias";

export interface ATRFeature {
  value: number;
  percentile100: number;
  percentile500: number;
  isExpanding: boolean;
  isContracting: boolean;
  state: "EXPANDING" | "CONTRACTING" | "NORMAL";
  atrExpansionRate: number; // Rolling difference/ratio of ATR over last N periods
}

export interface ADXFeature {
  value: number;
  plusDI: number;
  minusDI: number;
  trendState: "STRONG_TREND" | "TRENDING" | "WEAK_TREND" | "RANGING";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  adxSlope: number; // Slope/change of ADX value over last N periods
}

export interface EMAFeature {
  ema20: number;
  ema50: number;
  ema200: number;
  crossover: "BULLISH" | "BEARISH" | "NONE";
  alignment: "BULLISH" | "BEARISH" | "NEUTRAL";
  distanceVsEma200Pct: number;
  kaufmanEfficiencyRatio: number; // KER
  choppinessIndex: number;
  verticalHorizontalFilter: number; // VHF
  rollingRegressionSlope: number;
}

export interface RSIFeature {
  value: number;
  state: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
  slope: number;
}

export interface MACDFeature {
  macdLine: number;
  signalLine: number;
  histogram: number;
  crossover: "BULLISH" | "BEARISH" | "NONE";
  momentumDirection: "UP" | "DOWN" | "FLAT";
}

export interface VolumeFeature {
  currentVolume: number;
  averageVolume: number;
  volumeSurgeRatio: number;
  volumeRatio: number;
  buyRatio: number;
  isSurge: boolean;
}

export interface OrderBookFeature {
  spread: number;
  spreadPercent: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  depthImbalanceState: "BIDS_HEAVY" | "ASKS_HEAVY" | "BALANCED";
}

export interface CVDFeature {
  value: number;
  slope: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  divergence: "BULLISH_DIV_CLASSIC" | "BEARISH_DIV_CLASSIC" | "BULLISH_DIV_HIDDEN" | "BEARISH_DIV_HIDDEN" | "NONE";
}

export interface OIFeature {
  value: number;
  netChange: number;
  changePercent24h: number;
  trend: "LONG_BUILDUP" | "SHORT_BUILDUP" | "LONG_UNWIND" | "SHORT_UNWIND" | "NEUTRAL";
}

export interface FundingFeature {
  value: number;
  zScore: number;
  state: "CROWDED_LONG" | "CROWDED_SHORT" | "NORMAL";
  predictedRate: number;
}

export interface LiquidationFeature {
  buyLiquidations: number;
  sellLiquidations: number;
  intensity: number;
  state: "CASCADE_LONG" | "CASCADE_SHORT" | "NORMAL";
}

export interface VolatilityFeature {
  value: number;
  percentile: number;
  state: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
}

export interface LiquidityFeature {
  sweepScore: number;
  absorptionScore: number;
  liquidityAdded: number;
  liquidityRemoved: number;
  state: "VACUUM" | "HIGH_LIQUIDITY" | "NORMAL";
}

export interface SessionFeature {
  activeSession: "ASIA" | "EUROPE" | "US" | "OVERLAP" | "LUNCH" | "DORMANT";
  timeToCloseMs: number;
  sessionName: string;
}

export interface CorrelationFeature {
  btcCorrelation: number;
  otherCorrelations: Record<string, number>;
}

export interface MarketFeatures {
  symbol: string;
  timestamp: number;
  atr: ATRFeature;
  adx: ADXFeature;
  ema: EMAFeature;
  rsi: RSIFeature;
  macd: MACDFeature;
  volume: VolumeFeature;
  orderBook: OrderBookFeature;
  cvd: CVDFeature;
  oi: OIFeature;
  funding: FundingFeature;
  liquidation: LiquidationFeature;
  volatility: VolatilityFeature;
  liquidity: LiquidityFeature;
  session: SessionFeature;
  correlation: CorrelationFeature;
  dailyTrendBias: DailyTrendBias | null;
}
