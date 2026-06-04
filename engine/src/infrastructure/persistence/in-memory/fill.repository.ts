import type { Fill } from "../../../domain/fills/fill.js";
import type { FillStorePort } from "../../../application/ports/fill-store.port.js";

export class InMemoryFillRepository implements FillStorePort {
  private store = new Map<string, Fill>();
  private exchangeFillIds = new Set<string>();

  async save(fill: Fill): Promise<void> {
    this.store.set(fill.id, { ...fill });
    if (fill.exchangeFillId) this.exchangeFillIds.add(fill.exchangeFillId);
  }

  async findByOrderId(orderId: string): Promise<Fill[]> {
    const results: Fill[] = [];
    for (const fill of this.store.values()) {
      if (fill.orderId === orderId) results.push(fill);
    }
    return results.sort((a, b) => a.ts - b.ts);
  }

  async findBySymbol(symbol: string, since = 0): Promise<Fill[]> {
    const results: Fill[] = [];
    for (const fill of this.store.values()) {
      if (fill.symbol === symbol && fill.ts >= since) results.push(fill);
    }
    return results.sort((a, b) => a.ts - b.ts);
  }

  async findAll(since = 0): Promise<Fill[]> {
    const results: Fill[] = [];
    for (const fill of this.store.values()) {
      if (fill.ts >= since) results.push(fill);
    }
    return results.sort((a, b) => a.ts - b.ts);
  }

  async isDuplicate(exchangeFillId: string): Promise<boolean> {
    return this.exchangeFillIds.has(exchangeFillId);
  }
}
