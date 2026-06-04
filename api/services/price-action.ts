/**
 * Price Action Analysis Service
 * Pure functions for Smart Money Concept (SMC) / ICT-style price action analysis.
 * No side effects. No external imports. Strict TypeScript compatible.
 */

// ─── Internal Kline Type ───

export interface Kline {
  time:   number;  // openTime ms
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export function klinesFromBinance(
  raw: Array<{ openTime: number; open: string; high: string; low: string; close: string; volume: string }>
): Kline[] {
  return raw.map((r) => ({
    time: r.openTime, open: parseFloat(r.open), high: parseFloat(r.high),
    low: parseFloat(r.low), close: parseFloat(r.close), volume: parseFloat(r.volume),
  }));
}

// ─── Private Helpers ───

/** Sliding-window ATR using simple avg of (high − low). Index < period−1 is 0. */
export function computeAtrArray(klines: Kline[], period: number): number[] {
  const len  = klines.length;
  const atrs = new Array<number>(len).fill(0);
  if (len < period) return atrs;

  let windowSum = 0;
  for (let i = 0; i < period; i++) windowSum += klines[i].high - klines[i].low;
  atrs[period - 1] = windowSum / period;

  for (let i = period; i < len; i++) {
    windowSum += klines[i].high - klines[i].low;
    windowSum -= klines[i - period].high - klines[i - period].low;
    atrs[i] = windowSum / period;
  }
  return atrs;
}

// ─── 1. Swing Points ───

export interface SwingPoint {
  time:     number;
  price:    number;
  type:     "high" | "low";
  strength: number;  // 1–10
  index:    number;
  label?:   "HH" | "LH" | "HL" | "LL";
}

export function detectSwings(klines: Kline[], lookback = 5): SwingPoint[] {
  const N = lookback;
  if (klines.length < 2 * N + 1) return [];

  const strength = Math.min(10, N);
  const swings: SwingPoint[] = [];

  for (let i = N; i < klines.length - N; i++) {
    const curHigh = klines[i].high;
    const curLow  = klines[i].low;

    let isSwingHigh = true;
    for (let j = i - N; j < i && isSwingHigh; j++) {
      if (klines[j].high >= curHigh) isSwingHigh = false;
    }
    for (let j = i + 1; j <= i + N && isSwingHigh; j++) {
      if (klines[j].high >= curHigh) isSwingHigh = false;
    }

    let isSwingLow = true;
    for (let j = i - N; j < i && isSwingLow; j++) {
      if (klines[j].low <= curLow) isSwingLow = false;
    }
    for (let j = i + 1; j <= i + N && isSwingLow; j++) {
      if (klines[j].low <= curLow) isSwingLow = false;
    }

    if (isSwingHigh) swings.push({ time: klines[i].time, price: curHigh, type: "high", strength, index: i });
    if (isSwingLow)  swings.push({ time: klines[i].time, price: curLow,  type: "low",  strength, index: i });
  }

  // Classify Highs and Lows (HH, LH, HL, LL)
  let lastHighPrice = -Infinity;
  let lastLowPrice = Infinity;
  let firstHigh = true;
  let firstLow = true;

  for (const s of swings) {
    if (s.type === "high") {
      if (!firstHigh) {
        s.label = s.price > lastHighPrice ? "HH" : "LH";
      } else {
        s.label = "HH";
        firstHigh = false;
      }
      lastHighPrice = s.price;
    } else {
      if (!firstLow) {
        s.label = s.price > lastLowPrice ? "HL" : "LL";
      } else {
        s.label = "LL";
        firstLow = false;
      }
      lastLowPrice = s.price;
    }
  }

  return swings;
}

// ─── 2. Order Blocks ───

export interface OrderBlock {
  time:         number;
  top:          number;
  bottom:       number;
  type:         "bullish" | "bearish";
  mitigated:    boolean;
  mitigatedAt?: number;
  strength:     number;
}

const OB_ATR_PERIOD = 14;
const OB_LOOKBACK   = 10;
const OB_MIN_RUN    = 3;
const MAX_OBS       = 20;

function buildOrderBlock(
  obCandle: Kline, dispCandle: Kline, runStart: number,
  type: "bullish" | "bearish", klines: Kline[], atrs: number[]
): OrderBlock {
  const atr      = atrs[runStart] > 0 ? atrs[runStart] : 1;
  const strength = Math.abs(dispCandle.close - dispCandle.open) / atr;
  const obMid    = (obCandle.high + obCandle.low) / 2;

  let mitigated  = false;
  let mitigatedAt: number | undefined;
  for (let m = runStart; m < klines.length; m++) {
    const hit = type === "bullish" ? klines[m].close < obMid : klines[m].close > obMid;
    if (hit) { mitigated = true; mitigatedAt = klines[m].time; break; }
  }

  const ob: OrderBlock = { time: obCandle.time, top: obCandle.high, bottom: obCandle.low, type, mitigated, strength };
  if (mitigatedAt !== undefined) ob.mitigatedAt = mitigatedAt;
  return ob;
}

export function detectOrderBlocks(klines: Kline[], swings: SwingPoint[]): OrderBlock[] {
  if (klines.length < OB_ATR_PERIOD + OB_MIN_RUN || swings.length === 0) return [];

  const atrs       = computeAtrArray(klines, OB_ATR_PERIOD);
  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows  = swings.filter((s) => s.type === "low");
  const obs: OrderBlock[] = [];

  // Bullish OBs
  let bullRunStart = -1;
  for (let i = 0; i <= klines.length; i++) {
    const isBull = i < klines.length && klines[i].close > klines[i].open;
    if (isBull) {
      if (bullRunStart === -1) bullRunStart = i;
    } else {
      if (bullRunStart !== -1 && i - bullRunStart >= OB_MIN_RUN) {
        let runHighClose = -Infinity;
        for (let r = bullRunStart; r < i; r++) {
          if (klines[r].close > runHighClose) runHighClose = klines[r].close;
        }
        const brokenSwing = swingHighs.find((s) => s.index < bullRunStart && s.price < runHighClose);
        if (brokenSwing) {
          let obIdx = -1;
          for (let b = bullRunStart - 1; b >= Math.max(0, bullRunStart - OB_LOOKBACK); b--) {
            if (klines[b].close < klines[b].open) { obIdx = b; break; }
          }
          if (obIdx !== -1) obs.push(buildOrderBlock(klines[obIdx], klines[bullRunStart], bullRunStart, "bullish", klines, atrs));
        }
        bullRunStart = -1;
      } else {
        bullRunStart = -1;
      }
    }
  }

  // Bearish OBs
  let bearRunStart = -1;
  for (let i = 0; i <= klines.length; i++) {
    const isBear = i < klines.length && klines[i].close < klines[i].open;
    if (isBear) {
      if (bearRunStart === -1) bearRunStart = i;
    } else {
      if (bearRunStart !== -1 && i - bearRunStart >= OB_MIN_RUN) {
        let runLowClose = Infinity;
        for (let r = bearRunStart; r < i; r++) {
          if (klines[r].close < runLowClose) runLowClose = klines[r].close;
        }
        const brokenSwing = swingLows.find((s) => s.index < bearRunStart && s.price > runLowClose);
        if (brokenSwing) {
          let obIdx = -1;
          for (let b = bearRunStart - 1; b >= Math.max(0, bearRunStart - OB_LOOKBACK); b--) {
            if (klines[b].close > klines[b].open) { obIdx = b; break; }
          }
          if (obIdx !== -1) obs.push(buildOrderBlock(klines[obIdx], klines[bearRunStart], bearRunStart, "bearish", klines, atrs));
        }
        bearRunStart = -1;
      } else {
        bearRunStart = -1;
      }
    }
  }

  if (obs.length <= MAX_OBS) return obs;
  const mitigatedObs = obs.filter((o) =>  o.mitigated).sort((a, b) => a.time - b.time);
  const activeObs    = obs.filter((o) => !o.mitigated).sort((a, b) => a.time - b.time);
  return [...mitigatedObs, ...activeObs].slice(-MAX_OBS);
}

// ─── 3. Fair Value Gaps ───

export interface FairValueGap {
  startTime:   number;
  endTime:     number;
  top:         number;
  bottom:      number;
  midpoint:    number;
  type:        "bullish" | "bearish";
  filled:      boolean;
  fillPercent: number;
}

const MAX_FVGS = 20;

export function detectFVGs(klines: Kline[]): FairValueGap[] {
  if (klines.length < 3) return [];

  const fvgs: FairValueGap[] = [];

  for (let i = 2; i < klines.length; i++) {
    const c1 = klines[i - 2];
    const c3 = klines[i];

    // Bullish FVG: gap above c1.high, below c3.low
    if (c1.high < c3.low) {
      const bottom  = c1.high;
      const top     = c3.low;
      const gapSize = top - bottom;
      let maxPen = 0;
      for (let m = i + 1; m < klines.length; m++) {
        if (klines[m].low < top) {
          const pen = top - Math.max(klines[m].low, bottom);
          if (pen > maxPen) maxPen = pen;
        }
      }
      const fillPercent = gapSize > 0 ? Math.min(100, (maxPen / gapSize) * 100) : 0;
      fvgs.push({ startTime: c1.time, endTime: c3.time, top, bottom, midpoint: (top + bottom) / 2,
        type: "bullish", filled: fillPercent >= 50, fillPercent });
    }

    // Bearish FVG: gap above c3.high, below c1.low
    if (c3.high < c1.low) {
      const bottom  = c3.high;
      const top     = c1.low;
      const gapSize = top - bottom;
      let maxPen = 0;
      for (let m = i + 1; m < klines.length; m++) {
        if (klines[m].high > bottom) {
          const pen = Math.min(klines[m].high, top) - bottom;
          if (pen > maxPen) maxPen = pen;
        }
      }
      const fillPercent = gapSize > 0 ? Math.min(100, (maxPen / gapSize) * 100) : 0;
      fvgs.push({ startTime: c1.time, endTime: c3.time, top, bottom, midpoint: (top + bottom) / 2,
        type: "bearish", filled: fillPercent >= 50, fillPercent });
    }
  }

  if (fvgs.length <= MAX_FVGS) return fvgs;
  const filled   = fvgs.filter((f) =>  f.filled).sort((a, b) => a.startTime - b.startTime);
  const unfilled = fvgs.filter((f) => !f.filled).sort((a, b) => a.startTime - b.startTime);
  return [...filled, ...unfilled].slice(-MAX_FVGS);
}

// ─── 4. Market Structure (BOS / CHoCH) ───

export interface StructureBreak {
  time:             number;
  price:            number;
  type:             "BOS" | "CHoCH";
  direction:        "bullish" | "bearish";
  brokenSwingTime:  number;
  brokenSwingPrice: number;
}

const MAX_STRUCTURE = 10;

export function detectStructure(klines: Kline[], swings: SwingPoint[]): StructureBreak[] {
  if (klines.length === 0 || swings.length < 2) return [];

  const breaks: StructureBreak[] = [];
  const sortedSwings = [...swings].sort((a, b) => a.index - b.index);

  let trend: "up" | "down" | "unknown" = "unknown";
  let lastHigh: SwingPoint | null = null;
  let lastLow:  SwingPoint | null = null;
  let swingCursor   = 0;
  let minSwingIndex = 0;

  for (let i = 1; i < klines.length; i++) {
    while (swingCursor < sortedSwings.length && sortedSwings[swingCursor].index < i) {
      const s = sortedSwings[swingCursor];
      if (s.index >= minSwingIndex) {
        if (s.type === "high") { if (!lastHigh || s.index > lastHigh.index) lastHigh = s; }
        else                   { if (!lastLow  || s.index > lastLow.index)  lastLow  = s; }
      }
      swingCursor++;
    }

    const close = klines[i].close;

    if (trend === "unknown") {
      if (lastHigh && close > lastHigh.price) {
        breaks.push({ time: klines[i].time, price: close, type: "BOS", direction: "bullish",
          brokenSwingTime: lastHigh.time, brokenSwingPrice: lastHigh.price });
        trend = "up"; minSwingIndex = i; lastHigh = null; lastLow = null;
      } else if (lastLow && close < lastLow.price) {
        breaks.push({ time: klines[i].time, price: close, type: "BOS", direction: "bearish",
          brokenSwingTime: lastLow.time, brokenSwingPrice: lastLow.price });
        trend = "down"; minSwingIndex = i; lastHigh = null; lastLow = null;
      }
    } else if (trend === "up") {
      if (lastHigh && close > lastHigh.price) {
        breaks.push({ time: klines[i].time, price: close, type: "BOS", direction: "bullish",
          brokenSwingTime: lastHigh.time, brokenSwingPrice: lastHigh.price });
        minSwingIndex = i; lastHigh = null; lastLow = null;
      } else if (lastLow && close < lastLow.price) {
        breaks.push({ time: klines[i].time, price: close, type: "CHoCH", direction: "bearish",
          brokenSwingTime: lastLow.time, brokenSwingPrice: lastLow.price });
        trend = "down"; minSwingIndex = i; lastHigh = null; lastLow = null;
      }
    } else {
      if (lastLow && close < lastLow.price) {
        breaks.push({ time: klines[i].time, price: close, type: "BOS", direction: "bearish",
          brokenSwingTime: lastLow.time, brokenSwingPrice: lastLow.price });
        minSwingIndex = i; lastHigh = null; lastLow = null;
      } else if (lastHigh && close > lastHigh.price) {
        breaks.push({ time: klines[i].time, price: close, type: "CHoCH", direction: "bullish",
          brokenSwingTime: lastHigh.time, brokenSwingPrice: lastHigh.price });
        trend = "up"; minSwingIndex = i; lastHigh = null; lastLow = null;
      }
    }
  }

  return breaks.slice(-MAX_STRUCTURE);
}

// ─── 5. Liquidity Levels ───

export interface LiquidityLevel {
  price:      number;
  type:       "buy-side" | "sell-side";
  touchCount: number;
  times:      number[];
  swept:      boolean;
  sweptTime?: number;
}

const MAX_LIQUIDITY = 10;

function buildLiquidityLevel(
  pts: SwingPoint[], levelType: "buy-side" | "sell-side",
  klines: Kline[], tolerance: number
): LiquidityLevel {
  const avgPrice = pts.reduce((s, p) => s + p.price, 0) / pts.length;
  const lastIdx  = pts.reduce((m, p) => p.index > m ? p.index : m, -1);

  let swept = false;
  let sweptTime: number | undefined;
  for (let k = lastIdx + 1; k < klines.length; k++) {
    const hit = levelType === "buy-side"
      ? klines[k].close > avgPrice * (1 + tolerance)
      : klines[k].close < avgPrice * (1 - tolerance);
    if (hit) { swept = true; sweptTime = klines[k].time; break; }
  }

  const level: LiquidityLevel = { price: avgPrice, type: levelType, touchCount: pts.length,
    times: pts.map((p) => p.time), swept };
  if (sweptTime !== undefined) level.sweptTime = sweptTime;
  return level;
}

export function detectLiquidity(klines: Kline[], swings: SwingPoint[], tolerance = 0.001): LiquidityLevel[] {
  if (klines.length === 0 || swings.length === 0) return [];

  const highs = swings.filter((s) => s.type === "high").sort((a, b) => a.price - b.price);
  const lows  = swings.filter((s) => s.type === "low").sort((a, b) => a.price - b.price);

  function cluster(pts: SwingPoint[], t: "buy-side" | "sell-side"): LiquidityLevel[] {
    if (pts.length === 0) return [];
    const levels: LiquidityLevel[] = [];
    let group: SwingPoint[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].price - group[0].price) / group[0].price <= tolerance) {
        group.push(pts[i]);
      } else {
        levels.push(buildLiquidityLevel(group, t, klines, tolerance));
        group = [pts[i]];
      }
    }
    levels.push(buildLiquidityLevel(group, t, klines, tolerance));
    return levels;
  }

  const all = [...cluster(highs, "buy-side"), ...cluster(lows, "sell-side")]
    .sort((a, b) => (a.times[a.times.length - 1] ?? 0) - (b.times[b.times.length - 1] ?? 0));

  return all.slice(-MAX_LIQUIDITY);
}

// ─── 6. Displacement Candles ───

export interface DisplacementCandle {
  time:        number;
  direction:   "bullish" | "bearish";
  bodySize:    number;
  atrMultiple: number;
}

export function detectDisplacement(klines: Kline[], atrPeriod = 14, minMultiple = 2.0): DisplacementCandle[] {
  if (klines.length < atrPeriod) return [];

  const atrs   = computeAtrArray(klines, atrPeriod);
  const result: DisplacementCandle[] = [];

  for (let i = atrPeriod - 1; i < klines.length; i++) {
    const atr = atrs[i];
    if (atr === 0) continue;
    const body = Math.abs(klines[i].close - klines[i].open);
    if (body > minMultiple * atr) {
      result.push({ time: klines[i].time,
        direction: klines[i].close >= klines[i].open ? "bullish" : "bearish",
        bodySize: body, atrMultiple: body / atr });
    }
  }
  return result;
}

// ─── 7. Premium / Discount Zones ───

export interface PremiumDiscountZone {
  swingHigh:     number;
  swingLow:      number;
  equilibrium:   number;
  premiumBottom: number;
  discountTop:   number;
}

export function detectPremiumDiscount(swings: SwingPoint[]): PremiumDiscountZone | null {
  const highs = swings.filter((s) => s.type === "high");
  const lows  = swings.filter((s) => s.type === "low");
  if (highs.length === 0 || lows.length === 0) return null;

  const lastHigh = highs.reduce((m, s) => s.index > m.index ? s : m);
  const lastLow  = lows.reduce((m, s)  => s.index > m.index ? s : m);

  const swingHigh = lastHigh.price;
  const swingLow  = lastLow.price;
  if (swingHigh <= swingLow) return null;

  const range = swingHigh - swingLow;
  return {
    swingHigh, swingLow,
    equilibrium:   swingLow + range * 0.50,
    premiumBottom: swingLow + range * 0.75,
    discountTop:   swingLow + range * 0.25,
  };
}

// ─── 8. On-Balance Volume (OBV) ───

export interface OBVPoint {
  time:  number;  // openTime ms
  value: number;  // running OBV
}

export function calculateOBV(klines: Kline[]): OBVPoint[] {
  if (klines.length === 0) return [];
  const result: OBVPoint[] = [];
  let obv = 0;
  result.push({ time: klines[0].time, value: 0 });

  for (let i = 1; i < klines.length; i++) {
    if (klines[i].close > klines[i - 1].close)      obv += klines[i].volume;
    else if (klines[i].close < klines[i - 1].close) obv -= klines[i].volume;
    // equal close → OBV unchanged
    result.push({ time: klines[i].time, value: obv });
  }
  return result;
}

// ─── Aggregate ───

export interface PriceActionData {
  swings:          SwingPoint[];
  orderBlocks:     OrderBlock[];
  fvgs:            FairValueGap[];
  structure:       StructureBreak[];
  liquidity:       LiquidityLevel[];
  displacement:    DisplacementCandle[];
  premiumDiscount: PremiumDiscountZone | null;
  obv:             OBVPoint[];
}

export function analyzeAll(klines: Kline[]): PriceActionData {
  const swings       = detectSwings(klines);
  return {
    swings,
    orderBlocks:     detectOrderBlocks(klines, swings),
    fvgs:            detectFVGs(klines),
    structure:       detectStructure(klines, swings),
    liquidity:       detectLiquidity(klines, swings),
    displacement:    detectDisplacement(klines),
    premiumDiscount: detectPremiumDiscount(swings),
    obv:             calculateOBV(klines),
  };
}
