import { nanoid } from "nanoid";
import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type {
  SwingPoint, StructureBreak, TimeframeAnalysis, MarketStructure, Trend, Momentum,
} from "../../domain/analysis/market-structure.js";
import { EMA } from "../indicators/ema.js";
import { RSI } from "../indicators/rsi.js";

const SWING_LOOKBACK = 3; // each side

/**
 * Detects swing highs and swing lows using a simple pivot algorithm.
 * A swing high at index i requires: H[i] = max of [i-n..i+n]
 * A swing low at index i requires: L[i] = min of [i-n..i+n]
 */
export function detectSwingPoints(candles: Candle[], lookback = SWING_LOOKBACK): {
  highs: SwingPoint[];
  lows: SwingPoint[];
} {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const windowHigh = candles.slice(i - lookback, i + lookback + 1).map((x) => x.high);
    const windowLow = candles.slice(i - lookback, i + lookback + 1).map((x) => x.low);

    if (c.high === Math.max(...windowHigh)) {
      highs.push({ price: c.high, ts: c.openTime, index: i, type: "HIGH" });
    }
    if (c.low === Math.min(...windowLow)) {
      lows.push({ price: c.low, ts: c.openTime, index: i, type: "LOW" });
    }
  }

  return { highs, lows };
}

/**
 * Detects BOS (Break of Structure) and CHOCH (Change of Character).
 *
 * BOS: price breaks in the direction of the existing trend.
 * CHOCH: price breaks against the existing trend — potential reversal signal.
 */
export function detectStructureBreaks(
  candles: Candle[],
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  timeframe: CandleInterval
): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  if (swingHighs.length < 2 || swingLows.length < 2) return breaks;

  // Determine prior trend by comparing the last two swing highs/lows
  const prevHigh = swingHighs[swingHighs.length - 2];
  const lastHigh = swingHighs[swingHighs.length - 1];
  const prevLow = swingLows[swingLows.length - 2];
  const lastLow = swingLows[swingLows.length - 1];

  const makingHigherHighs = lastHigh.price > prevHigh.price;
  const makingLowerLows = lastLow.price < prevLow.price;
  const makingLowerHighs = lastHigh.price < prevHigh.price;
  const makingHigherLows = lastLow.price > prevLow.price;

  // Current candle (last)
  const last = candles[candles.length - 1];

  if (makingHigherHighs && makingHigherLows) {
    // Uptrend
    if (last.close > lastHigh.price) {
      // Bullish BOS (continuation)
      breaks.push({
        type: "BOS", direction: "BULLISH", level: lastHigh.price,
        ts: last.openTime, timeframe, confirmed: true,
      });
    } else if (last.close < lastLow.price) {
      // Bearish CHOCH (potential reversal)
      breaks.push({
        type: "CHOCH", direction: "BEARISH", level: lastLow.price,
        ts: last.openTime, timeframe, confirmed: last.close < lastLow.price,
      });
    }
  } else if (makingLowerLows && makingLowerHighs) {
    // Downtrend
    if (last.close < lastLow.price) {
      // Bearish BOS (continuation)
      breaks.push({
        type: "BOS", direction: "BEARISH", level: lastLow.price,
        ts: last.openTime, timeframe, confirmed: true,
      });
    } else if (last.close > lastHigh.price) {
      // Bullish CHOCH (potential reversal)
      breaks.push({
        type: "CHOCH", direction: "BULLISH", level: lastHigh.price,
        ts: last.openTime, timeframe, confirmed: last.close > lastHigh.price,
      });
    }
  }

  return breaks;
}

/**
 * Derives trend from swing structure (higher highs + higher lows = bullish, etc.)
 */
export function deriveTrend(swingHighs: SwingPoint[], swingLows: SwingPoint[]): Trend {
  if (swingHighs.length < 2 || swingLows.length < 2) return "RANGING";

  const lastHigh = swingHighs[swingHighs.length - 1].price;
  const prevHigh = swingHighs[swingHighs.length - 2].price;
  const lastLow = swingLows[swingLows.length - 1].price;
  const prevLow = swingLows[swingLows.length - 2].price;

  const hhhl = lastHigh > prevHigh && lastLow > prevLow;
  const lhll = lastHigh < prevHigh && lastLow < prevLow;

  if (hhhl) return "BULLISH";
  if (lhll) return "BEARISH";
  return "RANGING";
}

/**
 * Classify momentum using RSI readings.
 */
export function classifyMomentum(rsi: number | null, trend: Trend): Momentum {
  if (rsi === null) return "NEUTRAL";
  if (rsi > 70) return trend === "BULLISH" ? "STRONG_BULLISH" : "EXHAUSTING";
  if (rsi > 55) return trend === "BULLISH" ? "BULLISH" : "RECOVERY";
  if (rsi >= 45) return "NEUTRAL";
  if (rsi > 30) return trend === "BEARISH" ? "BEARISH" : "WEAKENING";
  return trend === "BEARISH" ? "STRONG_BEARISH" : "EXHAUSTING";
}

/**
 * Full single-timeframe analysis.
 */
export function analyzeTimeframe(candles: Candle[], timeframe: CandleInterval): TimeframeAnalysis {
  if (candles.length < 20) {
    return {
      timeframe, trend: "RANGING", emaAlignment: "NEUTRAL", momentum: "NEUTRAL",
      bos: false, choch: false, swingHighs: [], swingLows: [],
    };
  }

  const closes = candles.map((c) => c.close);

  // EMA alignment
  const ema20 = new EMA(20);
  const ema50 = new EMA(50);
  const ema200 = new EMA(200);
  closes.forEach((c) => { ema20.update(c); ema50.update(c); ema200.update(c); });

  let emaAlignment: TimeframeAnalysis["emaAlignment"] = "NEUTRAL";
  const e20 = ema20.current, e50 = ema50.current, e200 = ema200.current;
  if (e20 && e50 && e200) {
    if (e20 > e50 && e50 > e200) emaAlignment = "BULLISH";
    else if (e20 < e50 && e50 < e200) emaAlignment = "BEARISH";
  } else if (e20 && e50) {
    emaAlignment = e20 > e50 ? "BULLISH" : "BEARISH";
  }

  // RSI
  const rsi = new RSI(14);
  closes.forEach((c) => rsi.update(c));
  const rsiValue = rsi.current;

  // Swing points
  const { highs: swingHighs, lows: swingLows } = detectSwingPoints(candles);
  const trend = deriveTrend(swingHighs, swingLows);
  const momentum = classifyMomentum(rsiValue, trend);

  // Structure breaks
  const structureBreaks = detectStructureBreaks(candles, swingHighs, swingLows, timeframe);
  const bosEvents = structureBreaks.filter((b) => b.type === "BOS");
  const chochEvents = structureBreaks.filter((b) => b.type === "CHOCH");

  return {
    timeframe,
    trend,
    emaAlignment,
    momentum,
    bos: bosEvents.length > 0,
    choch: chochEvents.length > 0,
    latestBos: bosEvents[bosEvents.length - 1],
    latestChoch: chochEvents[chochEvents.length - 1],
    swingHighs,
    swingLows,
  };
}

/**
 * Combines all timeframe analyses into a MarketStructure.
 */
export function buildMarketStructure(
  timeframeAnalyses: Record<string, TimeframeAnalysis>
): MarketStructure {
  const tfs = Object.values(timeframeAnalyses);

  let bullishScore = 0;
  let bearishScore = 0;

  // Weight: 1D=5, 4H=4, 1H=3, 15m=2, 5m=1, 1m=0.5
  const tfWeights: Record<string, number> = {
    "1d": 5, "4h": 4, "1h": 3, "15m": 2, "5m": 1, "1m": 0.5,
  };

  for (const tf of tfs) {
    const w = tfWeights[tf.timeframe] ?? 1;
    if (tf.trend === "BULLISH") bullishScore += w;
    else if (tf.trend === "BEARISH") bearishScore += w;
  }

  const total = bullishScore + bearishScore;
  const overallBias: Trend = bullishScore > bearishScore
    ? "BULLISH"
    : bearishScore > bullishScore ? "BEARISH" : "RANGING";

  const biasConfidence = total > 0
    ? Math.round((Math.max(bullishScore, bearishScore) / total) * 100)
    : 50;

  // Collect all swing points
  const allHighs = tfs.flatMap((t) => t.swingHighs);
  const allLows = tfs.flatMap((t) => t.swingLows);

  // Latest breaks across all timeframes
  const allBos = tfs.filter((t) => t.latestBos).map((t) => t.latestBos!);
  const allChoch = tfs.filter((t) => t.latestChoch).map((t) => t.latestChoch!);
  const latestBos = allBos.sort((a, b) => b.ts - a.ts)[0];
  const latestChoch = allChoch.sort((a, b) => b.ts - a.ts)[0];

  return {
    overallBias,
    biasConfidence,
    timeframes: timeframeAnalyses,
    latestBos,
    latestChoch,
    swingHighs: allHighs.sort((a, b) => b.price - a.price).slice(0, 10),
    swingLows: allLows.sort((a, b) => a.price - b.price).slice(0, 10),
    structureScore: {
      bullish: Math.round(bullishScore),
      bearish: Math.round(bearishScore),
    },
  };
}
