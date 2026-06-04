import type { Candle } from "../../domain/market-data/candle.js";
import type { VolumeAnalysis } from "../../domain/analysis/analysis-result.js";

/**
 * Volume Analysis Engine
 *
 * Detects accumulation, distribution, and climax volume.
 * Uses relative volume to identify abnormal activity.
 *
 * Accumulation: price down + volume up + closes near highs → smart money buying
 * Distribution: price up + volume up + closes near lows → smart money selling
 * Climax: extreme volume spike → potential exhaustion
 */
export function analyzeVolume(candles: Candle[]): VolumeAnalysis {
  if (candles.length < 20) {
    return {
      relativeVolume: 1,
      accumulationDetected: false,
      distributionDetected: false,
      climaxVolumeDetected: false,
      volumeScore: { bullish: 5, bearish: 5 },
    };
  }

  const recent = candles.slice(-20);
  const last = candles[candles.length - 1];
  const avgVolume = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / (recent.length - 1);
  const relativeVolume = avgVolume > 0 ? last.volume / avgVolume : 1;

  // Climax: volume > 3x average with very large candle body
  const candleBody = Math.abs(last.close - last.open);
  const candleRange = last.high - last.low;
  const bodyRatio = candleRange > 0 ? candleBody / candleRange : 0;
  const climaxVolumeDetected = relativeVolume > 3 && bodyRatio > 0.6;

  // Accumulation: downward price + expanding volume + closes near high of candle
  const last5 = candles.slice(-5);
  const priceDeclined = last5[last5.length - 1].close < last5[0].close;
  const volumeExpanding = last5.map((c, i) => i > 0 ? c.volume > last5[i - 1].volume : true).every(Boolean);
  const closesNearHighs = last5.filter((c) => {
    const range = c.high - c.low;
    return range > 0 && (c.close - c.low) / range > 0.6;
  }).length >= 3;

  const accumulationDetected = priceDeclined && volumeExpanding && closesNearHighs;

  // Distribution: upward price + expanding volume + closes near low of candle
  const priceRising = last5[last5.length - 1].close > last5[0].close;
  const closesNearLows = last5.filter((c) => {
    const range = c.high - c.low;
    return range > 0 && (c.high - c.close) / range > 0.6;
  }).length >= 3;

  const distributionDetected = priceRising && volumeExpanding && closesNearLows;

  // Score
  let bullishScore = 5;
  let bearishScore = 5;

  if (accumulationDetected) { bullishScore += 2; bearishScore -= 1; }
  if (distributionDetected) { bearishScore += 2; bullishScore -= 1; }
  if (climaxVolumeDetected) {
    // Climax on down-move → bullish exhaustion
    const isDownMove = last.close < last.open;
    if (isDownMove) { bullishScore += 1; } else { bearishScore += 1; }
  }
  if (relativeVolume > 2 && last.close > last.open) bullishScore++;
  if (relativeVolume > 2 && last.close < last.open) bearishScore++;

  return {
    relativeVolume: parseFloat(relativeVolume.toFixed(2)),
    accumulationDetected,
    distributionDetected,
    climaxVolumeDetected,
    volumeScore: {
      bullish: Math.max(0, Math.min(10, bullishScore)),
      bearish: Math.max(0, Math.min(10, bearishScore)),
    },
  };
}
