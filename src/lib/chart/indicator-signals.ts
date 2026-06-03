/**
 * Signal detection functions — each takes computed indicator arrays and
 * returns SeriesMarker[] to be rendered on the candlestick series via a
 * dedicated createSeriesMarkers plugin.
 */
import type { SeriesMarker, Time } from "lightweight-charts";

type SM = SeriesMarker<Time>;

function toT(ms: number): Time { return (ms / 1000) as Time; }

const UP   = "hsl(158 77% 42%)";   // janus-up-bright
const DOWN = "hsl(353 90% 62%)";   // janus-down-bright

// ─── MACD: zero-line cross + signal-line cross ────────────────────────────
export function detectMACDSignals(
  macd:      (number | null)[],
  signal:    (number | null)[],
  times:     number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < macd.length; i++) {
    const m0 = macd[i - 1], m1 = macd[i];
    const s0 = signal[i - 1], s1 = signal[i];
    if (m0 === null || m1 === null || s0 === null || s1 === null) continue;
    // Zero-line cross (larger arrow)
    if (m0 < 0 && m1 >= 0)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.4, text: "M0↑" });
    else if (m0 > 0 && m1 <= 0)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.4, text: "M0↓" });
    // Signal-line cross (small circle)
    if (m0 < s0 && m1 >= s1)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "circle",    color: UP,   size: 0.6, text: "" });
    else if (m0 > s0 && m1 <= s1)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle",    color: DOWN, size: 0.6, text: "" });
  }
  return out;
}

// ─── ADX: +DI / -DI cross when ADX ≥ threshold ───────────────────────────
export function detectADXSignals(
  adx:     (number | null)[],
  diPlus:  (number | null)[],
  diMinus: (number | null)[],
  times:   number[],
  minADX = 20
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < adx.length; i++) {
    const a = adx[i], p0 = diPlus[i-1], p1 = diPlus[i], m0 = diMinus[i-1], m1 = diMinus[i];
    if (a === null || p0 === null || p1 === null || m0 === null || m1 === null) continue;
    if (a < minADX) continue;
    if (p0 <= m0 && p1 > m1)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.1, text: `DI+` });
    else if (p0 >= m0 && p1 < m1)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.1, text: `DI-` });
  }
  return out;
}

// ─── SuperTrend / PSAR: direction flip ───────────────────────────────────
export function detectDirectionFlips(
  direction: ("up" | "down" | null)[],
  times:     number[],
  label:     string
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < direction.length; i++) {
    if (direction[i-1] === "down" && direction[i] === "up")
      out.push({ time: toT(times[i]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.1, text: `${label}↑` });
    else if (direction[i-1] === "up" && direction[i] === "down")
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.1, text: `${label}↓` });
  }
  return out;
}

// ─── Stochastic RSI: %K/%D cross inside OB/OS zones ─────────────────────
export function detectStochCross(
  k: (number | null)[],
  d: (number | null)[],
  times: number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < k.length; i++) {
    const k0 = k[i-1], k1 = k[i], d0 = d[i-1], d1 = d[i];
    if (k0 === null || k1 === null || d0 === null || d1 === null) continue;
    if (k0 <= d0 && k1 > d1 && k1 < 35)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "circle", color: UP,   size: 0.9, text: "StK" });
    if (k0 >= d0 && k1 < d1 && k1 > 65)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle", color: DOWN, size: 0.9, text: "StK" });
  }
  return out;
}

// ─── Z-Score: threshold cross (±2) ───────────────────────────────────────
export function detectZScoreSignals(
  zscore: (number | null)[],
  times:  number[],
  thresh = 2.0
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < zscore.length; i++) {
    const z0 = zscore[i-1], z1 = zscore[i];
    if (z0 === null || z1 === null) continue;
    if (z0 <  thresh && z1 >= thresh)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle", color: DOWN, size: 0.8, text: "Z>2" });
    if (z0 > -thresh && z1 <= -thresh)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "circle", color: UP,   size: 0.8, text: "Z<-2" });
    // Exit markers (smaller square)
    if (z0 >= thresh  && z1 < thresh)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "square", color: DOWN, size: 0.5, text: "" });
    if (z0 <= -thresh && z1 > -thresh)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "square", color: UP,   size: 0.5, text: "" });
  }
  return out;
}

// ─── Ichimoku: TK cross + Kumo breakout ──────────────────────────────────
export function detectIchimokuSignals(
  closes: number[],
  tenkan: (number | null)[],
  kijun:  (number | null)[],
  spanA:  (number | null)[],
  spanB:  (number | null)[],
  times:  number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < closes.length; i++) {
    const t0 = tenkan[i-1], t1 = tenkan[i], k0 = kijun[i-1], k1 = kijun[i];
    const sA = spanA[i], sB = spanB[i];
    // TK cross
    if (t0 !== null && t1 !== null && k0 !== null && k1 !== null) {
      if (t0 <= k0 && t1 > k1)
        out.push({ time: toT(times[i]), position: "belowBar", shape: "circle",    color: UP,   size: 0.8, text: "TK↑" });
      else if (t0 >= k0 && t1 < k1)
        out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle",    color: DOWN, size: 0.8, text: "TK↓" });
    }
    // Kumo breakout
    if (sA !== null && sB !== null) {
      const cTop = Math.max(sA, sB), cBot = Math.min(sA, sB);
      if (closes[i-1] <= cTop && closes[i] > cTop)
        out.push({ time: toT(times[i]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.3, text: "Kumo↑" });
      else if (closes[i-1] >= cBot && closes[i] < cBot)
        out.push({ time: toT(times[i]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.3, text: "Kumo↓" });
    }
  }
  return out;
}

// ─── Donchian: close breaks outside channel ───────────────────────────────
export function detectDonchianBreakout(
  closes: number[],
  upper:  (number | null)[],
  lower:  (number | null)[],
  times:  number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < closes.length; i++) {
    const u = upper[i-1], l = lower[i-1];   // prev bar avoids lookahead
    if (u === null || l === null) continue;
    if (closes[i] > u && closes[i-1] <= u)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.0, text: "Don↑" });
    else if (closes[i] < l && closes[i-1] >= l)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.0, text: "Don↓" });
  }
  return out;
}

// ─── Nadaraya-Watson: close tags outer band ───────────────────────────────
export function detectNWBandTag(
  closes: number[],
  upper:  (number | null)[],
  lower:  (number | null)[],
  times:  number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < closes.length; i++) {
    const u = upper[i], l = lower[i], u0 = upper[i-1], l0 = lower[i-1];
    if (u === null || l === null || u0 === null || l0 === null) continue;
    if (closes[i] >= u && closes[i-1] < u0)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle", color: DOWN, size: 0.7, text: "NW↑" });
    if (closes[i] <= l && closes[i-1] > l0)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "circle", color: UP,   size: 0.7, text: "NW↓" });
  }
  return out;
}

// ─── VWAP: reclaim / loss ─────────────────────────────────────────────────
export function detectVWAPSignals(
  closes: number[],
  vwap:   (number | null)[],
  times:  number[]
): SM[] {
  const out: SM[] = [];
  for (let i = 1; i < closes.length; i++) {
    const v0 = vwap[i-1], v1 = vwap[i];
    if (v0 === null || v1 === null) continue;
    if (closes[i-1] <= v0 && closes[i] > v1)
      out.push({ time: toT(times[i]), position: "belowBar", shape: "circle", color: UP,   size: 0.6, text: "V↑" });
    else if (closes[i-1] >= v0 && closes[i] < v1)
      out.push({ time: toT(times[i]), position: "aboveBar", shape: "circle", color: DOWN, size: 0.6, text: "V↓" });
  }
  return out;
}

// ─── Pivot helpers (shared by divergence detectors) ──────────────────────
function isPivotHigh(vals: number[], i: number, n: number): boolean {
  if (i < n || i + n >= vals.length) return false;
  for (let j = i - n; j <= i + n; j++) {
    if (j !== i && vals[j] >= vals[i]) return false;
  }
  return true;
}
function isPivotLow(vals: number[], i: number, n: number): boolean {
  if (i < n || i + n >= vals.length) return false;
  for (let j = i - n; j <= i + n; j++) {
    if (j !== i && vals[j] <= vals[i]) return false;
  }
  return true;
}

// ─── RSI Divergence ───────────────────────────────────────────────────────
export function detectRSIDivergence(
  closes: number[],
  rsi:    (number | null)[],
  times:  number[],
  pivotN  = 3,
  maxGap  = 40
): SM[] {
  const out: SM[] = [];
  const rsiF = rsi.map((v) => v ?? 0);
  const seen = new Set<number>();

  const highs: number[] = [];
  const lows:  number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isPivotHigh(closes, i, pivotN)) highs.push(i);
    if (isPivotLow(closes, i, pivotN))  lows.push(i);
  }

  // Bearish: price higher high + RSI lower high
  for (let k = 1; k < highs.length; k++) {
    const a = highs[k - 1], b = highs[k];
    if (b - a > maxGap || seen.has(b)) continue;
    if (closes[b] > closes[a] && rsiF[b] < rsiF[a]) {
      out.push({ time: toT(times[b]), position: "aboveBar", shape: "arrowDown", color: DOWN, size: 1.6, text: "Div↓" });
      seen.add(b);
    }
  }
  // Bullish: price lower low + RSI higher low
  for (let k = 1; k < lows.length; k++) {
    const a = lows[k - 1], b = lows[k];
    if (b - a > maxGap || seen.has(b)) continue;
    if (closes[b] < closes[a] && rsiF[b] > rsiF[a]) {
      out.push({ time: toT(times[b]), position: "belowBar", shape: "arrowUp",   color: UP,   size: 1.6, text: "Div↑" });
      seen.add(b);
    }
  }
  return out;
}

// ─── CVD Divergence ───────────────────────────────────────────────────────
export function detectCVDDivergence(
  closes: number[],
  cvd:    (number | null)[],
  times:  number[],
  pivotN  = 3,
  maxGap  = 40
): SM[] {
  const out: SM[] = [];
  const cvdF = cvd.map((v) => v ?? 0);
  const seen = new Set<number>();

  const highs: number[] = [];
  const lows:  number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isPivotHigh(closes, i, pivotN)) highs.push(i);
    if (isPivotLow(closes, i, pivotN))  lows.push(i);
  }

  for (let k = 1; k < highs.length; k++) {
    const a = highs[k - 1], b = highs[k];
    if (b - a > maxGap || seen.has(b)) continue;
    if (closes[b] > closes[a] && cvdF[b] < cvdF[a]) {
      out.push({ time: toT(times[b]), position: "aboveBar", shape: "square", color: DOWN, size: 0.9, text: "CVD↓" });
      seen.add(b);
    }
  }
  for (let k = 1; k < lows.length; k++) {
    const a = lows[k - 1], b = lows[k];
    if (b - a > maxGap || seen.has(b)) continue;
    if (closes[b] < closes[a] && cvdF[b] > cvdF[a]) {
      out.push({ time: toT(times[b]), position: "belowBar", shape: "square", color: UP,   size: 0.9, text: "CVD↑" });
      seen.add(b);
    }
  }
  return out;
}
