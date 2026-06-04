import type { Candle } from "../../domain/market-data/candle.js";
import type { VolumeBin, VolumeProfile, VolumeProfileAnalysis, CurrentPosition } from "../../domain/analysis/volume-profile.js";

const VALUE_AREA_PCT = 0.70; // 70% of volume defines the value area
const DEFAULT_BINS = 100;

/**
 * Volume Profile Engine
 *
 * Distributes total volume across price bins to find:
 *   POC — Point of Control (highest volume node)
 *   VAH — Value Area High (upper bound of 70% volume zone)
 *   VAL — Value Area Low (lower bound of 70% volume zone)
 *   HVN — High Volume Nodes (strong S/R)
 *   LVN — Low Volume Nodes (fast travel zones)
 *
 * Uses TPO (Time Price Opportunity) proxy: assumes uniform volume
 * distribution across the H-L range per candle.
 */
export function buildVolumeProfile(
  symbol: string,
  candles: Candle[],
  numBins = DEFAULT_BINS
): VolumeProfile {
  if (candles.length === 0) {
    return {
      symbol, poc: 0, vah: 0, val: 0, hvn: [], lvn: [], bins: [], totalVolume: 0,
    };
  }

  const priceMin = Math.min(...candles.map((c) => c.low));
  const priceMax = Math.max(...candles.map((c) => c.high));
  const binSize = (priceMax - priceMin) / numBins;

  // Initialize bins
  const bins: VolumeBin[] = Array.from({ length: numBins }, (_, i) => ({
    priceLow: priceMin + i * binSize,
    priceHigh: priceMin + (i + 1) * binSize,
    midPrice: priceMin + (i + 0.5) * binSize,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
  }));

  let totalVolume = 0;

  // Distribute each candle's volume across the bins it spans
  for (const c of candles) {
    const isBullish = c.close >= c.open;
    const candleRange = c.high - c.low;
    if (candleRange <= 0) continue;

    // Proportionally allocate volume to bins within this candle's range
    for (const bin of bins) {
      const overlapLow = Math.max(bin.priceLow, c.low);
      const overlapHigh = Math.min(bin.priceHigh, c.high);
      if (overlapHigh <= overlapLow) continue;

      const fraction = (overlapHigh - overlapLow) / candleRange;
      const vol = c.volume * fraction;
      const buyVol = isBullish ? vol * 0.6 : vol * 0.4;
      const sellVol = vol - buyVol;

      bin.volume += vol;
      bin.buyVolume += buyVol;
      bin.sellVolume += sellVol;
      bin.delta += buyVol - sellVol;
      totalVolume += vol;
    }
  }

  // Find POC (highest volume bin)
  const poc = bins.reduce((max, b) => (b.volume > max.volume ? b : max), bins[0]);

  // Build value area (70% of total volume, starting from POC)
  const valueArea = buildValueArea(bins, poc, totalVolume);

  // HVN: bins with volume > mean * 1.5
  const meanVolume = totalVolume / numBins;
  const hvn = bins
    .filter((b) => b.volume > meanVolume * 1.5)
    .map((b) => b.midPrice)
    .sort((a, b) => a - b);

  // LVN: bins with volume < mean * 0.5
  const lvn = bins
    .filter((b) => b.volume > 0 && b.volume < meanVolume * 0.5)
    .map((b) => b.midPrice)
    .sort((a, b) => a - b);

  return {
    symbol,
    poc: poc.midPrice,
    vah: valueArea.vah,
    val: valueArea.val,
    hvn: hvn.slice(0, 10),
    lvn: lvn.slice(0, 10),
    bins,
    totalVolume,
  };
}

function buildValueArea(
  bins: VolumeBin[],
  poc: VolumeBin,
  totalVolume: number
): { vah: number; val: number } {
  const targetVolume = totalVolume * VALUE_AREA_PCT;
  let accumulated = poc.volume;
  let upperIdx = bins.indexOf(poc);
  let lowerIdx = bins.indexOf(poc);

  while (accumulated < targetVolume) {
    const aboveVol = bins[upperIdx + 1]?.volume ?? 0;
    const belowVol = bins[lowerIdx - 1]?.volume ?? 0;

    if (aboveVol >= belowVol && upperIdx < bins.length - 1) {
      upperIdx++;
      accumulated += bins[upperIdx].volume;
    } else if (lowerIdx > 0) {
      lowerIdx--;
      accumulated += bins[lowerIdx].volume;
    } else if (upperIdx < bins.length - 1) {
      upperIdx++;
      accumulated += bins[upperIdx].volume;
    } else {
      break;
    }
  }

  return {
    vah: bins[upperIdx].priceHigh,
    val: bins[lowerIdx].priceLow,
  };
}

export function buildVolumeProfileAnalysis(
  symbol: string,
  candles: Candle[],
  currentPrice: number
): VolumeProfileAnalysis {
  const profile = buildVolumeProfile(symbol, candles);

  let currentPosition: CurrentPosition;
  const distanceToPocPct = profile.poc > 0
    ? Math.abs(currentPrice - profile.poc) / profile.poc * 100
    : 0;

  if (currentPrice > profile.vah) currentPosition = "ABOVE_VAH";
  else if (currentPrice < profile.val) currentPosition = "BELOW_VAL";
  else if (Math.abs(currentPrice - profile.poc) / profile.poc < 0.003) currentPosition = "AT_POC";
  else if (currentPrice > profile.poc) currentPosition = "ABOVE_POC";
  else currentPosition = "BELOW_POC";

  const implication =
    currentPosition === "ABOVE_VAH" ? "BULLISH"
    : currentPosition === "BELOW_VAL" ? "BEARISH"
    : currentPosition === "BELOW_POC" ? "BEARISH"
    : currentPosition === "ABOVE_POC" ? "BULLISH"
    : "NEUTRAL";

  return {
    profile,
    currentPosition,
    implication,
    distanceToPocPct: parseFloat(distanceToPocPct.toFixed(2)),
  };
}
