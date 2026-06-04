import { EventEmitter } from "events";
import type { EventBusPort, EventHandler } from "../../application/ports/event-bus.port.js";

export class InMemoryEventBus implements EventBusPort {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish<T = unknown>(eventName: string, payload: T): void {
    this.emitter.emit(eventName, payload);
  }

  subscribe<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    const wrapper = (payload: T) => handler(payload);
    this.emitter.on(eventName, wrapper);
    return () => this.emitter.off(eventName, wrapper);
  }

  once<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    this.emitter.once(eventName, handler);
  }
}
