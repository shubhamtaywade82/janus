import type { ManagedPosition, PositionLifecycleState, PositionSide } from "./types";
import { positionManagerBus } from "./event-bus";

// ─── In-Memory Hot Position Store ───────────────────────────────────────────
// Avoids DB reads on every assessment cycle.
// Source of truth for the position manager; DB is persistence only.

class PositionStore {
  private store = new Map<number, ManagedPosition>();

  upsert(position: ManagedPosition): void {
    const existing = this.store.get(position.id);
    const isNew = !existing;
    const pos = { ...position, updatedAt: new Date() };
    this.store.set(position.id, pos);

    if (isNew && position.openedAlertSent !== true) {
      positionManagerBus.emit("position:discovered", pos);
    } else {
      positionManagerBus.emit("position:synced", pos);
    }
  }

  get(id: number): ManagedPosition | undefined {
    return this.store.get(id);
  }

  getAll(): ManagedPosition[] {
    return Array.from(this.store.values());
  }

  getOpen(): ManagedPosition[] {
    return this.getAll().filter(
      (p) => p.lifecycleState !== "CLOSED" && p.lifecycleState !== "EXITING"
    );
  }

  getBySymbol(binanceSymbol: string): ManagedPosition[] {
    return this.getAll().filter((p) => p.binanceSymbol === binanceSymbol);
  }

  updatePrice(id: number, markPrice: number): void {
    const pos = this.store.get(id);
    if (!pos) return;
    const pnlMultiplier = pos.side === "LONG" ? 1 : -1;
    const unrealizedPnl =
      pnlMultiplier * (markPrice - pos.entryPrice) * pos.quantity;
    const roe =
      pos.margin > 0 ? (unrealizedPnl / pos.margin) * 100 : 0;
    this.store.set(id, { ...pos, markPrice, unrealizedPnl, roe, updatedAt: new Date() });
  }

  updateLifecycleState(id: number, state: PositionLifecycleState): void {
    const pos = this.store.get(id);
    if (!pos || pos.lifecycleState === state) return;
    const prev = pos.lifecycleState;
    this.store.set(id, { ...pos, lifecycleState: state, updatedAt: new Date() });
    positionManagerBus.emit("position:lifecycle-changed", id, prev, state);
  }

  updateQuantity(
    id: number,
    quantity: number,
    margin: number,
    entryPrice?: number,
    realizedPnl?: number
  ): void {
    const pos = this.store.get(id);
    if (!pos) return;
    const pnlMultiplier = pos.side === "LONG" ? 1 : -1;
    const entry = entryPrice ?? pos.entryPrice;
    const unrealizedPnl = pnlMultiplier * (pos.markPrice - entry) * quantity;
    const roe = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
    this.store.set(id, {
      ...pos,
      quantity,
      margin,
      entryPrice: entry,
      unrealizedPnl,
      roe,
      realizedPnl: realizedPnl ?? pos.realizedPnl,
      updatedAt: new Date(),
    });
  }

  updateProtection(id: number, stopLoss: number | null, takeProfit: number | null): void {
    const pos = this.store.get(id);
    if (!pos) return;
    const slDistancePct = stopLoss
      ? Math.abs(pos.entryPrice - stopLoss) / pos.entryPrice
      : null;
    const riskRewardRatio =
      stopLoss && takeProfit
        ? Math.abs(takeProfit - pos.entryPrice) /
          Math.abs(pos.entryPrice - stopLoss)
        : null;
    this.store.set(id, {
      ...pos,
      stopLoss,
      takeProfit,
      slDistancePct,
      riskRewardRatio,
      updatedAt: new Date(),
    });
  }

  updateExtremePrice(id: number, extremePrice: number | null): void {
    const pos = this.store.get(id);
    if (!pos) return;
    this.store.set(id, { ...pos, extremePrice, updatedAt: new Date() });
  }

  updateLastMarkPrice(id: number, lastMarkPrice: number | null): void {
    const pos = this.store.get(id);
    if (!pos) return;
    this.store.set(id, { ...pos, lastMarkPrice, updatedAt: new Date() });
  }

  remove(id: number): void {
    this.store.delete(id);
  }

  size(): number {
    return this.store.size;
  }

  // Total unrealized PnL across open positions in given mode
  totalUnrealizedPnl(isPaper?: boolean): number {
    return this.getOpen()
      .filter((p) => (isPaper === undefined ? true : p.isPaper === isPaper))
      .reduce((sum, p) => sum + p.unrealizedPnl, 0);
  }

  // Total margin locked by open positions in given mode
  totalMarginUsed(isPaper?: boolean): number {
    return this.getOpen()
      .filter((p) => (isPaper === undefined ? true : p.isPaper === isPaper))
      .reduce((sum, p) => sum + p.margin, 0);
  }

  // Correlation check: how many positions on the same side (broad market exposure)
  sameSideCount(side: PositionSide): number {
    return this.getOpen().filter((p) => p.side === side).length;
  }
}

// Singleton on globalThis to survive Vite HMR
const key = "__positionStore__" as const;
if (!(globalThis as Record<string, unknown>)[key]) {
  (globalThis as Record<string, unknown>)[key] = new PositionStore();
}
export const positionStore: PositionStore = (
  globalThis as Record<string, unknown>
)[key] as PositionStore;
