import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { OrderLevel } from "../../domain/market-data/orderbook.js";
import type { AnalysisResult } from "../../domain/analysis/analysis-result.js";
import { MultiTimeframeManager } from "../../application/analysis/multi-timeframe-manager.js";

/**
 * AnalysisPipeline is the top-level public interface for the analysis subsystem.
 *
 * Usage:
 *   const pipeline = new AnalysisPipeline("BTCUSDT", "coindcx");
 *   pipeline.seedCandles("1h", historicalCandles);
 *   pipeline.onCandle("1m", latestCandle);
 *   pipeline.onTrade(tick);
 *   const result = pipeline.analyze();
 */
export class AnalysisPipeline {
  private readonly manager: MultiTimeframeManager;

  constructor(symbol: string, exchange: string) {
    this.manager = new MultiTimeframeManager(symbol, exchange);
  }

  /**
   * Seed historical candles for a timeframe.
   * Call once per timeframe on startup before streaming live candles.
   */
  seedCandles(tf: CandleInterval, candles: Candle[]): void {
    this.manager.seedCandles(tf, candles);
  }

  /** Feed a live (or partially closed) candle for a given timeframe. */
  onCandle(tf: CandleInterval, candle: Candle): void {
    this.manager.onCandle(tf, candle);
  }

  /** Feed a live trade tick for CVD and trade flow analysis. */
  onTrade(tick: TradeTick): void {
    this.manager.onTrade(tick);
  }

  /** Update the order book snapshot for order book analysis. */
  onDepth(bids: OrderLevel[], asks: OrderLevel[]): void {
    this.manager.onDepth(bids, asks);
  }

  /** Update open interest. Call on each OI polling interval. */
  onOiUpdate(currentOi: number, currentPrice: number): void {
    this.manager.onOiUpdate(currentOi, currentPrice);
  }

  /** Update the latest perpetual funding rate. */
  onFundingRate(rate: number): void {
    this.manager.onFundingRate(rate);
  }

  /**
   * Run the full analysis pipeline and return a complete AnalysisResult.
   * This is a pure in-memory computation — no I/O, no async.
   * Call on demand (e.g., every 30s or on significant market events).
   */
  analyze(): AnalysisResult {
    return this.manager.analyze();
  }
}
