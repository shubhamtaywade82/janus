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

    // ─── 1. Liquidations & Squeezes (SS Priority) ───
    const recentLiqs = state.liquidationWindow.values().filter(l => now - l.timestamp < 60000);
    const longLiqs = recentLiqs.filter(l => l.side === "SELL");
    const shortLiqs = recentLiqs.filter(l => l.side === "BUY");
    
    const longLiqVol = longLiqs.reduce((sum, l) => sum + (l.quantity * l.price), 0);
    const shortLiqVol = shortLiqs.reduce((sum, l) => sum + (l.quantity * l.price), 0);

    // 15. LONG_LIQUIDATION_CASCADE
    if (longLiqs.length >= 8 && longLiqVol > 300000 && this.shouldFireEvent(symbol, "LONG_LIQUIDATION_CASCADE", 30000)) {
      events.push({
        id: Math.random().toString(),
        type: "LONG_LIQUIDATION_CASCADE",
        priority: "SS",
        symbol,
        timestamp: now,
        message: `Long Liquidation Cascade: ${longLiqs.length} liquidations ($${(longLiqVol/1000).toFixed(0)}k volume)`,
        data: { volume: longLiqVol, count: longLiqs.length }
      });
    }

    // 16. SHORT_LIQUIDATION_CASCADE
    if (shortLiqs.length >= 8 && shortLiqVol > 300000 && this.shouldFireEvent(symbol, "SHORT_LIQUIDATION_CASCADE", 30000)) {
      events.push({
        id: Math.random().toString(),
        type: "SHORT_LIQUIDATION_CASCADE",
        priority: "SS",
        symbol,
        timestamp: now,
        message: `Short Liquidation Cascade: ${shortLiqs.length} liquidations ($${(shortLiqVol/1000).toFixed(0)}k volume)`,
        data: { volume: shortLiqVol, count: shortLiqs.length }
      });
    }

    // Funding Rate & Squeezes
    if (state.latestFunding) {
      const fr = state.latestFunding.fundingRate;
      const pctChange = state.metrics.sweepScore;
      
      // 17. SHORT_SQUEEZE
      if (fr < -0.0008 && pctChange > 40 && this.shouldFireEvent(symbol, "SHORT_SQUEEZE", 45000)) {
        events.push({
          id: Math.random().toString(),
          type: "SHORT_SQUEEZE",
          priority: "SS",
          symbol,
          timestamp: now,
          message: `Short Squeeze Risk: Extreme negative funding (${(fr * 100).toFixed(4)}%) with buying pressure`,
          data: { fundingRate: fr, sweepScore: pctChange }
        });
      }
      
      // 18. LONG_SQUEEZE
      if (fr > 0.0008 && pctChange > 40 && state.ltp < state.previousLtp && this.shouldFireEvent(symbol, "LONG_SQUEEZE", 45000)) {
        events.push({
          id: Math.random().toString(),
          type: "LONG_SQUEEZE",
          priority: "SS",
          symbol,
          timestamp: now,
          message: `Long Squeeze Risk: High positive funding (${(fr * 100).toFixed(4)}%) with selling pressure`,
          data: { fundingRate: fr, sweepScore: pctChange }
        });
      }
    }

    // ─── 2. Orderbook Absorption & Sweeps (SSS Priority) ───
    
    // 13. ABSORPTION (Extreme Buy/Sell Absorption)
    if (state.metrics.absorptionScore > 40 && this.shouldFireEvent(symbol, "ABSORPTION", 10000)) {
      const trades = state.tradeWindow.values().slice(-100);
      const buyVol = trades.filter(t => t.side === "BUY").reduce((s, t) => s + t.quantity, 0);
      const sellVol = trades.filter(t => t.side === "SELL").reduce((s, t) => s + t.quantity, 0);
      const type = buyVol > sellVol ? "BUY_ABSORPTION" : "SELL_ABSORPTION";
      
      events.push({
        id: Math.random().toString(),
        type,
        priority: state.metrics.absorptionScore > 70 ? "SSS" : "S",
        symbol,
        timestamp: now,
        message: `${type === "BUY_ABSORPTION" ? "Buy Absorption" : "Sell Absorption"} detected`,
        data: { absorptionScore: state.metrics.absorptionScore, buyVol, sellVol }
      });
    }

    // 2. LIQUIDITY SWEEP (Buy/Sell Side Sweeps)
    // Breaks above/below local extreme then rejects back inside range
    const ltpWindow = state.ltpWindow.values();
    if (ltpWindow.length >= 30) {
      const prices = ltpWindow.map(x => x.price);
      const lastPrice = state.ltp;
      const prevPrice = state.previousLtp;
      
      const localHigh = Math.max(...prices.slice(0, -1));
      const localLow = Math.min(...prices.slice(0, -1));

      // Buy-side Sweep
      if (prevPrice >= localHigh && lastPrice < localHigh && this.shouldFireEvent(symbol, "BUY_SIDE_SWEEP", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "BUY_SIDE_SWEEP",
          priority: "SSS",
          symbol,
          timestamp: now,
          message: `Buy-Side Sweep: Price broke local high and rejected`,
          data: { level: localHigh, direction: "BEARISH" }
        });
      }
      
      // Sell-side Sweep
      if (prevPrice <= localLow && lastPrice > localLow && this.shouldFireEvent(symbol, "SELL_SIDE_SWEEP", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "SELL_SIDE_SWEEP",
          priority: "SSS",
          symbol,
          timestamp: now,
          message: `Sell-Side Sweep: Price broke local low and rejected`,
          data: { level: localLow, direction: "BULLISH" }
        });
      }
    }

    // ─── 3. Liquidity Pool Creation (S Priority) ───
    
    // 1. LIQUIDITY POOL CREATION (BSL/SSL stops accumulation)
    if (state.orderBook) {
      const bids = state.orderBook.bids;
      const asks = state.orderBook.asks;
      
      const bslLevel = asks.find(a => a[1] > state.metrics.askDepth * 0.08); // Lowered to 8%
      const sslLevel = bids.find(b => b[1] > state.metrics.bidDepth * 0.08);

      if (bslLevel && this.shouldFireEvent(symbol, "BUY_SIDE_LIQUIDITY_CREATED", 30000)) {
        events.push({
          id: Math.random().toString(),
          type: "BS_LIQUIDITY_CREATED",
          priority: "S",
          symbol,
          timestamp: now,
          message: `Buy-Side Pool at $${bslLevel[0].toFixed(2)}`,
          data: { level: bslLevel[0], strength: "HIGH" }
        });
      }
      if (sslLevel && this.shouldFireEvent(symbol, "SELL_SIDE_LIQUIDITY_CREATED", 30000)) {
        events.push({
          id: Math.random().toString(),
          type: "SS_LIQUIDITY_CREATED",
          priority: "S",
          symbol,
          timestamp: now,
          message: `Sell-Side Pool at $${sslLevel[0].toFixed(2)}`,
          data: { level: sslLevel[0], strength: "HIGH" }
        });
      }
    }

    // ─── 4. Stop Hunt & Inducement & Grab (S Priority) ───

    // 3. LIQUIDITY_GRAB (Fast sweep rejection)
    const trades = state.tradeWindow.values();
    const tradeVolume = trades.slice(-50).reduce((sum, t) => sum + t.quantity, 0);
    if (state.metrics.sweepScore > 40 && tradeVolume > state.metrics.bidDepth * 0.03 && this.shouldFireEvent(symbol, "LIQUIDITY_GRAB", 15000)) {
      events.push({
        id: Math.random().toString(),
        type: "LIQUIDITY_GRAB",
        priority: "S",
        symbol,
        timestamp: now,
        message: `Fast Liquidity Grab on high volume`,
        data: { strength: "EXTREME", volume: tradeVolume }
      });
    }

    // 4. LIQUIDITY RUN (Continuation - Equal Highs Broken with force)
    if (state.metrics.sweepScore > 50 && Math.abs(state.ltp - state.previousLtp) > state.ltp * 0.0005 && this.shouldFireEvent(symbol, "LIQUIDITY_RUN", 15000)) {
      const side = state.ltp > state.previousLtp ? "BUY_SIDE" : "SELL_SIDE";
      events.push({
        id: Math.random().toString(),
        type: "LIQUIDITY_RUN",
        priority: "S",
        symbol,
        timestamp: now,
        message: `Liquidity Run in progress (${side})`,
        data: { side, strength: "STRONG" }
      });
    }

    // 5. STOP HUNT (Retail Stop Extraction)
    if (recentLiqs.length >= 1 && state.metrics.absorptionScore > 30 && this.shouldFireEvent(symbol, "STOP_HUNT", 15000)) {
      const victim_side = recentLiqs[0].side === "SELL" ? "LONGS" : "SHORTS";
      events.push({
        id: Math.random().toString(),
        type: "STOP_HUNT",
        priority: "S",
        symbol,
        timestamp: now,
        message: `Stop Hunt: extracting ${victim_side}`,
        data: { victim_side }
      });
    }

    // 6. INDUCEMENT (Fake move / Trap buyers/sellers)
    if (state.metrics.sweepScore > 40 && state.metrics.absorptionScore > 40 && this.shouldFireEvent(symbol, "INDUCEMENT", 20000)) {
      const isBullishTrap = state.ltp > state.previousLtp;
      events.push({
        id: Math.random().toString(),
        type: "INDUCEMENT",
        priority: "S",
        symbol,
        timestamp: now,
        message: `Inducement Alert: ${isBullishTrap ? "Bullish" : "Bearish"} Trap`,
        data: { direction: isBullishTrap ? "BULLISH_TRAP" : "BEARISH_TRAP" }
      });
    }

    // ─── 5. Liquidity Void & Fill (A Priority) ───
    
    // 7. LIQUIDITY_VOID (Displacement range, e.g. FVG)
    if (Math.abs(state.ltp - state.previousLtp) > state.ltp * 0.0015 && this.shouldFireEvent(symbol, "LIQUIDITY_VOID", 30000)) {
      const lowRange = Math.min(state.previousLtp, state.ltp);
      const highRange = Math.max(state.previousLtp, state.ltp);
      events.push({
        id: Math.random().toString(),
        type: "LIQUIDITY_VOID",
        priority: "A",
        symbol,
        timestamp: now,
        message: `Liquidity Void created`,
        data: { range: { low: lowRange, high: highRange } }
      });
    }

    // 8. LIQUIDITY_FILL (Filling of voids/gaps)
    if (state.metrics.absorptionScore > 40 && Math.abs(state.ltp - state.previousLtp) < state.ltp * 0.0003 && this.shouldFireEvent(symbol, "LIQUIDITY_FILL", 30000)) {
      events.push({
        id: Math.random().toString(),
        type: "LIQUIDITY_FILL",
        priority: "A",
        symbol,
        timestamp: now,
        message: `Liquidity Fill in progress`,
        data: { completion: 100 }
      });
    }

    // 14. EXHAUSTION
    if (state.metrics.volatilityRegime !== "LOW" && state.metrics.absorptionScore > 50 && this.shouldFireEvent(symbol, "EXHAUSTION", 20000)) {
      const side = state.ltp > state.previousLtp ? "BUYER_EXHAUSTION" : "SELLER_EXHAUSTION";
      events.push({
        id: Math.random().toString(),
        type: side,
        priority: "A",
        symbol,
        timestamp: now,
        message: `Momentum Exhaustion: ${side.split('_')[0]}`
      });
    }

    // ─── 6. Volume Profile Rejection & Acceptance (A Priority) ───
    const prices = ltpWindow.map(t => t.price).sort((a,b)=>a-b);
    if (prices.length >= 20) {
      const val = prices[Math.floor(prices.length * 0.2)]; // Value Area Low
      const vah = prices[Math.floor(prices.length * 0.8)]; // Value Area High
      
      // 19. VALUE_AREA_REJECTION
      if ((state.ltp <= vah && state.previousLtp >= vah && this.shouldFireEvent(symbol, "VALUE_AREA_REJECTION", 25000)) ||
          (state.ltp >= val && state.previousLtp <= val && this.shouldFireEvent(symbol, "VALUE_AREA_REJECTION", 25000))) {
        events.push({
          id: Math.random().toString(),
          type: "VALUE_AREA_REJECTION",
          priority: "A",
          symbol,
          timestamp: now,
          message: "Value Area Rejection"
        });
      }

      // 20. VALUE_AREA_ACCEPTANCE
      if ((state.ltp >= vah && state.previousLtp < vah && this.shouldFireEvent(symbol, "VALUE_AREA_ACCEPTANCE", 25000)) ||
          (state.ltp <= val && state.previousLtp > val && this.shouldFireEvent(symbol, "VALUE_AREA_ACCEPTANCE", 25000))) {
        events.push({
          id: Math.random().toString(),
          type: "VALUE_AREA_ACCEPTANCE",
          priority: "A",
          symbol,
          timestamp: now,
          message: "Value Area Acceptance"
        });
      }
    }

    // ─── 7. Orderbook Resting Depth shifts (B Priority) ───
    const deltas = state.deltaWindow.values().slice(-20);
    const recentDelta = deltas.reduce((acc, d) => ({
      bidAdded: acc.bidAdded + d.bidAdded,
      bidRemoved: acc.bidRemoved + d.bidRemoved,
      askAdded: acc.askAdded + d.askAdded,
      askRemoved: acc.askRemoved + d.askRemoved
    }), { bidAdded: 0, bidRemoved: 0, askAdded: 0, askRemoved: 0 });

    const totalDepth = state.metrics.bidDepth + state.metrics.askDepth;
    if (totalDepth > 0) {
      // 9. RESTING_LIQUIDITY_ADDED
      if (recentDelta.bidAdded > state.metrics.bidDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_ADDED:BID", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "RESTING_LIQ_ADDED",
          priority: "B",
          symbol,
          timestamp: now,
          message: "BIDs Added (+5%)",
          data: { side: "BID" }
        });
      }
      if (recentDelta.askAdded > state.metrics.askDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_ADDED:ASK", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "RESTING_LIQ_ADDED",
          priority: "B",
          symbol,
          timestamp: now,
          message: "ASKs Added (+5%)",
          data: { side: "ASK" }
        });
      }

      // 10. RESTING_LIQUIDITY_REMOVED
      if (recentDelta.bidRemoved > state.metrics.bidDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_REMOVED:BID", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "RESTING_LIQ_REMOVED",
          priority: "B",
          symbol,
          timestamp: now,
          message: "BIDs Removed (-5%)",
          data: { side: "BID" }
        });
      }
      if (recentDelta.askRemoved > state.metrics.askDepth * 0.05 && this.shouldFireEvent(symbol, "RESTING_LIQUIDITY_REMOVED:ASK", 15000)) {
        events.push({
          id: Math.random().toString(),
          type: "RESTING_LIQ_REMOVED",
          priority: "B",
          symbol,
          timestamp: now,
          message: "ASKs Removed (-5%)",
          data: { side: "ASK" }
        });
      }

      // 11. LIQUIDITY PULL
      if ((recentDelta.bidRemoved > state.metrics.bidDepth * 0.1 || recentDelta.askRemoved > state.metrics.askDepth * 0.1) && this.shouldFireEvent(symbol, "LIQUIDITY_PULL", 15000)) {
        const side = recentDelta.bidRemoved > recentDelta.askRemoved ? "BID" : "ASK";
        events.push({
          id: Math.random().toString(),
          type: "LIQUIDITY_PULL",
          priority: "B",
          symbol,
          timestamp: now,
          message: `Depth thinned (${side})`,
          data: { side, severity: "HIGH" }
        });
      }

      // 12. LIQUIDITY_STACK
      if (state.orderBook) {
        const stackBids = state.orderBook.bids.filter(b => b[1] > state.metrics.bidDepth * 0.05);
        const stackAsks = state.orderBook.asks.filter(a => a[1] > state.metrics.askDepth * 0.05);
        
        if (stackBids.length >= 2 && this.shouldFireEvent(symbol, "LIQUIDITY_STACK:BID", 30000)) {
          events.push({
            id: Math.random().toString(),
            type: "LIQUIDITY_STACK",
            priority: "B",
            symbol,
            timestamp: now,
            message: "Bid Stack Detected",
            data: { side: "BID", strength: "HIGH" }
          });
        }
        if (stackAsks.length >= 2 && this.shouldFireEvent(symbol, "LIQUIDITY_STACK:ASK", 30000)) {
          events.push({
            id: Math.random().toString(),
            type: "LIQUIDITY_STACK",
            priority: "B",
            symbol,
            timestamp: now,
            message: "Ask Stack Detected",
            data: { side: "ASK", strength: "HIGH" }
          });
        }
      }
    }

    // ─── Emit Events ───
    for (const ev of events) {
      this.emit("liquidity_event", ev);
      
      // Broadcast extreme high-priority events to Telegram
      if (ev.priority === "SSS" || ev.priority === "SS") {
        const text = `🚨 <b>[${ev.priority}] ${ev.symbol} Liquidity Alert</b>\n\n<b>Type:</b> ${ev.type.replace(/_/g, " ")}\n<b>Message:</b> ${ev.message}`;
        broadcastTelegramAlert(text).catch(err => console.error("Failed to broadcast telegram alert", err));
      }
    }
  }
}

export const liquidityEngine = LiquidityEngine.getInstance();
