import { nanoid } from "nanoid";
import type { Fill } from "../../domain/fills/fill.js";
import type { FillStorePort } from "../ports/fill-store.port.js";
import type { OrderStorePort } from "../ports/order-store.port.js";
import type { PortfolioStorePort } from "../ports/portfolio-store.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import { PositionAggregator } from "../../domain/positions/position-aggregator.js";
import { PortfolioAggregator } from "../../domain/portfolio/portfolio-aggregator.js";
import { DomainEvents } from "../../domain/common/events.js";

export class LedgerEngine {
  constructor(
    private readonly fillStore: FillStorePort,
    private readonly orderStore: OrderStorePort,
    private readonly portfolioStore: PortfolioStorePort,
    private readonly eventBus: EventBusPort
  ) {}

  async applyFill(rawFill: Omit<Fill, "id">): Promise<void> {
    if (rawFill.exchangeFillId) {
      const isDup = await this.fillStore.isDuplicate(rawFill.exchangeFillId);
      if (isDup) return;
    }

    const fill: Fill = { ...rawFill, id: nanoid() };
    await this.fillStore.save(fill);

    // Update the order record
    const order = fill.orderId
      ? await this.orderStore.findById(fill.orderId)
        ?? await this.orderStore.findByExchangeOrderId(fill.exchangeOrderId ?? "")
      : null;

    if (order) {
      const newFilled = order.filledQuantity + fill.quantity;
      const newRemaining = order.quantity - newFilled;
      const newStatus = newRemaining <= 0 ? "filled" : "partially_filled";
      await this.orderStore.update(order.id, {
        filledQuantity: newFilled,
        remainingQuantity: Math.max(0, newRemaining),
        status: newStatus,
        updatedAt: Date.now(),
        ...(newStatus === "filled" ? { filledAt: Date.now() } : {}),
      });

      this.eventBus.publish(
        newStatus === "filled" ? DomainEvents.ORDER_FILLED : DomainEvents.ORDER_PARTIALLY_FILLED,
        { order: { ...order, filledQuantity: newFilled, status: newStatus }, fill }
      );
    }

    this.eventBus.publish(DomainEvents.FILL_RECEIVED, fill);
  }

  async recalcPosition(
    accountId: string,
    symbol: string,
    exchange: string,
    markPrice: number,
    contractMultiplier = 1
  ): Promise<void> {
    const fills = await this.fillStore.findBySymbol(symbol);
    const position = PositionAggregator.fromFills(
      symbol, exchange as any, fills, markPrice, contractMultiplier
    );

    if (position) {
      await this.portfolioStore.savePosition(position);
    } else {
      await this.portfolioStore.removePosition(symbol, accountId);
    }

    this.eventBus.publish(DomainEvents.POSITION_UPDATED, { symbol, exchange, position });
  }

  async recalcPortfolio(
    accountId: string,
    exchange: string,
    cashBalance: number
  ): Promise<void> {
    const positions = await this.portfolioStore.getPositions(accountId);
    const allFills = await this.fillStore.findAll();
    const totalFees = allFills.reduce((s, f) => s + f.fee, 0);
    const totalRealizedPnl = 0; // would be derived from closed positions in a full implementation

    const portfolio = PortfolioAggregator.fromPositions(
      accountId, exchange as any, cashBalance, positions, totalFees, totalRealizedPnl
    );

    await this.portfolioStore.savePortfolio(portfolio);
    this.eventBus.publish(DomainEvents.PORTFOLIO_UPDATED, portfolio);
  }
}
