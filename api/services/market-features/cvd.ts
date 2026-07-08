import { InstrumentState } from "../market-state";
import { CVDFeature } from "./types";

export function computeCVD(state: InstrumentState): CVDFeature {
  const defaultFeature: CVDFeature = {
    value: 0,
    slope: 0,
    trend: "NEUTRAL",
    divergence: "NONE",
  };

  const ticks = state.cvdWindow.values();
  if (ticks.length < 5) {
    return {
      ...defaultFeature,
      value: state.cumulativeCvd,
    };
  }

  const length = ticks.length;
  const cvdValues = ticks.map(t => t.cumulative);
  const priceValues = ticks.map(t => t.price);

  // Linear Regression for CVD Slope
  const cvdSlope = calculateRegressionSlope(cvdValues);
  const priceSlope = calculateRegressionSlope(priceValues);

  // Normalize CVD Slope by current CVD value or price to make thresholds scale-invariant
  // For simplicity, we check sign and magnitude
  let trend: CVDFeature["trend"] = "NEUTRAL";
  if (cvdSlope > 0.005) {
    trend = "BULLISH";
  } else if (cvdSlope < -0.005) {
    trend = "BEARISH";
  }

  // Divergence Detection
  let divergence: CVDFeature["divergence"] = "NONE";
  
  if (priceSlope < -0.01 && cvdSlope > 0.01) {
    divergence = "BULLISH_DIV_CLASSIC";
  } else if (priceSlope > 0.01 && cvdSlope < -0.01) {
    divergence = "BEARISH_DIV_CLASSIC";
  } else if (priceSlope > 0.01 && cvdSlope < -0.05) {
    divergence = "BULLISH_DIV_HIDDEN";
  } else if (priceSlope < -0.01 && cvdSlope > 0.05) {
    divergence = "BEARISH_DIV_HIDDEN";
  }

  return {
    value: state.cumulativeCvd,
    slope: cvdSlope,
    trend,
    divergence,
  };
}

function calculateRegressionSlope(y: number[]): number {
  const N = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < N; i++) {
    const x = i;
    sumX += x;
    sumY += y[i];
    sumXY += x * y[i];
    sumXX += x * x;
  }

  const denominator = N * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  
  // Return the slope
  return (N * sumXY - sumX * sumY) / denominator;
}
