/**
 * Funding Rate Filter
 * Blocks new positions when funding is extreme — avoids paying excessive
 * funding against your direction.
 *
 * Funding > +0.10%: longs pay shorts → avoid new longs
 * Funding < -0.10%: shorts pay longs → avoid new shorts
 */

// fundingRateCache populated by coindcx-ws.ts when parsing markPrice events
// Key: CoinDCX pair format (B-ETH_USDT), value: fractional rate (0.001 = 0.1%)
export const fundingRateCache = new Map<string, number>();

const LONG_BLOCK_THRESHOLD  =  0.001;  // +0.10%
const SHORT_BLOCK_THRESHOLD = -0.001;  // -0.10%

export interface FundingCheck {
  blocked: boolean;
  fundingRate: number;
  reason: string;
}

export function isFundingExtreme(
  symbol: string,
  side: "long" | "short"
): FundingCheck {
  // Convert Binance symbol → CoinDCX pair for cache lookup
  const coindcxKey = symbol.startsWith("B-")
    ? symbol
    : `B-${symbol.replace("USDT", "_USDT")}`;

  const rate = fundingRateCache.get(coindcxKey) ?? 0;

  if (side === "long" && rate > LONG_BLOCK_THRESHOLD) {
    return {
      blocked: true,
      fundingRate: rate,
      reason: `Funding ${(rate * 100).toFixed(3)}% positive — longs paying, skip`,
    };
  }

  if (side === "short" && rate < SHORT_BLOCK_THRESHOLD) {
    return {
      blocked: true,
      fundingRate: rate,
      reason: `Funding ${(rate * 100).toFixed(3)}% negative — shorts paying, skip`,
    };
  }

  return { blocked: false, fundingRate: rate, reason: "" };
}
