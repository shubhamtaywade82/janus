import type { Order } from "../../domain/orders/order.js";

export interface OrderStorePort {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  findByClientOrderId(clientOrderId: string): Promise<Order | null>;
  findByExchangeOrderId(exchangeOrderId: string): Promise<Order | null>;
  findBySymbol(symbol: string, limit?: number): Promise<Order[]>;
  findOpen(): Promise<Order[]>;
  update(id: string, patch: Partial<Order>): Promise<void>;
}
