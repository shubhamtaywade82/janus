import type { Order } from "./order.js";
import type { Fill } from "../fills/fill.js";

export interface OrderSubmittedEvent {
  order: Order;
  ts: number;
}

export interface OrderFilledEvent {
  order: Order;
  fill: Fill;
  ts: number;
}

export interface OrderCancelledEvent {
  order: Order;
  reason?: string;
  ts: number;
}

export interface OrderRejectedEvent {
  order: Order;
  reason: string;
  ts: number;
}
