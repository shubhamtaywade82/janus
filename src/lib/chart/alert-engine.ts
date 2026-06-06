/**
 * Alert Engine — detects indicator & SMC events on each new candle.
 * Pure functions, no side effects.
 */
import { calcEMA, calcBB, calcSuperTrend, calcRSI, calcVWAP } from "./indicators";
import type { PriceActionData } from "./pa-types";
import type { IndicatorConfig } from "../../components/IndicatorPanel";

export interface AlertConfig {
  // Indicator alerts
  emaCross:        boolean;  // EMA9 × EMA21 crossover
  bbBreakout:      boolean;  // Close outside BB bands
  superTrendFlip:  boolean;  // ST direction changes
  rsiExtreme:      boolean;  // RSI crosses 70/30
  vwapCross:       boolean;  // Price crosses VWAP
  // KNN SuperTrend alerts
  knnFlip:         boolean;  // KNN bias direction change
  knnRejection:    boolean;  // Rejection orb at SuperTrend level
  knnRegimeChange: boolean;  // Market regime transition (trend↔range)
  // SMC alerts
  bosSignal:       boolean;  // New BOS detected
  chochSignal:     boolean;  // New CHoCH detected
  obTouch:         boolean;  // Price re-enters an Order Block
  fvgFill:         boolean;  // FVG fill% increases
  liqSweep:        boolean;  // Liquidity level swept
}

export const ALERT_DEFAULTS: AlertConfig = {
  emaCross: true, bbBreakout: true, superTrendFlip: true,
  rsiExtreme: true, vwapCross: false,
  knnFlip: true, knnRejection: true, knnRegimeChange: true,
  bosSignal: true, chochSignal: true, obTouch: false, fvgFill: false, liqSweep: true,
};

export interface AlertEvent {
  id:        string;
  type:      string;
  symbol:    string;
  message:   string;
  price:     number;
  direction: "bullish" | "bearish" | "neutral";
  timestamp: number;
  emoji:     string;
}

interface KlineSimple {
  openTime: number; open: string; high: string; low: string; close: string; volume: string;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

// ─── Indicator alert detection ───
export function checkIndicatorAlerts(
  data: KlineSimple[],
  cfg: AlertConfig,
  indCfg: IndicatorConfig,
  symbol: string
): AlertEvent[] {
  if (data.length < 3) return [];
  const events: AlertEvent[] = [];
  const closes  = data.map((d) => parseFloat(d.close));
  const highs   = data.map((d) => parseFloat(d.high));
  const lows    = data.map((d) => parseFloat(d.low));
  const volumes = data.map((d) => parseFloat(d.volume));
  const times   = data.map((d) => d.openTime);
  const n       = closes.length - 1;  // last candle index
  const price   = closes[n];

  // ─── EMA Cross (9 × 21) ───
  if (cfg.emaCross) {
    const ema9  = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const [a9, b9, a21, b21] = [ema9[n-1], ema9[n], ema21[n-1], ema21[n]];
    if (a9 !== null && b9 !== null && a21 !== null && b21 !== null) {
      if (a9 <= a21 && b9 > b21)
        events.push({ id: uid(), type: "ema_cross", symbol, price, direction: "bullish", timestamp: times[n],
          emoji: "📈", message: `EMA9 crossed ABOVE EMA21 — bullish cross` });
      if (a9 >= a21 && b9 < b21)
        events.push({ id: uid(), type: "ema_cross", symbol, price, direction: "bearish", timestamp: times[n],
          emoji: "📉", message: `EMA9 crossed BELOW EMA21 — bearish cross` });
    }
  }

  // ─── Bollinger Band Breakout ───
  if (cfg.bbBreakout) {
    const { upper, lower } = calcBB(closes, indCfg.bbPeriod, indCfg.bbMult);
    const [pu, pl, cu, cl] = [upper[n-1], lower[n-1], upper[n], lower[n]];
    const prevClose = closes[n-1];
    if (cu !== null && cl !== null && pu !== null && pl !== null) {
      if (prevClose <= pu && price > cu)
        events.push({ id: uid(), type: "bb_breakout", symbol, price, direction: "bullish", timestamp: times[n],
          emoji: "🚀", message: `Price broke ABOVE upper Bollinger Band (${cu.toFixed(2)})` });
      if (prevClose >= pl && price < cl)
        events.push({ id: uid(), type: "bb_breakout", symbol, price, direction: "bearish", timestamp: times[n],
          emoji: "💥", message: `Price broke BELOW lower Bollinger Band (${cl.toFixed(2)})` });
    }
  }

  // ─── SuperTrend Direction Flip ───
  if (cfg.superTrendFlip) {
    const { direction } = calcSuperTrend(highs, lows, closes, indCfg.superTrendPeriod, indCfg.superTrendMult);
    const [prev, curr] = [direction[n-1], direction[n]];
    if (prev === "down" && curr === "up")
      events.push({ id: uid(), type: "supertrend_flip", symbol, price, direction: "bullish", timestamp: times[n],
        emoji: "🟢", message: `SuperTrend flipped BULLISH` });
    if (prev === "up" && curr === "down")
      events.push({ id: uid(), type: "supertrend_flip", symbol, price, direction: "bearish", timestamp: times[n],
        emoji: "🔴", message: `SuperTrend flipped BEARISH` });
  }

  // ─── RSI Extreme (crosses 70 / 30) ───
  if (cfg.rsiExtreme) {
    const rsi = calcRSI(closes, indCfg.rsiPeriod);
    const [rPrev, rCurr] = [rsi[n-1], rsi[n]];
    if (rPrev !== null && rCurr !== null) {
      if (rPrev < 70 && rCurr >= 70)
        events.push({ id: uid(), type: "rsi_extreme", symbol, price, direction: "bearish", timestamp: times[n],
          emoji: "⚠️", message: `RSI entered OVERBOUGHT zone (${rCurr.toFixed(1)} > 70)` });
      if (rPrev > 30 && rCurr <= 30)
        events.push({ id: uid(), type: "rsi_extreme", symbol, price, direction: "bullish", timestamp: times[n],
          emoji: "⚠️", message: `RSI entered OVERSOLD zone (${rCurr.toFixed(1)} < 30)` });
      if (rPrev >= 70 && rCurr < 70)
        events.push({ id: uid(), type: "rsi_extreme", symbol, price, direction: "bullish", timestamp: times[n],
          emoji: "📊", message: `RSI exited overbought — potential reversal (${rCurr.toFixed(1)})` });
      if (rPrev <= 30 && rCurr > 30)
        events.push({ id: uid(), type: "rsi_extreme", symbol, price, direction: "bearish", timestamp: times[n],
          emoji: "📊", message: `RSI exited oversold — potential reversal (${rCurr.toFixed(1)})` });
    }
  }

  // ─── VWAP Cross ───
  if (cfg.vwapCross) {
    const vwap = calcVWAP(times, highs, lows, closes, volumes);
    const [vp, vc] = [vwap.vwap[n-1], vwap.vwap[n]];
    const prevClose = closes[n-1];
    if (vp !== null && vc !== null) {
      if (prevClose < vp && price > vc)
        events.push({ id: uid(), type: "vwap_cross", symbol, price, direction: "bullish", timestamp: times[n],
          emoji: "📈", message: `Price crossed ABOVE VWAP (${vc.toFixed(2)})` });
      if (prevClose > vp && price < vc)
        events.push({ id: uid(), type: "vwap_cross", symbol, price, direction: "bearish", timestamp: times[n],
          emoji: "📉", message: `Price crossed BELOW VWAP (${vc.toFixed(2)})` });
    }
  }

  return events;
}

// ─── SMC alert detection — compare new vs previous priceAction data ───
export function checkSMCAlerts(
  paNew: PriceActionData,
  paOld: PriceActionData | null,
  currentPrice: number,
  symbol: string,
  cfg: AlertConfig
): AlertEvent[] {
  if (!paOld) return [];
  const events: AlertEvent[] = [];
  const now = Date.now();

  // ─── New BOS ───
  if (cfg.bosSignal) {
    const oldBOS = new Set(paOld.structure.filter(s => s.type === "BOS").map(s => s.time));
    for (const sb of paNew.structure) {
      if (sb.type !== "BOS" || oldBOS.has(sb.time)) continue;
      events.push({ id: uid(), type: "smc_bos", symbol, price: sb.price, direction: sb.direction,
        timestamp: now, emoji: sb.direction === "bullish" ? "⬆️" : "⬇️",
        message: `BOS — ${sb.direction.toUpperCase()} structure break at ${sb.price.toFixed(2)}` });
    }
  }

  // ─── New CHoCH ───
  if (cfg.chochSignal) {
    const oldCH = new Set(paOld.structure.filter(s => s.type === "CHoCH").map(s => s.time));
    for (const sb of paNew.structure) {
      if (sb.type !== "CHoCH" || oldCH.has(sb.time)) continue;
      events.push({ id: uid(), type: "smc_choch", symbol, price: sb.price, direction: sb.direction,
        timestamp: now, emoji: sb.direction === "bullish" ? "🔄⬆️" : "🔄⬇️",
        message: `CHoCH — ${sb.direction.toUpperCase()} reversal signal at ${sb.price.toFixed(2)}` });
    }
  }

  // ─── OB Touch (price enters an active OB zone) ───
  if (cfg.obTouch) {
    for (const ob of paNew.orderBlocks) {
      if (ob.mitigated) continue;
      if (currentPrice >= ob.bottom && currentPrice <= ob.top) {
        const wasInside = paOld.orderBlocks.some(
          (old) => old.time === ob.time && !old.mitigated
        );
        // Only fire if OB existed before (not brand new) to avoid noise
        if (wasInside) {
          events.push({ id: uid(), type: "smc_ob_touch", symbol, price: currentPrice,
            direction: ob.type === "bullish" ? "bullish" : "bearish", timestamp: now,
            emoji: ob.type === "bullish" ? "🟩" : "🟥",
            message: `Price touching ${ob.type.toUpperCase()} Order Block [${ob.bottom.toFixed(2)}–${ob.top.toFixed(2)}]` });
        }
      }
    }
  }

  // ─── FVG being filled ───
  if (cfg.fvgFill) {
    for (const fvg of paNew.fvgs) {
      const old = paOld.fvgs.find((f) => f.startTime === fvg.startTime);
      if (!old || fvg.filled === old.filled) continue;
      if (fvg.filled && !old.filled)
        events.push({ id: uid(), type: "smc_fvg_fill", symbol, price: currentPrice,
          direction: fvg.type === "bullish" ? "bullish" : "bearish", timestamp: now,
          emoji: "🕳️",
          message: `${fvg.type.toUpperCase()} FVG filled [${fvg.bottom.toFixed(2)}–${fvg.top.toFixed(2)}]` });
    }
  }

  // ─── Liquidity swept ───
  if (cfg.liqSweep) {
    for (const liq of paNew.liquidity) {
      const old = paOld.liquidity.find((l) => Math.abs(l.price - liq.price) < 0.01);
      if (!old || liq.swept === old.swept) continue;
      if (liq.swept && !old.swept)
        events.push({ id: uid(), type: "smc_liq_sweep", symbol, price: currentPrice,
          direction: liq.type === "buy-side" ? "bullish" : "bearish", timestamp: now,
          emoji: "💧",
          message: `Liquidity SWEPT — ${liq.type === "buy-side" ? "EQH" : "EQL"} at ${liq.price.toFixed(2)}` });
    }
  }

  return events;
}

// ─── KNN SuperTrend alert detection ──────────────────────────────────────────
// Called when a new KNN snapshot arrives (from signal.knnStream subscription).
// `prev` is the last snapshot for this symbol; null on first call.

export interface KnnSnapshotLike {
  knn: { bias: string; confidence: number };
  supertrend: { direction: string; flip: boolean; level: number };
  rejection: { signal: boolean; type: string | null; wickToBody: number; volumeScore: number };
  regime: string;
  price: number;
  setupQuality: string;
  note: string;
  entryAllowed: boolean;
}

export function checkKnnAlerts(
  snap: KnnSnapshotLike,
  prev: KnnSnapshotLike | null,
  cfg: AlertConfig,
  symbol: string
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const now = Date.now();
  const price = snap.price;

  // ─── KNN bias flip ───
  if (cfg.knnFlip && prev && snap.knn.bias !== "neutral" && prev.knn.bias !== "neutral" && snap.knn.bias !== prev.knn.bias) {
    const isBull = snap.knn.bias === "bullish";
    events.push({
      id: uid(), type: "knn_flip", symbol, price,
      direction: isBull ? "bullish" : "bearish", timestamp: now,
      emoji: isBull ? "🤖📈" : "🤖📉",
      message: `KNN bias flipped ${snap.knn.bias.toUpperCase()} (conf: ${snap.knn.confidence}%, ST: ${snap.supertrend.direction})`,
    });
  }

  // ─── SuperTrend flip with KNN confirmation ───
  if (cfg.knnFlip && snap.supertrend.flip && snap.knn.bias !== "neutral") {
    const isBull = snap.supertrend.direction === "bullish";
    const confirmed = snap.supertrend.direction === snap.knn.bias;
    events.push({
      id: uid(), type: "knn_st_flip", symbol, price,
      direction: isBull ? "bullish" : "bearish", timestamp: now,
      emoji: isBull ? "🟢" : "🔴",
      message: `ST flipped ${snap.supertrend.direction.toUpperCase()} — KNN ${confirmed ? "CONFIRMS" : "conflicts"} (${snap.knn.confidence}%)`,
    });
  }

  // ─── Rejection orb ───
  if (cfg.knnRejection && snap.rejection.signal) {
    const isBull = snap.rejection.type === "bullish_rejection";
    events.push({
      id: uid(), type: "knn_rejection", symbol, price,
      direction: isBull ? "bullish" : "bearish", timestamp: now,
      emoji: isBull ? "⚡🟢" : "⚡🔴",
      message: `KNN rejection orb — ${snap.rejection.type?.replace("_", " ").toUpperCase()} at ST level ${snap.supertrend.level.toFixed(4)} (vol×${snap.rejection.volumeScore.toFixed(1)})`,
    });
  }

  // ─── Regime change ───
  if (cfg.knnRegimeChange && prev && snap.regime !== prev.regime) {
    const toRange = snap.regime === "range";
    events.push({
      id: uid(), type: "knn_regime", symbol, price,
      direction: toRange ? "neutral" : snap.knn.bias === "bearish" ? "bearish" : "bullish",
      timestamp: now,
      emoji: toRange ? "⏸️" : snap.regime === "trend" ? "⚡" : "📊",
      message: `Regime: ${prev.regime.toUpperCase()} → ${snap.regime.toUpperCase()} (${snap.note})`,
    });
  }

  return events;
}
