import { nanoid } from "nanoid";
import type { ExchangeGatewayPort } from "../ports/exchange-gateway.port.js";
import type { ExecutionIntent } from "../../domain/signals/execution-intent.js";
import type { Order } from "../../domain/orders/order.js";
import type { OrderStorePort } from "../ports/order-store.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import { DomainEvents } from "../../domain/common/events.js";

export class ExecutionEngine {
  constructor(
    private readonly gateways: Map<string, ExchangeGatewayPort>,
    private readonly orderStore: OrderStorePort,
    private readonly eventBus: EventBusPort
  ) {}

  async execute(intent: ExecutionIntent): Promise<Order> {
    const gateway = this.gateways.get(intent.exchange);
    if (!gateway) throw new Error(`No gateway registered for exchange: ${intent.exchange}`);

    const order: Order = {
      id: nanoid(),
      clientOrderId: intent.clientOrderId,
      symbol: intent.symbol,
      exchange: intent.exchange,
      side: intent.side,
      type: intent.orderType,
      price: intent.price,
      quantity: intent.quantity,
      filledQuantity: 0,
      remainingQuantity: intent.quantity,
      status: "created",
      signalId: intent.signalId,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.orderStore.save(order);

    try {
      const result = await gateway.placeOrder({
        symbol: intent.symbol,
        side: intent.side,
        type: intent.orderType,
        quantity: intent.quantity,
        price: intent.price,
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
        postOnly: intent.postOnly,
        reduceOnly: intent.reduceOnly,
        leverage: intent.leverage,
        clientOrderId: intent.clientOrderId,
      });

      const submitted: Order = {
        ...order,
        exchangeOrderId: result.exchangeOrderId,
        status: result.status,
        submittedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.orderStore.update(order.id, {
        exchangeOrderId: result.exchangeOrderId,
        status: result.status,
        submittedAt: submitted.submittedAt,
        updatedAt: submitted.updatedAt,
      });

      this.eventBus.publish(DomainEvents.ORDER_SUBMITTED, { order: submitted });
      return submitted;
    } catch (error) {
      const rejected: Partial<Order> = { status: "rejected", updatedAt: Date.now() };
      await this.orderStore.update(order.id, rejected);
      this.eventBus.publish(DomainEvents.ORDER_REJECTED, { order: { ...order, ...rejected }, reason: String(error) });
      throw error;
    }
  }

  async cancel(orderId: string): Promise<void> {
    const order = await this.orderStore.findById(orderId);
    if (!order || !order.exchangeOrderId) throw new Error(`Order ${orderId} not found or not submitted`);

    const gateway = this.gateways.get(order.exchange);
    if (!gateway) throw new Error(`No gateway for ${order.exchange}`);

    await gateway.cancelOrder({ exchangeOrderId: order.exchangeOrderId, symbol: order.symbol });
    await this.orderStore.update(orderId, { status: "cancelled", updatedAt: Date.now() });
    this.eventBus.publish(DomainEvents.ORDER_CANCELLED, { order });
  }
}
