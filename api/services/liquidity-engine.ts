import { EventEmitter } from "events";
import { marketStateManager } from "./market-state";
import { broadcastTelegramAlert } from "./telegram";

export type LiquidityPriority = "SSS" | "SS" | "S" | "A" | "B";

export interface LiquidityEvent {
  id: string;
  type: string;
  priority: LiquidityPriority;
  symbol: string;
  timestamp: number;
  message: string;
  data?: any;
}

export class LiquidityEngine extends EventEmitter {
  private static instance: LiquidityEngine;
  private lastFiredTimes = new Map<string, number>();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): LiquidityEngine {
    if (!LiquidityEngine.instance) {
      LiquidityEngine.instance = new LiquidityEngine();
    }
    return LiquidityEngine.instance;
  }

  /**
   * Helper to throttle identical alerts per symbol to prevent spam
   */
  private shouldFireEvent(symbol: string, eventType: string, cooldownMs = 15000): boolean {
    const key = `${symbol}:${eventType}`;
    const lastTime = this.lastFiredTimes.get(key) || 0;
    const now = Date.now();
    if (now - lastTime > cooldownMs) {
      this.lastFiredTimes.set(key, now);
      return true;
    }
    return false;
  }

  public processTick(symbol: string) {
    const state = marketStateManager.get(symbol);
    if (!state) return;

    const events: LiquidityEvent[] = [];
    const now = Date.now();

    this.checkLiquidations(symbol, state, events, now);
    this.checkFundingSqueezes(symbol, state, events, now);
    this.checkAbsorption(symbol, state, events, now);
    this.checkSweeps(symbol, state, events, now);
    this.checkLiquidityPools(symbol, state, events, now);
    this.checkHuntsAndTraps(symbol, state, events, now);
    this.checkVoidsAndExhaustion(symbol, state, events, now);
    this.checkValueAreas(symbol, state, events, now);
    this.checkDepthShifts(symbol, state, events, now);

    for (const ev of events) {
      this.emit("liquidity_event", ev);
      if (ev.priority === "SSS" || ev.priority === "SS") {
        this.notifyTelegram(ev);
      }
    }
  }

  private checkLiquidations(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const recentLiqs = state.liquidationWindow.values().filter((l: any) => now - l.timestamp < 60000);
    const longLiqs = recentLiqs.filter((l: any) => l.side === "SELL");
    const shortLiqs = recentLiqs.filter((l: any) => l.side === "BUY");
    
    const longLiqVol = longLiqs.reduce((sum: number, l: any) => sum + (l.quantity * l.price), 0);
    const shortLiqVol = shortLiqs.reduce((sum: number, l: any) => sum + (l.quantity * l.price), 0);

    if (longLiqs.length >= 10 && longLiqVol > 500000 && this.shouldFireEvent(symbol, "LONG_LIQUIDATION_CASCADE", 120000)) {
      events.push(this.createEvent("LONG_LIQUIDATION_CASCADE", "SS", symbol, now, `Long Liquidation Cascade: ${longLiqs.length} liqs ($${(longLiqVol/1000).toFixed(0)}k)`, { volume: longLiqVol, count: longLiqs.length }));
    }
    if (shortLiqs.length >= 10 && shortLiqVol > 500000 && this.shouldFireEvent(symbol, "SHORT_LIQUIDATION_CASCADE", 120000)) {
      events.push(this.createEvent("SHORT_LIQUIDATION_CASCADE", "SS", symbol, now, `Short Liquidation Cascade: ${shortLiqs.length} liqs ($${(shortLiqVol/1000).toFixed(0)}k)`, { volume: shortLiqVol, count: shortLiqs.length }));
    }
  }

  private checkFundingSqueezes(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    if (!state.latestFunding) return;
    const fr = state.latestFunding.fundingRate;
    const sweepScore = state.metrics.sweepScore;
    
    if (fr < -0.001 && sweepScore > 60 && this.shouldFireEvent(symbol, "SHORT_SQUEEZE", 300000)) {
      events.push(this.createEvent("SHORT_SQUEEZE", "SS", symbol, now, `Short Squeeze Risk: Negative funding (${(fr * 100).toFixed(4)}%)`, { fundingRate: fr, sweepScore }));
    }
    if (fr > 0.001 && sweepScore > 60 && state.ltp < state.previousLtp && this.shouldFireEvent(symbol, "LONG_SQUEEZE", 300000)) {
      events.push(this.createEvent("LONG_SQUEEZE", "SS", symbol, now, `Long Squeeze Risk: High funding (${(fr * 100).toFixed(4)}%)`, { fundingRate: fr, sweepScore }));
    }
  }

  private checkAbsorption(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const bookDepth = state.metrics.bidDepth + state.metrics.askDepth;
    const trades = state.tradeWindow.values().slice(-100);
    const buyVol = trades.filter((t: any) => t.side === "BUY").reduce((s: number, t: any) => s + t.quantity, 0);
    const sellVol = trades.filter((t: any) => t.side === "SELL").reduce((s: number, t: any) => s + t.quantity, 0);
    const totalVol = buyVol + sellVol;

    if (state.metrics.absorptionScore > 40 && bookDepth > 0 && totalVol >= bookDepth * 0.02 && this.shouldFireEvent(symbol, "ABSORPTION", 60000)) {
      const type = buyVol > sellVol ? "BUY_ABSORPTION" : "SELL_ABSORPTION";
      const isExtreme = state.metrics.absorptionScore > 80 && totalVol >= bookDepth * 0.05;
      events.push(this.createEvent(type, isExtreme ? "SSS" : "S", symbol, now, `${type.replace("_", " ")} detected`, { absorptionScore: state.metrics.absorptionScore, buyVol, sellVol }));
    }
  }

  private checkSweeps(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const ltpWindow = state.ltpWindow.values();
    if (ltpWindow.length < 30) return;

    const prices = ltpWindow.map((x: any) => x.price);
    const localHigh = Math.max(...prices.slice(0, -1));
    const localLow = Math.min(...prices.slice(0, -1));
    const rangePct = (localHigh - localLow) / (localLow || 1);

    if (rangePct < 0.0008 || state.metrics.sweepScore < 65) return;

    if (state.previousLtp >= localHigh && state.ltp < localHigh && this.shouldFireEvent(symbol, "BUY_SIDE_SWEEP", 60000)) {
      events.push(this.createEvent("BUY_SIDE_SWEEP", "SSS", symbol, now, "Buy-Side Sweep: Price broke local high and rejected", { level: localHigh, direction: "BEARISH" }));
    }
    if (state.previousLtp <= localLow && state.ltp > localLow && this.shouldFireEvent(symbol, "SELL_SIDE_SWEEP", 60000)) {
      events.push(this.createEvent("SELL_SIDE_SWEEP", "SSS", symbol, now, "Sell-Side Sweep: Price broke local low and rejected", { level: localLow, direction: "BULLISH" }));
    }
  }

  private checkLiquidityPools(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    if (!state.orderBook) return;
    const { bids, asks } = state.orderBook;
    
    const bsl = asks.find((a: any) => a[1] > state.metrics.askDepth * 0.08);
    const ssl = bids.find((b: any) => b[1] > state.metrics.bidDepth * 0.08);

    if (bsl && this.shouldFireEvent(symbol, "BUY_SIDE_LIQUIDITY_CREATED", 30000)) {
      events.push(this.createEvent("BS_LIQUIDITY_CREATED", "S", symbol, now, `Buy-Side Pool at $${bsl[0].toFixed(2)}`, { level: bsl[0] }));
    }
    if (ssl && this.shouldFireEvent(symbol, "SELL_SIDE_LIQUIDITY_CREATED", 30000)) {
      events.push(this.createEvent("SS_LIQUIDITY_CREATED", "S", symbol, now, `Sell-Side Pool at $${ssl[0].toFixed(2)}`, { level: ssl[0] }));
    }
  }

  private checkHuntsAndTraps(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const trades = state.tradeWindow.values();
    const tradeVolume = trades.slice(-50).reduce((sum: number, t: any) => sum + t.quantity, 0);

    if (state.metrics.sweepScore > 40 && tradeVolume > state.metrics.bidDepth * 0.03 && this.shouldFireEvent(symbol, "LIQUIDITY_GRAB", 15000)) {
      events.push(this.createEvent("LIQUIDITY_GRAB", "S", symbol, now, "Fast Liquidity Grab on high volume", { volume: tradeVolume }));
    }

    if (state.metrics.sweepScore > 50 && Math.abs(state.ltp - state.previousLtp) > state.ltp * 0.0005 && this.shouldFireEvent(symbol, "LIQUIDITY_RUN", 15000)) {
      const side = state.ltp > state.previousLtp ? "BUY_SIDE" : "SELL_SIDE";
      events.push(this.createEvent("LIQUIDITY_RUN", "S", symbol, now, `Liquidity Run (${side})`, { side }));
    }

    const recentLiqs = state.liquidationWindow.values().filter((l: any) => now - l.timestamp < 60000);
    if (recentLiqs.length >= 1 && state.metrics.absorptionScore > 30 && this.shouldFireEvent(symbol, "STOP_HUNT", 15000)) {
      const victim = recentLiqs[0].side === "SELL" ? "LONGS" : "SHORTS";
      events.push(this.createEvent("STOP_HUNT", "S", symbol, now, `Stop Hunt: extracting ${victim}`, { victim }));
    }

    if (state.metrics.sweepScore > 40 && state.metrics.absorptionScore > 40 && this.shouldFireEvent(symbol, "INDUCEMENT", 20000)) {
      const isBullishTrap = state.ltp > state.previousLtp;
      events.push(this.createEvent("INDUCEMENT", "S", symbol, now, `Inducement: ${isBullishTrap ? "Bullish" : "Bearish"} Trap`, { direction: isBullishTrap ? "BULLISH_TRAP" : "BEARISH_TRAP" }));
    }
  }

  private checkVoidsAndExhaustion(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    if (Math.abs(state.ltp - state.previousLtp) > state.ltp * 0.0015 && this.shouldFireEvent(symbol, "LIQUIDITY_VOID", 30000)) {
      events.push(this.createEvent("LIQUIDITY_VOID", "A", symbol, now, "Liquidity Void created", { range: { low: Math.min(state.previousLtp, state.ltp), high: Math.max(state.previousLtp, state.ltp) } }));
    }

    if (state.metrics.absorptionScore > 40 && Math.abs(state.ltp - state.previousLtp) < state.ltp * 0.0003 && this.shouldFireEvent(symbol, "LIQUIDITY_FILL", 30000)) {
      events.push(this.createEvent("LIQUIDITY_FILL", "A", symbol, now, "Liquidity Fill in progress"));
    }

    if (state.metrics.volatilityRegime !== "LOW" && state.metrics.absorptionScore > 50 && this.shouldFireEvent(symbol, "EXHAUSTION", 20000)) {
      const side = state.ltp > state.previousLtp ? "BUYER_EXHAUSTION" : "SELLER_EXHAUSTION";
      events.push(this.createEvent(side, "A", symbol, now, `Momentum Exhaustion: ${side.split("_")[0]}`));
    }
  }

  private checkValueAreas(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const prices = state.ltpWindow.values().map((t: any) => t.price).sort((a: number, b: number) => a - b);
    if (prices.length < 20) return;

    const val = prices[Math.floor(prices.length * 0.2)];
    const vah = prices[Math.floor(prices.length * 0.8)];
    
    const rejected = (state.ltp <= vah && state.previousLtp >= vah) || (state.ltp >= val && state.previousLtp <= val);
    const accepted = (state.ltp >= vah && state.previousLtp < vah) || (state.ltp <= val && state.previousLtp > val);

    if (rejected && this.shouldFireEvent(symbol, "VALUE_AREA_REJECTION", 25000)) {
      events.push(this.createEvent("VALUE_AREA_REJECTION", "A", symbol, now, "Value Area Rejection"));
    }
    if (accepted && this.shouldFireEvent(symbol, "VALUE_AREA_ACCEPTANCE", 25000)) {
      events.push(this.createEvent("VALUE_AREA_ACCEPTANCE", "A", symbol, now, "Value Area Acceptance"));
    }
  }

  private checkDepthShifts(symbol: string, state: any, events: LiquidityEvent[], now: number) {
    const deltas = state.deltaWindow.values().slice(-20);
    const recent = deltas.reduce((acc: any, d: any) => ({
      bidAdded: acc.bidAdded + d.bidAdded,
      bidRemoved: acc.bidRemoved + d.bidRemoved,
      askAdded: acc.askAdded + d.askAdded,
      askRemoved: acc.askRemoved + d.askRemoved
    }), { bidAdded: 0, bidRemoved: 0, askAdded: 0, askRemoved: 0 });

    const totalDepth = state.metrics.bidDepth + state.metrics.askDepth;
    if (totalDepth <= 0) return;

    if (recent.bidAdded > state.metrics.bidDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_ADDED:BID", 15000)) {
      events.push(this.createEvent("RESTING_LIQ_ADDED", "B", symbol, now, "BIDs Added (+5%)", { side: "BID" }));
    }
    if (recent.askAdded > state.metrics.askDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_ADDED:ASK", 15000)) {
      events.push(this.createEvent("RESTING_LIQ_ADDED", "B", symbol, now, "ASKs Added (+5%)", { side: "ASK" }));
    }
    if (recent.bidRemoved > state.metrics.bidDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_REMOVED:BID", 15000)) {
      events.push(this.createEvent("RESTING_LIQ_REMOVED", "B", symbol, now, "BIDs Removed (-5%)", { side: "BID" }));
    }
    if (recent.askRemoved > state.metrics.askDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_REMOVED:ASK", 15000)) {
      events.push(this.createEvent("RESTING_LIQ_REMOVED", "B", symbol, now, "ASKs Removed (-5%)", { side: "ASK" }));
    }

    if ((recent.bidRemoved > state.metrics.bidDepth * 0.1 || recent.askRemoved > state.metrics.askDepth * 0.1) && this.shouldFireEvent(symbol, "LIQUIDITY_PULL", 15000)) {
      const side = recent.bidRemoved > recent.askRemoved ? "BID" : "ASK";
      events.push(this.createEvent("LIQUIDITY_PULL", "B", symbol, now, `Depth thinned (${side})`, { side }));
    }

    if (state.orderBook) {
      const { bids, asks } = state.orderBook;
      const stackBids = bids.filter((b: any) => b[1] > state.metrics.bidDepth * 0.05);
      const stackAsks = asks.filter((a: any) => a[1] > state.metrics.askDepth * 0.05);
      
      if (stackBids.length >= 2 && this.shouldFireEvent(symbol, "LIQUIDITY_STACK:BID", 30000)) {
        events.push(this.createEvent("LIQUIDITY_STACK", "B", symbol, now, "Bid Stack Detected", { side: "BID" }));
      }
      if (stackAsks.length >= 2 && this.shouldFireEvent(symbol, "LIQUIDITY_STACK:ASK", 30000)) {
        events.push(this.createEvent("LIQUIDITY_STACK", "B", symbol, now, "Ask Stack Detected", { side: "ASK" }));
      }
    }
  }

  private createEvent(type: string, priority: LiquidityPriority, symbol: string, timestamp: number, message: string, data?: any): LiquidityEvent {
    return { id: Math.random().toString(36).substring(7), type, priority, symbol, timestamp, message, data };
  }

  private notifyTelegram(ev: LiquidityEvent) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const text = `🚨 <b>[${ev.priority}] ${esc(ev.symbol)} Liquidity Alert</b>\n\n<b>Type:</b> ${esc(ev.type.replace(/_/g, " "))}\n<b>Message:</b> ${esc(ev.message)}`;
    broadcastTelegramAlert(text).catch(err => console.error("Failed to broadcast telegram alert", err));
  }
}

export const liquidityEngine = LiquidityEngine.getInstance();
