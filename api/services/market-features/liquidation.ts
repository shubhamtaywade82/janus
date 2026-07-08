import type { InstrumentState } from "../market-state";
import type { LiquidationFeature } from "./types";

export function computeLiquidation(state: InstrumentState): LiquidationFeature {
  const defaultFeature: LiquidationFeature = {
    buyLiquidations: 0,
    sellLiquidations: 0,
    intensity: 0,
    state: "NORMAL",
  };

  const ticks = state.liquidationWindow.values();
  if (ticks.length === 0) {
    return defaultFeature;
  }

  let buyLiqUsd = 0; // Short liquidations (represented as BUY trades)
  let sellLiqUsd = 0; // Long liquidations (represented as SELL trades)

  for (const tick of ticks) {
    const usdValue = tick.quantity * tick.price;
    if (tick.side === "BUY") {
      buyLiqUsd += usdValue;
    } else {
      sellLiqUsd += usdValue;
    }
  }

  const intensity = buyLiqUsd + sellLiqUsd;

  // Define thresholds for cascades ($50,000 cumulative in the window)
  const CASCADE_THRESHOLD = 50000;

  let stateVal: LiquidationFeature["state"] = "NORMAL";
  if (sellLiqUsd > CASCADE_THRESHOLD) {
    stateVal = "CASCADE_LONG";
  } else if (buyLiqUsd > CASCADE_THRESHOLD) {
    stateVal = "CASCADE_SHORT";
  }

  return {
    buyLiquidations: buyLiqUsd,
    sellLiquidations: sellLiqUsd,
    intensity,
    state: stateVal,
  };
}
