import type { BinanceKline } from "../binance";
import type { TradeTick } from "../market-state";
import type { VolumeFeature } from "./types";

export function computeVolume(klines: BinanceKline[], tradeTicks?: TradeTick[]): VolumeFeature {
  const defaultFeature: VolumeFeature = {
    currentVolume: 0,
    averageVolume: 0,
    volumeSurgeRatio: 1.0,
    volumeRatio: 1.0,
    buyRatio: 0.5,
    isSurge: false,
  };

  if (klines.length === 0) {
    return defaultFeature;
  }

  const length = klines.length;
  const currentVolume = parseFloat(klines[length - 1].volume);

  // Compute average volume over 20 periods
  const period = Math.min(20, length);
  let volSum = 0;
  for (let i = length - period; i < length; i++) {
    volSum += parseFloat(klines[i].volume);
  }
  const averageVolume = volSum / period;

  const volumeRatio = averageVolume !== 0 ? currentVolume / averageVolume : 1.0;
  const volumeSurgeRatio = volumeRatio; // Can be treated as the same or custom scaled
  const isSurge = volumeRatio > 2.0;

  // Calculate buyRatio
  let buyRatio = 0.5;
  if (tradeTicks && tradeTicks.length > 0) {
    let buyQty = 0;
    let totalQty = 0;
    for (const tick of tradeTicks) {
      if (tick.side === "BUY") {
        buyQty += tick.quantity;
      }
      totalQty += tick.quantity;
    }
    if (totalQty > 0) {
      buyRatio = buyQty / totalQty;
    }
  } else {
    // Fallback: price action based partition
    const lastKline = klines[length - 1];
    const high = parseFloat(lastKline.high);
    const low = parseFloat(lastKline.low);
    const close = parseFloat(lastKline.close);

    const range = high - low;
    if (range > 0) {
      // Partition: ratio of distance from low to close over total range
      buyRatio = (close - low) / range;
    } else {
      buyRatio = 0.5;
    }
  }

  return {
    currentVolume,
    averageVolume,
    volumeSurgeRatio,
    volumeRatio,
    buyRatio,
    isSurge,
  };
}
