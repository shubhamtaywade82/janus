import { BinanceKline } from "../binance";
import { MACDFeature } from "./types";

export function computeMACD(
  klines: BinanceKline[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDFeature {
  const defaultFeature: MACDFeature = {
    macdLine: 0,
    signalLine: 0,
    histogram: 0,
    crossover: "NONE",
    momentumDirection: "FLAT",
  };

  if (klines.length < slowPeriod + signalPeriod) {
    return defaultFeature;
  }

  const closes = klines.map(k => parseFloat(k.close));
  const length = closes.length;

  // Calculate EMAs
  const emaFast = calculateEMASeries(closes, fastPeriod);
  const emaSlow = calculateEMASeries(closes, slowPeriod);

  // MACD Line = EMA_fast - EMA_slow
  const macdLineSeries: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    macdLineSeries[i] = emaFast[i] - emaSlow[i];
  }

  // Signal Line = EMA_signal of MACD Line
  const signalLineSeries = calculateEMASeries(macdLineSeries, signalPeriod);

  // Histogram = MACD Line - Signal Line
  const histogramSeries: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    histogramSeries[i] = macdLineSeries[i] - signalLineSeries[i];
  }

  const curMacd = macdLineSeries[length - 1];
  const curSignal = signalLineSeries[length - 1];
  const curHist = histogramSeries[length - 1];

  const prevMacd = macdLineSeries[length - 2];
  const prevSignal = signalLineSeries[length - 2];
  const prevHist = histogramSeries[length - 2];

  // Crossover check
  let crossover: MACDFeature["crossover"] = "NONE";
  if ((prevMacd <= prevSignal && curMacd > curSignal) || (prevHist <= 0 && curHist > 0)) {
    crossover = "BULLISH";
  } else if ((prevMacd >= prevSignal && curMacd < curSignal) || (prevHist >= 0 && curHist < 0)) {
    crossover = "BEARISH";
  }

  // Momentum Direction
  let momentumDirection: MACDFeature["momentumDirection"] = "FLAT";
  if (curHist > prevHist) {
    momentumDirection = "UP";
  } else if (curHist < prevHist) {
    momentumDirection = "DOWN";
  }

  return {
    macdLine: curMacd,
    signalLine: curSignal,
    histogram: curHist,
    crossover,
    momentumDirection,
  };
}

function calculateEMASeries(values: number[], period: number): number[] {
  const ema: number[] = new Array(values.length).fill(0);
  if (values.length === 0) return ema;

  ema[0] = values[0];
  const k = 2 / (period + 1);

  for (let i = 1; i < values.length; i++) {
    ema[i] = values[i] * k + values[i - 1] * (1 - k);
  }
  return ema;
}
