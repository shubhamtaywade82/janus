import { marketStateManager } from "../market-state";
import { getDailyTrend } from "../trend-bias";
import { fetchKlines } from "../binance";
import { computeATR } from "./atr";
import { computeADX } from "./adx";
import { computeEMA } from "./ema";
import { computeRSI } from "./rsi";
import { computeMACD } from "./macd";
import { computeVolume } from "./volume";
import { computeOrderBook } from "./orderbook";
import { computeCVD } from "./cvd";
import { computeOI } from "./oi";
import { computeFunding } from "./funding";
import { computeLiquidation } from "./liquidation";
import { computeVolatility } from "./volatility";
import { computeLiquidity } from "./liquidity";
import { computeSession } from "./session";
import { computeCorrelation } from "./correlation";
import { MarketFeatures } from "./types";

/**
 * Computes all technical, order book, and derivative market features for a symbol.
 * Pulls from real-time WebSocket state via marketStateManager and fetches historical klines from Binance REST API.
 */
export async function computeMarketFeatures(symbol: string): Promise<MarketFeatures> {
  const symbolUpper = symbol.toUpperCase();

  // 1. Get the real-time WebSocket state from MarketStateManager (always returns a state object)
  const state = marketStateManager.getOrInitializeState(symbolUpper);

  // 2. Fetch required klines in parallel (catch errors and return empty arrays for robust fallbacks)
  const [klines1h, klines1m, btcKlines1h, dailyTrend] = await Promise.all([
    fetchKlines(symbolUpper, "1h", 600).catch(() => []),
    fetchKlines(symbolUpper, "1m", 200).catch(() => []),
    symbolUpper !== "BTCUSDT"
      ? fetchKlines("BTCUSDT", "1h", 600).catch(() => [])
      : Promise.resolve([]),
    getDailyTrend(symbolUpper).catch(() => null),
  ]);

  // 3. Compute each feature using specialized modules
  const atr = computeATR(klines1h);
  const adx = computeADX(klines1h);
  const ema = computeEMA(klines1h);
  const rsi = computeRSI(klines1h);
  const macd = computeMACD(klines1h);
  
  // Use tradeWindow values if available for fine-grained buy volume ratio
  const tradeTicks = state.tradeWindow ? state.tradeWindow.values() : [];
  const volume = computeVolume(klines1h, tradeTicks);
  
  const orderBook = computeOrderBook(state);
  const cvd = computeCVD(state);
  const oi = computeOI(state, klines1h);
  const funding = computeFunding(state);
  const liquidation = computeLiquidation(state);
  const volatility = computeVolatility(klines1h);
  const liquidity = computeLiquidity(state);
  const session = computeSession(new Date());
  
  // For correlation, pass BTCUSDT klines if this is not BTC, otherwise reuse klines1h
  const btcRefKlines = symbolUpper === "BTCUSDT" ? klines1h : btcKlines1h;
  const correlation = computeCorrelation(symbolUpper, klines1h, btcRefKlines);

  return {
    symbol: symbolUpper,
    timestamp: Date.now(),
    atr,
    adx,
    ema,
    rsi,
    macd,
    volume,
    orderBook,
    cvd,
    oi,
    funding,
    liquidation,
    volatility,
    liquidity,
    session,
    correlation,
    dailyTrendBias: dailyTrend,
  };
}
