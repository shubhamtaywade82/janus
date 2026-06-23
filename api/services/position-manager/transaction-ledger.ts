// ─── Position Transaction Ledger ─────────────────────────────────────────────
// Records every material change to a position as an immutable row.
// Used for audit trails, tax reporting, PnL attribution, and cost-basis tracking.

import { getDb } from "../../queries/connection";
import { positionTransactions } from "@db/position-manager-schema";

export type TransactionType =
  | "OPEN"
  | "SCALE_IN"
  | "PARTIAL_EXIT"
  | "FULL_EXIT"
  | "SL_UPDATE"
  | "TP_UPDATE"
  | "LIQUIDATED";

interface RecordTxInput {
  positionId: number;
  userId: number;
  symbol: string;
  type: TransactionType;
  side: "long" | "short";
  quantityBefore?: number;
  quantityAfter?: number;
  quantityDelta?: number;
  price?: number;
  avgEntryPrice?: number;
  realizedPnl?: number;
  fee?: number;
  marginBefore?: number;
  marginAfter?: number;
  metadata?: Record<string, unknown>;
  // ─── PTA extensions ──────────────────────────────────────────────────────
  orderId?: number;
  liquiditySide?: "MAKER" | "TAKER";
  fillModel?: string;
  simulatedSlippageBps?: number;
  fillLatencyMs?: number;
}

/**
 * Records a position transaction to the immutable ledger.
 * Best-effort: failures are logged but never throw.
 */
export async function recordPositionTransaction(input: RecordTxInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(positionTransactions).values({
      positionId: input.positionId,
      userId: input.userId,
      symbol: input.symbol,
      type: input.type,
      side: input.side,
      quantityBefore: input.quantityBefore !== undefined ? String(input.quantityBefore) : undefined,
      quantityAfter: input.quantityAfter !== undefined ? String(input.quantityAfter) : undefined,
      quantityDelta: input.quantityDelta !== undefined ? String(input.quantityDelta) : undefined,
      price: input.price !== undefined ? String(input.price) : undefined,
      avgEntryPrice: input.avgEntryPrice !== undefined ? String(input.avgEntryPrice) : undefined,
      realizedPnl: input.realizedPnl !== undefined ? String(input.realizedPnl) : undefined,
      fee: input.fee !== undefined ? String(input.fee) : undefined,
      marginBefore: input.marginBefore !== undefined ? String(input.marginBefore) : undefined,
      marginAfter: input.marginAfter !== undefined ? String(input.marginAfter) : undefined,
      metadata: input.metadata ?? {},
      // ─── PTA extensions ──────────────────────────────────────────────────────
      orderId: input.orderId,
      liquiditySide: input.liquiditySide,
      fillModel: input.fillModel,
      simulatedSlippageBps: input.simulatedSlippageBps !== undefined ? String(input.simulatedSlippageBps) : undefined,
      fillLatencyMs: input.fillLatencyMs,
    });
  } catch (err) {
    console.error(
      `[transaction-ledger] Failed to record ${input.type} for position ${input.positionId}:`,
      err
    );
  }
}

/**
 * Estimates trading fee for CoinDCX futures.
 * Maker: 0.02%, Taker (market): 0.04%
 * Paper mode uses the same estimate.
 */
export function estimateFee(notionalValue: number, isMaker = false): number {
  const rate = isMaker ? 0.0002 : 0.0004;
  return notionalValue * rate;
}
