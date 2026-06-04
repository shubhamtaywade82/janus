import type { Order } from "../../../domain/orders/order.js";
import type { OrderStorePort } from "../../../application/ports/order-store.port.js";

export class InMemoryOrderRepository implements OrderStorePort {
  private store = new Map<string, Order>();

  async save(order: Order): Promise<void> {
    this.store.set(order.id, { ...order });
  }

  async findById(id: string): Promise<Order | null> {
    return this.store.get(id) ?? null;
  }

  async findByClientOrderId(clientOrderId: string): Promise<Order | null> {
    for (const order of this.store.values()) {
      if (order.clientOrderId === clientOrderId) return order;
    }
    return null;
  }

  async findByExchangeOrderId(exchangeOrderId: string): Promise<Order | null> {
    for (const order of this.store.values()) {
      if (order.exchangeOrderId === exchangeOrderId) return order;
    }
    return null;
  }

  async findBySymbol(symbol: string, limit = 100): Promise<Order[]> {
    const results: Order[] = [];
    for (const order of this.store.values()) {
      if (order.symbol === symbol) results.push(order);
    }
    return results.slice(-limit);
  }

  async findOpen(): Promise<Order[]> {
    const open: Order[] = [];
    for (const order of this.store.values()) {
      if (order.status === "submitted" || order.status === "partially_filled") {
        open.push(order);
      }
    }
    return open;
  }

  async update(id: string, patch: Partial<Order>): Promise<void> {
    const existing = this.store.get(id);
    if (existing) this.store.set(id, { ...existing, ...patch });
  }
}
