import type { MarketFeatures } from "./types";

/**
 * Symbols this filter is tuned for. SOL/ETH/XRP share high BTC-beta but
 * diverge sharply on late-stage funding blow-offs (esp. SOL/XRP) — this
 * filter targets "trend about to run 10%+" setups on exactly these three.
 */
export const CONTINUATION_FILTER_SYMBOLS = ["SOLUSDT", "ETHUSDT", "XRPUSDT"];

export interface ContinuationVerdict {
  passes: boolean;
  reason: string;
}

/**
 * Additional gate on top of the composite confluence score. Separates
 * "trend likely to continue 10%+" from noise/chop using the market-features
 * engine's ADX/EMA/ATR/CVD/volume/funding/session/liquidity/volatility output.
 * All thresholds reasoned from the existing 0-100 scoring scale and regime
 * configs — see docs/janus-spec proposal discussion for rationale.
 */
export function evaluateContinuationSetup(
  features: MarketFeatures,
  direction: "long" | "short"
): ContinuationVerdict {
  const { adx, ema, atr, cvd, volume, funding, session, liquidity, volatility } = features;

  if (adx.trendState !== "STRONG_TREND") {
    return { passes: false, reason: `ADX trendState ${adx.trendState} (need STRONG_TREND)` };
  }
  if (adx.adxSlope <= 0) {
    return { passes: false, reason: `ADX slope ${adx.adxSlope.toFixed(2)} not rising` };
  }
  const wantAlignment = direction === "long" ? "BULLISH" : "BEARISH";
  if (ema.alignment !== wantAlignment) {
    return { passes: false, reason: `EMA alignment ${ema.alignment}, need ${wantAlignment}` };
  }
  if (atr.state !== "EXPANDING") {
    return { passes: false, reason: `ATR state ${atr.state} (need EXPANDING — contracting ATR means move is exhausted)` };
  }
  if (cvd.trend !== wantAlignment) {
    return { passes: false, reason: `CVD trend ${cvd.trend}, need ${wantAlignment}` };
  }
  if (cvd.divergence !== "NONE") {
    return { passes: false, reason: `CVD divergence ${cvd.divergence} present — fakeout/wick risk` };
  }
  if (!volume.isSurge) {
    return { passes: false, reason: "no volume surge — low conviction" };
  }
  const badFundingState = direction === "long" ? "CROWDED_LONG" : "CROWDED_SHORT";
  if (funding.state === badFundingState) {
    return { passes: false, reason: `funding ${funding.state} against direction — late-stage/blow-off risk` };
  }
  if (session.activeSession === "DORMANT") {
    return { passes: false, reason: "dormant session (21:00-00:00 UTC) — low liquidity window" };
  }
  if (liquidity.state === "VACUUM" && !volume.isSurge) {
    return { passes: false, reason: "liquidity VACUUM without volume confirmation — sweep-driven, no real absorption" };
  }
  if ((volatility.state === "HIGH" || volatility.state === "EXTREME") && !volume.isSurge) {
    return { passes: false, reason: `volatility ${volatility.state} without volume confirmation — chaos, not trend` };
  }

  return { passes: true, reason: "continuation setup confirmed" };
}
