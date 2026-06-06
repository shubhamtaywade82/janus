import { EventEmitter } from "events";
import { fetchKlines } from "./binance";
import { marketStateManager } from "./market-state";
import type { StrategyType } from "./strategy-config";

export type RegimeType =
  | "ranging_tight"     // ADX<15, spread<0.02% → scalping_micro
  | "ranging"           // ADX<20, moderate spread → bb_reversion
  | "reversal"          // ADX 20-30, RSI extreme (<30 or >70) → momentum_reversal
  | "intraday_trend"    // ADX 20-30, trend building → intraday
  | "swing_trend"       // ADX>30, EMA50_4h confirms trend → swing
  | "high_volatility";  // ATR>2% → intraday (wider stops)

export interface RegimeInput {
  adx1h: number;
  atrPct1h: number;       // ATR(14) / price * 100
  ema20_1h: number;
  ema50_1h: number;
  ema50_4h: number;
  ema200_4h: number;
  spreadPct: number;
  rsi1h: number;
}

export interface RegimeResult {
  regime: RegimeType;
  strategy: StrategyType;
  inputs: RegimeInput;
  symbol: string;
  timestamp: number;
  reason: string;
}

export const regimeEvents = new EventEmitter();
regimeEvents.setMaxListeners(20);

// ─── Regime → Strategy mapping ───
export const REGIME_STRATEGY_MAP: Record<RegimeType, StrategyType> = {
  ranging_tight:   "scalping_micro",  // ADX<15 + tight spread → scalp microstructure
  ranging:         "bb_reversion",    // ADX<20 normal → mean-revert to BB middle
  reversal:        "momentum_reversal", // RSI extreme → catch exhaustion
  intraday_trend:  "intraday",         // ADX 20-30 → EMA + momentum
  swing_trend:     "swing",            // ADX>30 + 4h trend confirmed
  high_volatility: "intraday",         // ATR>2% → wider stops, trend-follow
};

// `grid` and `ml_sizing` are manual-only strategies:
// - grid:        set manually for known consolidation zones
// - ml_sizing:   set manually to overlay conviction-based sizing on any trend

export function classifyRegime(input: RegimeInput): RegimeType {
  // Priority 1: Extreme volatility — don't scalp chaos
  if (input.atrPct1h > 2.0) return "high_volatility";

  // Priority 2: Strong sustained trend (ADX>30 + 4h EMA confirms)
  if (input.adx1h > 30) return "swing_trend";

  // Priority 3: RSI extremes in trend → momentum exhaustion reversal
  if (input.adx1h >= 20 && (input.rsi1h < 30 || input.rsi1h > 70)) return "reversal";

  // Priority 4: Developing intraday trend
  if (input.adx1h >= 20) return "intraday_trend";

  // Priority 5: Tight ranging market → ultra-micro scalp
  if (input.spreadPct < 0.02 && input.adx1h < 15) return "ranging_tight";

  // Default: standard ranging → BB reversion
  return "ranging";
}

export function regimeToStrategy(regime: RegimeType): StrategyType {
  return REGIME_STRATEGY_MAP[regime];
}

// ─── Technical helpers ───

function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcADX(prices: number[], period = 14): number {
  if (prices.length < period * 2) return 20;
  const highs = prices;
  const lows = prices.map((p, i) => (i > 0 ? Math.min(p, prices[i - 1]) : p));
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    trSum += Math.abs(highs[i] - lows[i]);
  }
  if (trSum === 0) return 0;
  const plusDI = (plusDM / trSum) * 100;
  const minusDI = (minusDM / trSum) * 100;
  return Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;
}

function calcATRPct(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 0;
  const slice = prices.slice(-period - 1);
  let atrSum = 0;
  for (let i = 1; i < slice.length; i++) {
    atrSum += Math.abs(slice[i] - slice[i - 1]);
  }
  const atr = atrSum / period;
  const currentPrice = prices[prices.length - 1];
  return currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
}

export async function detectRegimeForSymbol(binanceSymbol: string): Promise<RegimeResult> {
  let klines1h, klines4h;
  try {
    [klines1h, klines4h] = await Promise.all([
      fetchKlines(binanceSymbol, "1h", 60),
      fetchKlines(binanceSymbol, "4h", 60),
    ]);
  } catch (err: any) {
    console.warn(`[regime-detector] Failed to fetch klines for ${binanceSymbol} via REST (using cached or default):`, err.message || err);
    const cached = latestRegimeCache.get(binanceSymbol);
    if (cached) {
      return cached;
    }
    // Fallback default ranging regime
    return {
      regime: "ranging",
      strategy: "bb_reversion",
      symbol: binanceSymbol,
      timestamp: Date.now(),
      reason: `API error fallback: ${err.message || err}`,
      inputs: {
        adx1h: 15,
        atrPct1h: 0.5,
        ema20_1h: 100,
        ema50_1h: 100,
        ema50_4h: 100,
        ema200_4h: 100,
        spreadPct: 0.01,
        rsi1h: 50,
      },
    };
  }

  const prices1h = klines1h.map((k) => parseFloat(k.close));
  const prices4h = klines4h.map((k) => parseFloat(k.close));

  const adx1h    = calcADX(prices1h, 14);
  const atrPct1h = calcATRPct(prices1h, 14);
  const ema20_1h = calcEMA(prices1h, 20);
  const ema50_1h = calcEMA(prices1h, 50);
  const ema50_4h = calcEMA(prices4h, 50);
  const ema200_4h = calcEMA(prices4h, Math.min(200, prices4h.length));
  const rsi1h    = calcRSI(prices1h, 14);

  const state = marketStateManager.get(binanceSymbol);
  const spreadPct = state?.metrics?.spreadPercent ?? 0;

  const inputs: RegimeInput = {
    adx1h, atrPct1h, ema20_1h, ema50_1h,
    ema50_4h, ema200_4h, spreadPct, rsi1h,
  };

  const regime   = classifyRegime(inputs);
  const strategy = regimeToStrategy(regime);

  const reason: Record<RegimeType, string> = {
    ranging_tight:   `ADX ${adx1h.toFixed(1)} < 15, spread ${spreadPct.toFixed(3)}% < 0.02% — scalp microstructure`,
    ranging:         `ADX ${adx1h.toFixed(1)} < 20 — range bound, mean revert`,
    reversal:        `ADX ${adx1h.toFixed(1)} in trend + RSI ${rsi1h.toFixed(0)} extreme — catch exhaustion`,
    intraday_trend:  `ADX ${adx1h.toFixed(1)} 20–30, EMA20 ${ema20_1h > ema50_1h ? ">" : "<"} EMA50 — intraday momentum`,
    swing_trend:     `ADX ${adx1h.toFixed(1)} > 30, EMA50_4h ${ema50_4h > ema200_4h ? ">" : "<"} EMA200_4h — sustained trend`,
    high_volatility: `ATR ${atrPct1h.toFixed(2)}% > 2% — high vol, avoid micro scalping`,
  };

  return {
    regime,
    strategy,
    inputs,
    symbol: binanceSymbol,
    timestamp: Date.now(),
    reason: reason[regime],
  };
}

// Latest regime cache — populated by auto-detection loop
export const latestRegimeCache = new Map<string, RegimeResult>();
