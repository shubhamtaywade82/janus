import type { BinanceKline } from "../binance";
import type { CorrelationFeature } from "./types";

export function computeCorrelation(
  symbol: string,
  symbolKlines: BinanceKline[],
  btcKlines: BinanceKline[],
  otherSymbolKlines: Record<string, BinanceKline[]> = {}
): CorrelationFeature {
  const isBtc = symbol.toUpperCase().startsWith("BTC");

  let btcCorrelation = 1.0;
  if (!isBtc && btcKlines && btcKlines.length > 0 && symbolKlines && symbolKlines.length > 0) {
    btcCorrelation = calculateAlignCorrelation(symbolKlines, btcKlines);
  }

  const otherCorrelations: Record<string, number> = {};
  for (const [otherSymbol, otherKlines] of Object.entries(otherSymbolKlines)) {
    if (otherSymbol.toUpperCase() === symbol.toUpperCase()) {
      otherCorrelations[otherSymbol] = 1.0;
    } else if (otherKlines && otherKlines.length > 0 && symbolKlines && symbolKlines.length > 0) {
      otherCorrelations[otherSymbol] = calculateAlignCorrelation(symbolKlines, otherKlines);
    } else {
      otherCorrelations[otherSymbol] = 0;
    }
  }

  return {
    btcCorrelation,
    otherCorrelations,
  };
}

function calculateAlignCorrelation(klinesA: BinanceKline[], klinesB: BinanceKline[]): number {
  const mapA = getReturnsMap(klinesA);
  const mapB = getReturnsMap(klinesB);

  const commonTimes: number[] = [];
  for (const time of mapA.keys()) {
    if (mapB.has(time)) {
      commonTimes.push(time);
    }
  }

  if (commonTimes.length <= 2) {
    return 0;
  }

  const returnsA = commonTimes.map(t => mapA.get(t)!);
  const returnsB = commonTimes.map(t => mapB.get(t)!);

  return calculatePearsonCorrelation(returnsA, returnsB);
}

function getReturnsMap(klines: BinanceKline[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 1; i < klines.length; i++) {
    const prev = parseFloat(klines[i - 1].close);
    const curr = parseFloat(klines[i].close);
    if (prev > 0) {
      map.set(klines[i].openTime, Math.log(curr / prev));
    }
  }
  return map;
}

function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    num += diffX * diffY;
    denX += diffX * diffX;
    denY += diffY * diffY;
  }

  const denominator = Math.sqrt(denX * denY);
  return denominator === 0 ? 0 : num / denominator;
}
