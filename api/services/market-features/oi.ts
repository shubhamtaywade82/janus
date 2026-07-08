import type { InstrumentState } from "../market-state";
import type { BinanceKline } from "../binance";
import type { OIFeature } from "./types";

export function computeOI(state: InstrumentState, klines: BinanceKline[]): OIFeature {
  const defaultFeature: OIFeature = {
    value: 0,
    netChange: 0,
    changePercent24h: 0,
    trend: "NEUTRAL",
  };

  const oiTicks = state.openInterestWindow.values();
  if (oiTicks.length === 0 || klines.length === 0) {
    const lastOI = state.latestOpenInterest?.openInterest ?? 0;
    return {
      ...defaultFeature,
      value: lastOI,
    };
  }

  const latestTick = oiTicks[oiTicks.length - 1];
  const oldestTick = oiTicks[0];

  const value = latestTick.openInterest;
  const netChange = value - oldestTick.openInterest;
  const changePercent24h = oldestTick.openInterest !== 0 
    ? (netChange / oldestTick.openInterest) * 100 
    : 0;

  // Align price change over the OI window period
  const oldestTimestamp = oldestTick.timestamp;
  const currentPrice = parseFloat(klines[klines.length - 1].close);
  
  let oldestPrice = parseFloat(klines[0].close);
  let minDiff = Math.abs(klines[0].closeTime - oldestTimestamp);

  for (const k of klines) {
    const diff = Math.abs(k.closeTime - oldestTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      oldestPrice = parseFloat(k.close);
    }
  }

  const priceChangePct = oldestPrice !== 0 ? (currentPrice - oldestPrice) / oldestPrice : 0;
  const oiChangePct = oldestTick.openInterest !== 0 ? netChange / oldestTick.openInterest : 0;

  // Thresholds to filter noise (0.05% change minimum)
  const threshold = 0.0005;

  let trend: OIFeature["trend"] = "NEUTRAL";
  if (Math.abs(oiChangePct) > threshold && Math.abs(priceChangePct) > threshold) {
    if (priceChangePct > 0 && oiChangePct > 0) {
      trend = "LONG_BUILDUP";
    } else if (priceChangePct < 0 && oiChangePct > 0) {
      trend = "SHORT_BUILDUP";
    } else if (priceChangePct < 0 && oiChangePct < 0) {
      trend = "LONG_UNWIND";
    } else if (priceChangePct > 0 && oiChangePct < 0) {
      trend = "SHORT_UNWIND";
    }
  }

  return {
    value,
    netChange,
    changePercent24h,
    trend,
  };
}
