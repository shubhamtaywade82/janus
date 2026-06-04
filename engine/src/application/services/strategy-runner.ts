import { nanoid } from "nanoid";
import type { TradeSignal } from "../../domain/signals/trade-signal.js";
import type { OrderbookSnapshot } from "../../domain/market-data/orderbook.js";
import type { Candle } from "../../domain/market-data/candle.js";
import type { TradeTick } from "../../domain/market-data/trade-tick.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import { DomainEvents } from "../../domain/common/events.js";

export interface Strategy {
  id: string;
  name: string;
  symbols: string[];
  onOrderbook?(snapshot: OrderbookSnapshot): TradeSignal | null;
  onCandle?(candle: Candle): TradeSignal | null;
  onTrade?(tick: TradeTick): TradeSignal | null;
}

export class StrategyRunner {
  private strategies: Map<string, Strategy> = new Map();

  constructor(private readonly eventBus: EventBusPort) {
    this.wireEventHandlers();
  }

  register(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  unregister(strategyId: string): void {
    this.strategies.delete(strategyId);
  }

  private wireEventHandlers(): void {
    this.eventBus.subscribe<OrderbookSnapshot>(DomainEvents.MARKET_ORDERBOOK_UPDATED, (snapshot) => {
      for (const strategy of this.strategies.values()) {
        if (!strategy.symbols.includes(snapshot.symbol)) continue;
        const signal = strategy.onOrderbook?.(snapshot);
        if (signal) this.emit(signal);
      }
    });

    this.eventBus.subscribe<Candle>(DomainEvents.MARKET_CANDLE_CLOSED, (candle) => {
      for (const strategy of this.strategies.values()) {
        if (!strategy.symbols.includes(candle.symbol)) continue;
        const signal = strategy.onCandle?.(candle);
        if (signal) this.emit(signal);
      }
    });

    this.eventBus.subscribe<TradeTick>(DomainEvents.MARKET_TRADE_TICK, (tick) => {
      for (const strategy of this.strategies.values()) {
        if (!strategy.symbols.includes(tick.symbol)) continue;
        const signal = strategy.onTrade?.(tick);
        if (signal) this.emit(signal);
      }
    });
  }

  private emit(signal: TradeSignal): void {
    this.eventBus.publish(DomainEvents.SIGNAL_GENERATED, signal);
  }
}
