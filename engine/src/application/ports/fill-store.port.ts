import type { Fill } from "../../domain/fills/fill.js";

export interface FillStorePort {
  save(fill: Fill): Promise<void>;
  findByOrderId(orderId: string): Promise<Fill[]>;
  findBySymbol(symbol: string, since?: number): Promise<Fill[]>;
  findAll(since?: number): Promise<Fill[]>;
  isDuplicate(exchangeFillId: string): Promise<boolean>;
}
