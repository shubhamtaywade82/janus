import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type {
  SwingPoint, StructureBreak, TimeframeAnalysis, MarketStructure, Trend, Momentum,
} from "../../domain/analysis/market-structure.js";
import { EMA } from "../indicators/ema.js";
import { RSI } from "../indicators/rsi.js";

const SWING_LOOKBACK = 3;
const RANGE_EPSILON = 0.001;

type StructureTrend = "UNKNOWN" | "BULLISH" | "BEARISH" | "RANGING";

interface StructureTracker {
  trend: StructureTrend;
  confirmedSwings: SwingPoint[];
  prevHighSwing: SwingPoint | null;
  prevLowSwing: SwingPoint | null;
  lastHH: SwingPoint | null;
  lastHL: SwingPoint | null;
  lastLH: SwingPoint | null;
  lastLL: SwingPoint | null;
  priorHH: SwingPoint | null;
  priorLL: SwingPoint | null;
  structureReady: boolean;
  lastBullishBosLevel: number | null;
  lastBearishBosLevel: number | null;
  lastChochLevel: number | null;
}

/**
 * Swing high at i: H[i] > max(H[i-N..i-1]) AND H[i] > max(H[i+1..i+N])
 * Swing low at i:  L[i] < min(L[i-N..i-1]) AND L[i] < min(L[i+1..i+N])
 */
export function detectSwingPoints(candles: Candle[], lookback = SWING_LOOKBACK): {
  highs: SwingPoint[];
  lows: SwingPoint[];
} {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];

    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback && isSwingHigh; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isSwingHigh = false;
    }

    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback && isSwingLow; j++) {
      if (j === i) continue;
      if (candles[j].low <= c.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      highs.push({ price: c.high, ts: c.openTime, index: i, type: "HIGH" });
    }
    if (isSwingLow) {
      lows.push({ price: c.low, ts: c.openTime, index: i, type: "LOW" });
    }
  }

  return { highs, lows };
}

function mergeSwingsChronologically(highs: SwingPoint[], lows: SwingPoint[]): SwingPoint[] {
  return [...highs, ...lows].sort((a, b) => a.index - b.index || (a.type === "HIGH" ? -1 : 1));
}

function hasInitialStructure(swings: SwingPoint[]): boolean {
  if (swings.length < 3) return false;
  const [a, b, c] = swings.slice(-3);
  return (
    (a.type === "HIGH" && b.type === "LOW" && c.type === "HIGH") ||
    (a.type === "LOW" && b.type === "HIGH" && c.type === "LOW")
  );
}

function createStructureTracker(): StructureTracker {
  return {
    trend: "UNKNOWN",
    confirmedSwings: [],
    prevHighSwing: null,
    prevLowSwing: null,
    lastHH: null,
    lastHL: null,
    lastLH: null,
    lastLL: null,
    priorHH: null,
    priorLL: null,
    structureReady: false,
    lastBullishBosLevel: null,
    lastBearishBosLevel: null,
    lastChochLevel: null,
  };
}

function registerConfirmedSwing(tracker: StructureTracker, swing: SwingPoint): void {
  if (swing.type === "HIGH") {
    if (tracker.prevHighSwing) {
      if (swing.price > tracker.prevHighSwing.price) {
        tracker.priorHH = tracker.lastHH;
        tracker.lastHH = swing;
        tracker.lastBullishBosLevel = null;
      } else {
        tracker.lastLH = swing;
        tracker.lastChochLevel = null;
      }
    }
    tracker.prevHighSwing = swing;
  } else {
    if (tracker.prevLowSwing) {
      if (swing.price > tracker.prevLowSwing.price) {
        tracker.lastHL = swing;
        tracker.lastChochLevel = null;
      } else {
        tracker.priorLL = tracker.lastLL;
        tracker.lastLL = swing;
        tracker.lastBearishBosLevel = null;
      }
    }
    tracker.prevLowSwing = swing;
  }

  tracker.confirmedSwings.push(swing);
  tracker.structureReady = hasInitialStructure(tracker.confirmedSwings);

  if (
    tracker.structureReady &&
    tracker.lastHH &&
    tracker.priorHH &&
    tracker.lastLL &&
    tracker.priorLL
  ) {
    const hhDelta = Math.abs(tracker.lastHH.price - tracker.priorHH.price) / tracker.priorHH.price;
    const llDelta = Math.abs(tracker.lastLL.price - tracker.priorLL.price) / tracker.priorLL.price;
    if (hhDelta < RANGE_EPSILON && llDelta < RANGE_EPSILON) {
      tracker.trend = "RANGING";
    }
  }
}

function pushStructureBreak(
  breaks: StructureBreak[],
  candle: Candle,
  type: StructureBreak["type"],
  direction: StructureBreak["direction"],
  brokenSwing: SwingPoint,
  timeframe: CandleInterval
): void {
  breaks.push({
    type,
    direction,
    level: brokenSwing.price,
    ts: candle.openTime,
    timeframe,
    confirmed: true,
  });
}

function evaluateStructureBreak(
  candle: Candle,
  tracker: StructureTracker,
  breaks: StructureBreak[],
  timeframe: CandleInterval
): boolean {
  if (!tracker.structureReady) return false;

  const close = candle.close;

  if (tracker.trend === "BULLISH") {
    if (tracker.lastHL && close < tracker.lastHL.price) {
      if (tracker.lastChochLevel !== tracker.lastHL.price) {
        pushStructureBreak(breaks, candle, "CHOCH", "BEARISH", tracker.lastHL, timeframe);
        tracker.lastChochLevel = tracker.lastHL.price;
      }
      tracker.trend = "BEARISH";
      return true;
    }
    if (tracker.lastHH && close > tracker.lastHH.price) {
      if (tracker.lastBullishBosLevel === tracker.lastHH.price) return false;
      pushStructureBreak(breaks, candle, "BOS", "BULLISH", tracker.lastHH, timeframe);
      tracker.lastBullishBosLevel = tracker.lastHH.price;
      return true;
    }
    return false;
  }

  if (tracker.trend === "BEARISH") {
    if (tracker.lastLH && close > tracker.lastLH.price) {
      if (tracker.lastChochLevel !== tracker.lastLH.price) {
        pushStructureBreak(breaks, candle, "CHOCH", "BULLISH", tracker.lastLH, timeframe);
        tracker.lastChochLevel = tracker.lastLH.price;
      }
      tracker.trend = "BULLISH";
      return true;
    }
    if (tracker.lastLL && close < tracker.lastLL.price) {
      if (tracker.lastBearishBosLevel === tracker.lastLL.price) return false;
      pushStructureBreak(breaks, candle, "BOS", "BEARISH", tracker.lastLL, timeframe);
      tracker.lastBearishBosLevel = tracker.lastLL.price;
      return true;
    }
    return false;
  }

  const bullishBreakLevel = tracker.lastHH ?? tracker.prevHighSwing;
  const bearishBreakLevel = tracker.lastLL ?? tracker.prevLowSwing;

  if (bullishBreakLevel && close > bullishBreakLevel.price) {
    if (tracker.lastBullishBosLevel === bullishBreakLevel.price) return false;
    pushStructureBreak(breaks, candle, "BOS", "BULLISH", bullishBreakLevel, timeframe);
    tracker.lastBullishBosLevel = bullishBreakLevel.price;
    tracker.trend = "BULLISH";
    return true;
  }

  if (bearishBreakLevel && close < bearishBreakLevel.price) {
    if (tracker.lastBearishBosLevel === bearishBreakLevel.price) return false;
    pushStructureBreak(breaks, candle, "BOS", "BEARISH", bearishBreakLevel, timeframe);
    tracker.lastBearishBosLevel = bearishBreakLevel.price;
    tracker.trend = "BEARISH";
    return true;
  }

  return false;
}

/**
 * Deterministic BOS/CHoCH from confirmed swing sequence + close breaks.
 *
 * BOS = continuation (bullish: close > last HH; bearish: close < last LL)
 * CHOCH = reversal (bullish trend + close < last HL; bearish trend + close > last LH)
 */
export function detectStructureBreaks(
  candles: Candle[],
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  timeframe: CandleInterval,
  lookback = SWING_LOOKBACK
): StructureBreak[] {
  if (candles.length === 0 || swingHighs.length + swingLows.length < 2) return [];

  const breaks: StructureBreak[] = [];
  const sortedSwings = mergeSwingsChronologically(swingHighs, swingLows);
  const tracker = createStructureTracker();

  let swingCursor = 0;
  let minSwingIndex = 0;

  for (let i = 1; i < candles.length; i++) {
    while (
      swingCursor < sortedSwings.length &&
      sortedSwings[swingCursor].index + lookback <= i
    ) {
      const s = sortedSwings[swingCursor];
      if (s.index >= minSwingIndex) registerConfirmedSwing(tracker, s);
      swingCursor++;
    }

    if (evaluateStructureBreak(candles[i], tracker, breaks, timeframe)) {
      minSwingIndex = i;
    }
  }

  return breaks;
}

export function deriveTrendFromStructure(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  candles: Candle[],
  lookback = SWING_LOOKBACK
): Trend {
  if (candles.length === 0 || swingHighs.length + swingLows.length < 2) return "RANGING";

  const sortedSwings = mergeSwingsChronologically(swingHighs, swingLows);
  const tracker = createStructureTracker();

  let swingCursor = 0;
  for (let i = 1; i < candles.length; i++) {
    while (
      swingCursor < sortedSwings.length &&
      sortedSwings[swingCursor].index + lookback <= i
    ) {
      registerConfirmedSwing(tracker, sortedSwings[swingCursor]);
      swingCursor++;
    }
    evaluateStructureBreak(candles[i], tracker, [], "1m");
  }

  if (tracker.trend === "BULLISH") return "BULLISH";
  if (tracker.trend === "BEARISH") return "BEARISH";
  return "RANGING";
}

/** @deprecated Use deriveTrendFromStructure for bar-accurate trend. Kept for simple callers. */
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

export function classifyMomentum(rsi: number | null, trend: Trend): Momentum {
  if (rsi === null) return "NEUTRAL";
  if (rsi > 70) return trend === "BULLISH" ? "STRONG_BULLISH" : "EXHAUSTING";
  if (rsi > 55) return trend === "BULLISH" ? "BULLISH" : "RECOVERY";
  if (rsi >= 45) return "NEUTRAL";
  if (rsi > 30) return trend === "BEARISH" ? "BEARISH" : "WEAKENING";
  return trend === "BEARISH" ? "STRONG_BEARISH" : "EXHAUSTING";
}

export function analyzeTimeframe(candles: Candle[], timeframe: CandleInterval): TimeframeAnalysis {
  if (candles.length < 20) {
    return {
      timeframe, trend: "RANGING", emaAlignment: "NEUTRAL", momentum: "NEUTRAL",
      bos: false, choch: false, swingHighs: [], swingLows: [],
    };
  }

  const closes = candles.map((c) => c.close);

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

  const rsi = new RSI(14);
  closes.forEach((c) => rsi.update(c));
  const rsiValue = rsi.current;

  const { highs: swingHighs, lows: swingLows } = detectSwingPoints(candles);
  const trend = deriveTrendFromStructure(swingHighs, swingLows, candles);
  const momentum = classifyMomentum(rsiValue, trend);

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

export function buildMarketStructure(
  timeframeAnalyses: Record<string, TimeframeAnalysis>
): MarketStructure {
  const tfs = Object.values(timeframeAnalyses);

  let bullishScore = 0;
  let bearishScore = 0;

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

  const allHighs = tfs.flatMap((t) => t.swingHighs);
  const allLows = tfs.flatMap((t) => t.swingLows);

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
