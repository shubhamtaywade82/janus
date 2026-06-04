import type { Position } from "../positions/position.js";

export interface ExposureReport {
  totalNotional: number;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  openPositionCount: number;
}

export function computeExposure(positions: Position[]): ExposureReport {
  let longNotional = 0;
  let shortNotional = 0;

  for (const p of positions) {
    const notional = p.netQuantity * p.markPrice;
    if (p.side === "long") longNotional += notional;
    else shortNotional += notional;
  }

  return {
    totalNotional: longNotional + shortNotional,
    longNotional,
    shortNotional,
    netNotional: longNotional - shortNotional,
    openPositionCount: positions.length,
  };
}
