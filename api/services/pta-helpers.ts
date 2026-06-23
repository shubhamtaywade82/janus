// ─── PTA Context Helpers ────────────────────────────────────────────────────
// Derives PTA enrichment columns for signals, orders, and position_transactions
// from the available market state and execution context.

import { marketStateManager } from "./market-state";

export type SignalPtaContext = {
  session?: string;
  hoursToFunding?: number;
  binanceMarkPrice?: number;
  binanceIndexPrice?: number;
  binanceFundingRate?: number;
  binancePredictedRate?: number;
  openInterestUsd?: number;
  openInterestDelta?: number;
  volume24hUsd?: number;
  atr14?: number;
  atrPercent?: number;
  triggerDescription?: string;
  triggerMetadata?: Record<string, unknown>;
  disposition?: string;
};

export type OrderPtaContext = {
  executionMode?: "PAPER" | "LIVE" | "SHADOW";
  fillModel?: string;
  binanceMarkPriceAtSend?: number;
  orderConstructedAt?: Date;
  orderSentAt?: Date;
};

export type FillPtaContext = {
  orderId?: number;
  liquiditySide?: string;
  fillModel?: string;
  simulatedSlippageBps?: number;
  fillLatencyMs?: number;
};

/** Maps UTC hour to trading session. */
export function getTradingSession(utcHour: number): string {
  if (utcHour >= 0 && utcHour <= 7) return "ASIA";
  if (utcHour >= 8 && utcHour <= 15) return "LONDON";
  if (utcHour >= 16 && utcHour <= 23) return "US";
  return "OVERLAP";
}

/** Returns hours until next 8h funding settlement (00:00, 08:00, 16:00 UTC). */
export function hoursToNextFunding(): number {
  const now = new Date();
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const slots = [0, 8, 16];
  let next = slots.find((h) => h > utcHours);
  if (next === undefined) next = slots[0] + 24;
  return next - utcHours + (slots.includes(Math.floor(utcHours)) ? 0 : 0);
}

/** Builds PTA context from market state manager for a given symbol. */
export function buildSignalPtaContext(binanceSymbol: string): SignalPtaContext {
  const state = marketStateManager.get(binanceSymbol);
  const ctx: SignalPtaContext = {};

  if (!state) return ctx;

  const now = new Date();
  ctx.session = getTradingSession(now.getUTCHours());
  ctx.hoursToFunding = hoursToNextFunding();
  ctx.binanceMarkPrice = state.ltp;

  if (state.latestFunding) {
    ctx.binanceFundingRate = state.latestFunding.fundingRate;
  }
  if (state.latestOpenInterest) {
    ctx.openInterestUsd = state.latestOpenInterest.openInterest;
    ctx.openInterestDelta = state.latestOpenInterest.delta;
  }
  return ctx;
}
