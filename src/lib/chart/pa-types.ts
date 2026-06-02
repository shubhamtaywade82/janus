/**
 * Frontend-safe copies of price-action interfaces.
 * Mirrors api/services/price-action.ts — keep in sync.
 */
export interface SwingPoint {
  time: number; price: number; type: "high" | "low"; strength: number; index: number;
}
export interface OrderBlock {
  time: number; top: number; bottom: number;
  type: "bullish" | "bearish"; mitigated: boolean; mitigatedAt?: number; strength: number;
}
export interface FairValueGap {
  startTime: number; endTime: number; top: number; bottom: number; midpoint: number;
  type: "bullish" | "bearish"; filled: boolean; fillPercent: number;
}
export interface StructureBreak {
  time: number; price: number; type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish"; brokenSwingTime: number; brokenSwingPrice: number;
}
export interface LiquidityLevel {
  price: number; type: "buy-side" | "sell-side"; touchCount: number;
  times: number[]; swept: boolean; sweptTime?: number;
}
export interface DisplacementCandle {
  time: number; direction: "bullish" | "bearish"; bodySize: number; atrMultiple: number;
}
export interface PremiumDiscountZone {
  swingHigh: number; swingLow: number; equilibrium: number; premiumBottom: number; discountTop: number;
}
export interface PriceActionData {
  swings: SwingPoint[]; orderBlocks: OrderBlock[]; fvgs: FairValueGap[];
  structure: StructureBreak[]; liquidity: LiquidityLevel[];
  displacement: DisplacementCandle[]; premiumDiscount: PremiumDiscountZone | null;
}
