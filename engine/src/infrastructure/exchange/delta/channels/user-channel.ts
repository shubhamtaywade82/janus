import type { DeltaWsClient } from "../delta-ws-client.js";
import { mapFill, mapPosition } from "../delta-mapper.js";
import type { Fill } from "../../../../domain/fills/fill.js";
import type { PositionSnapshot } from "../../../../application/ports/exchange-gateway.port.js";

export interface DeltaOrderEvent {
  exchangeOrderId: string;
  clientOrderId?: string;
  status: string;
  filledQty: number;
  remainingQty: number;
  symbol: string;
  ts: number;
}

/**
 * Subscribes to Delta's private user channels:
 * - orders: order state changes
 * - fills: execution reports
 * - positions: live position updates
 */
export function subscribeUserChannel(client: DeltaWsClient, callbacks: {
  onOrder?: (event: DeltaOrderEvent) => void;
  onFill?: (fill: Fill) => void;
  onPosition?: (position: PositionSnapshot) => void;
}): () => void {
  client.subscribe(["orders", "fills", "positions"]);

  const onOrder = (msg: Record<string, unknown>) => {
    callbacks.onOrder?.({
      exchangeOrderId: String(msg.id ?? ""),
      clientOrderId: msg.client_order_id ? String(msg.client_order_id) : undefined,
      status: String(msg.state ?? msg.status ?? ""),
      filledQty: parseFloat(String(msg.size ?? 0)) - parseFloat(String(msg.unfilled_size ?? 0)),
      remainingQty: parseFloat(String(msg.unfilled_size ?? 0)),
      symbol: String(msg.product_symbol ?? ""),
      ts: Date.now(),
    });
  };

  const onFill = (msg: Record<string, unknown>) => {
    callbacks.onFill?.(mapFill(msg));
  };

  const onPosition = (msg: Record<string, unknown>) => {
    callbacks.onPosition?.(mapPosition(msg));
  };

  client.on("orderUpdate", onOrder);
  client.on("fillReceived", onFill);
  client.on("positionUpdate", onPosition);

  return () => {
    client.off("orderUpdate", onOrder);
    client.off("fillReceived", onFill);
    client.off("positionUpdate", onPosition);
  };
}
