export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventBusPort {
  publish<T = unknown>(eventName: string, payload: T): void;
  subscribe<T = unknown>(eventName: string, handler: EventHandler<T>): () => void;
  once<T = unknown>(eventName: string, handler: EventHandler<T>): void;
}
