import type { Candle, CandleInterval } from "../../domain/market-data/candle.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { OrderLevel } from "../../domain/market-data/orderbook.js";
import type { AnalysisResult, AnalysisSummary, MarketPhase, RecommendedAction } from "../../domain/analysis/analysis-result.js";

import { buildMarketStructure, analyzeTimeframe } from "./market-structure-engine.js";
import { buildOrderBlockAnalysis, detectOrderBlocks, updateOrderBlockStatus } from "./order-block-engine.js";
import { buildFvgAnalysis, detectFVGs, updateFVGStatus } from "./fvg-engine.js";
import { buildLiquidityAnalysis } from "./liquidity-engine.js";
import { CvdEngine } from "./cvd-engine.js";
import { buildVolumeProfileAnalysis } from "./volume-profile-engine.js";
import { analyzeOpenInterest, analyzeFunding } from "./oi-funding-engine.js";
import { analyzeVolume } from "./volume-analysis-engine.js";
import { analyzeOrderBook } from "./orderbook-analysis-engine.js";
import { scoreSignals } from "./signal-scoring-engine.js";
import { generateTradeSetup } from "./trade-setup-generator.js";
import { MultiTimeframeCandleStore } from "../../infrastructure/analysis/candle-store.js";

import type { OrderBlock } from "../../domain/analysis/order-block.js";
import type { FairValueGap } from "../../domain/analysis/fvg.js";

const ANALYSIS_TIMEFRAMES: CandleInterval[] = ["1d", "4h", "1h", "15m", "5m", "1m"];
const MAX_TRADES = 100_000;

interface OiSnapshot {
  oi: number;
  price: number;
  ts: number;
}

/**
 * MultiTimeframeManager owns all rolling state for one instrument.
 * Call:
 *   onCandle(tf, candle)   — from Binance/Delta kline events
 *   onTrade(tick)          — from aggTrade events
 *   onBids/onAsks          — from depth20 snapshots
 *   onOiUpdate(oi, price)  — from OI polling
 *   onFundingRate(rate)    — from funding events
 *   analyze()              — returns full AnalysisResult
 */
export class MultiTimeframeManager {
  private readonly candleStores = new MultiTimeframeCandleStore();
  private readonly cvd = new CvdEngine();
  private readonly trades: TradeTick[] = [];

  private bids: OrderLevel[] = [];
  private asks: OrderLevel[] = [];

  private oiCurrent = 0;
  private oiPrevious = 0;
  private pricePrevious = 0;
  private fundingRate = 0;

  // Accumulated OBs and FVGs across timeframes (persisted between analyze() calls)
  private orderBlocks: OrderBlock[] = [];
  private fvgs: FairValueGap[] = [];

  constructor(
    private readonly symbol: string,
    private readonly exchange: string,
  ) {}

  onCandle(tf: CandleInterval, candle: Candle): void {
    this.candleStores.upsert(tf, candle);
  }

  seedCandles(tf: CandleInterval, candles: Candle[]): void {
    this.candleStores.seed(tf, candles);
    this.cvd.seedFromCandles(this.candleStores.candles("1m"));
    // Re-derive OBs and FVGs from seeded data
    this.refreshStructures();
  }

  onTrade(tick: TradeTick): void {
    this.cvd.onTrade(tick);
    this.trades.push(tick);
    if (this.trades.length > MAX_TRADES) this.trades.shift();
  }

  onDepth(bids: OrderLevel[], asks: OrderLevel[]): void {
    this.bids = bids;
    this.asks = asks;
  }

  onOiUpdate(currentOi: number, currentPrice: number): void {
    this.oiPrevious = this.oiCurrent;
    this.pricePrevious = currentPrice;
    this.oiCurrent = currentOi;
  }

  onFundingRate(rate: number): void {
    this.fundingRate = rate;
  }

  analyze(): AnalysisResult {
    const ts = Date.now();
    const primary1m = this.candleStores.candles("1m");
    const currentPrice = primary1m[primary1m.length - 1]?.close ?? 0;

    // Market structure across all timeframes
    const tfRecord: Record<string, ReturnType<typeof analyzeTimeframe>> = {};
    for (const tf of ANALYSIS_TIMEFRAMES) {
      const candles = this.candleStores.candles(tf);
      if (candles.length >= 5) tfRecord[tf] = analyzeTimeframe(candles, tf);
    }

    const marketStructure = buildMarketStructure(tfRecord);

    // Refresh OBs and FVGs with current price (returns new arrays)
    this.orderBlocks = updateOrderBlockStatus(this.orderBlocks, currentPrice) as typeof this.orderBlocks;
    this.fvgs = updateFVGStatus(this.fvgs, currentPrice) as typeof this.fvgs;

    const orderBlocks = buildOrderBlockAnalysis(
      this.orderBlocks.filter((ob) => ob.status !== "BROKEN"),
      currentPrice,
    );
    const fvgs = buildFvgAnalysis(
      this.fvgs.filter((f) => !f.filled),
      currentPrice,
    );

    // Liquidity
    const liquidity = buildLiquidityAnalysis(primary1m, currentPrice);

    // CVD
    const cvd = this.cvd.analyze();

    // Volume profile from 1H candles (deeper view)
    const candles1h = this.candleStores.candles("1h");
    const volumeProfile = buildVolumeProfileAnalysis(
      this.symbol,
      candles1h.length >= 10 ? candles1h : primary1m,
      currentPrice,
    );

    // OI + Funding
    const openInterest = analyzeOpenInterest({
      currentOi: this.oiCurrent,
      previousOi: this.oiPrevious,
      currentPrice,
      previousPrice: this.pricePrevious || currentPrice,
    });
    const funding = analyzeFunding(this.fundingRate);

    // Volume analysis
    const candles15m = this.candleStores.candles("15m");
    const volume = analyzeVolume(candles15m.length >= 20 ? candles15m : primary1m);

    // Order book
    const orderBook = analyzeOrderBook(this.bids, this.asks);

    // Signal scoring
    const signals = scoreSignals({
      structure: marketStructure,
      liquidity,
      orderBlocks,
      fvgs,
      volume,
      cvd,
      orderBook,
      openInterest,
      funding,
    });

    // Trade setup
    const setup = generateTradeSetup({
      currentPrice,
      structure: marketStructure,
      signals,
      liquidity,
      orderBlocks,
      fvgs,
      volumeProfile,
    });

    // Summary
    const summary = buildSummary(signals, marketStructure, setup.confidence, currentPrice, volumeProfile);

    return {
      symbol: this.symbol,
      exchange: this.exchange,
      timestamp: ts,
      currentPrice,
      marketStructure,
      liquidity,
      orderBlocks,
      fvgs,
      volume,
      openInterest,
      funding,
      cvd,
      orderBook,
      volumeProfile,
      signals,
      setup,
      summary,
    };
  }

  private refreshStructures(): void {
    this.orderBlocks = [];
    this.fvgs = [];

    for (const tf of ANALYSIS_TIMEFRAMES) {
      const candles = this.candleStores.candles(tf);
      if (candles.length < 5) continue;
      const newObs = detectOrderBlocks(candles, tf);
      const newFvgs = detectFVGs(candles, tf);
      this.orderBlocks.push(...newObs);
      this.fvgs.push(...newFvgs);
    }
  }
}

function buildSummary(
  signals: AnalysisResult["signals"],
  structure: AnalysisResult["marketStructure"],
  setupConfidence: number,
  currentPrice: number,
  vp: AnalysisResult["volumeProfile"],
): AnalysisSummary {
  const bias = signals.overallBias;

  const phase: MarketPhase =
    signals.accumulation.detected ? "ACCUMULATION" :
    signals.distribution.detected ? "DISTRIBUTION" :
    structure.overallBias === "BULLISH" && structure.biasConfidence > 60 ? "MARKUP" :
    structure.overallBias === "BEARISH" && structure.biasConfidence > 60 ? "MARKDOWN" :
    "CONSOLIDATION";

  const action: RecommendedAction =
    setupConfidence >= 70 && (bias === "STRONG_BULL" || bias === "BULL") ? "BUY" :
    setupConfidence >= 70 && (bias === "STRONG_BEAR" || bias === "BEAR") ? "SELL" :
    signals.distribution.detected ? "REDUCE_POSITION" :
    setupConfidence >= 50 ? "WAIT_FOR_CONFIRMATION" :
    "AVOID";

  const verdict = `${bias} bias (${signals.compositeScore}/100). Phase: ${phase}. ${action}.`;

  const keyLevels = [
    { label: "POC", price: vp.profile.poc },
    { label: "VAH", price: vp.profile.vah },
    { label: "VAL", price: vp.profile.val },
    ...(structure.swingHighs.slice(-2).map((sh) => ({ label: "Swing High", price: sh.price }))),
    ...(structure.swingLows.slice(-2).map((sl) => ({ label: "Swing Low", price: sl.price }))),
  ].filter((l) => l.price > 0);

  return {
    verdict,
    marketPhase: phase,
    recommendedAction: action,
    confidence: Math.round((signals.compositeScore + setupConfidence) / 2),
    keyLevels,
  };
}
