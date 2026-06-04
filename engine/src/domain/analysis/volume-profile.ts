export interface VolumeBin {
  priceLow: number;
  priceHigh: number;
  midPrice: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

export interface VolumeProfile {
  symbol: string;
  /** Point of Control — price level with highest volume */
  poc: number;
  /** Value Area High — upper bound of 70% of volume */
  vah: number;
  /** Value Area Low — lower bound of 70% of volume */
  val: number;
  /** High-Volume Nodes — significant support/resistance */
  hvn: number[];
  /** Low-Volume Nodes — fast price travel zones */
  lvn: number[];
  bins: VolumeBin[];
  totalVolume: number;
}

export type CurrentPosition = "ABOVE_POC" | "AT_POC" | "BELOW_POC" | "ABOVE_VAH" | "BELOW_VAL";

export interface VolumeProfileAnalysis {
  profile: VolumeProfile;
  currentPosition: CurrentPosition;
  implication: "BULLISH" | "BEARISH" | "NEUTRAL";
  distanceToPocPct: number;
}
