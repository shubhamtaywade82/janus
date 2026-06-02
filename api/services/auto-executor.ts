/**
 * Auto-Executor
 *
 * Wires the full pipeline:
 *   gated signal → risk engine → LLM advisor → CoinDCX order → DB record
 *
 * Lifecycle:
 *   startAutoExecutor()  — begin listening for gated signals
 *   stopAutoExecutor()   — detach listener, freeze all automation
 *
 * The executor is disabled by default (PLACE_ORDERS must be true AND
 * autoExecutorEnabled must be toggled via the bot-router).
 */

import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { exchangeCredentials, trades, systemLogs } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { signalEvents } from "../routers/signal-router";
import { globalRiskEngine, getOrCreateSession, updateSession } from "./risk-engine";
import { analyzeSignalWithLLM, getOllamaPoolStatus } from "./ollama";
import { latestRegimeCache } from "./regime-detector";
import { createFuturesOrder } from "./coindcx";
import { userBalancesCache } from "./coindcx-ws";
import { env } from "../lib/env";
import type { ConfluenceScore } from "./confluence";

// ─── Public event bus ───

export const executorEvents = new EventEmitter();
executorEvents.setMaxListeners(50);

// ─── State ───

export interface BotDecision {
  id: string;
  timestamp: number;
  symbol: string;
  direction: "long" | "short" | "neutral";
  compositeScore: number;
  riskApproved: boolean;
  riskReason?: string;
  llmApproved: boolean;
  llmConfidence: number;
  llmReason: string;
  executed: boolean;
  orderId?: string;
  skipReason?: string;
}

const MAX_DECISION_HISTORY = 100;
const decisionHistory: BotDecision[] = [];

let autoExecutorEnabled = false;
let useLLMFilter = true;

// Runtime stats
export const executorStats = {
  signalsReceived: 0,
  tradesExecuted: 0,
  tradesRejectedByRisk: 0,
  tradesRejectedByLLM: 0,
  startedAt: 0,
};

// ─── Helpers ───

function pushDecision(d: BotDecision) {
  decisionHistory.unshift(d);
  if (decisionHistory.length > MAX_DECISION_HISTORY) decisionHistory.pop();
  executorEvents.emit("decision", d);
}

async function getCredentialsForUser(userId: number) {
  const database = getDb();
  const creds = await database
    .select()
    .from(exchangeCredentials)
    .where(and(eq(exchangeCredentials.userId, userId), eq(exchangeCredentials.exchange, "coindcx")))
    .limit(1);
  return creds[0] ?? null;
}

async function logSystemEvent(
  level: "info" | "warn" | "error",
  event: string,
  message: string,
  metadata?: Record<string, any>
) {
  try {
    const database = getDb();
    await database.insert(systemLogs).values({ level, component: "auto-executor", event, message, metadata });
  } catch {
    // non-critical
  }
}

// ─── Core execution handler ───

async function handleGatedSignal(signal: ConfluenceScore, userId: number) {
  executorStats.signalsReceived++;

  const decisionId = `${Date.now()}-${signal.symbol}`;

  // Skip neutral direction
  if (signal.direction === "neutral") return;

  // Get wallet balance for risk session
  const balances = userBalancesCache.get(userId);
  const usdtWallet = balances?.find((b: any) => b.currency_short_name === "USDT" || b.balance_currency === "USDT");
  const walletBalance = parseFloat(usdtWallet?.balance ?? usdtWallet?.available_balance ?? "0");

  // Risk engine
  const session = getOrCreateSession(userId, walletBalance || 500);
  const estimatedNotional = walletBalance * 0.10; // 10% of balance as position size
  const riskDecision = globalRiskEngine.checkTradeAllowed(session, {
    notional: estimatedNotional,
    walletBalance: walletBalance || 500,
    usedMargin: 0,
  });

  if (!riskDecision.approved) {
    executorStats.tradesRejectedByRisk++;
    pushDecision({
      id: decisionId,
      timestamp: Date.now(),
      symbol: signal.symbol,
      direction: signal.direction,
      compositeScore: signal.compositeScore,
      riskApproved: false,
      riskReason: riskDecision.reason,
      llmApproved: false,
      llmConfidence: 0,
      llmReason: "",
      executed: false,
      skipReason: `Risk rejected: ${riskDecision.reason}`,
    });
    return;
  }

  // LLM advisor (optional, non-blocking)
  const regime = latestRegimeCache.get(signal.symbol.replace("B-", "").replace("_", "")) ?? null;
  let llmApproved = true;
  let llmConfidence = 75;
  let llmReason = "LLM filter disabled";

  if (useLLMFilter) {
    try {
      const advice = await analyzeSignalWithLLM(signal, regime, []);
      llmApproved   = advice.approved;
      llmConfidence = advice.confidence;
      llmReason     = advice.reasoning;

      if (!advice.approved && !advice.skipped) {
        executorStats.tradesRejectedByLLM++;
        pushDecision({
          id: decisionId,
          timestamp: Date.now(),
          symbol: signal.symbol,
          direction: signal.direction,
          compositeScore: signal.compositeScore,
          riskApproved: true,
          llmApproved: false,
          llmConfidence,
          llmReason,
          executed: false,
          skipReason: `LLM vetoed: ${llmReason}`,
        });
        return;
      }
    } catch (err: any) {
      console.error("[auto-executor] LLM call failed:", err.message);
      // Non-blocking — proceed without LLM
      llmReason = "LLM error — proceeding";
    }
  }

  // ─── Order execution ───

  if (!env.placeOrders) {
    pushDecision({
      id: decisionId,
      timestamp: Date.now(),
      symbol: signal.symbol,
      direction: signal.direction,
      compositeScore: signal.compositeScore,
      riskApproved: true,
      llmApproved,
      llmConfidence,
      llmReason,
      executed: false,
      skipReason: "PLACE_ORDERS=false — paper mode",
    });

    await logSystemEvent("info", "paper-trade", `[paper] Would execute ${signal.direction} on ${signal.symbol} — score ${signal.compositeScore}`, {
      signal: { direction: signal.direction, compositeScore: signal.compositeScore },
      llmReason,
    });

    executorStats.tradesExecuted++;
    return;
  }

  const creds = await getCredentialsForUser(userId);
  if (!creds) {
    pushDecision({
      id: decisionId, timestamp: Date.now(), symbol: signal.symbol, direction: signal.direction,
      compositeScore: signal.compositeScore, riskApproved: true, llmApproved, llmConfidence, llmReason,
      executed: false, skipReason: "No CoinDCX credentials found for user",
    });
    return;
  }

  const coindcxMarket = signal.symbol; // Already in B-ETH_USDT form from signal-router
  const side = signal.direction === "long" ? "buy" : "sell";
  const quantity = walletBalance > 0 ? Math.floor((walletBalance * 0.10) / 100) / 10 : 0.01;

  try {
    const order = await createFuturesOrder(
      { apiKey: creds.apiKey, apiSecret: creds.apiSecret },
      {
        market: coindcxMarket,
        side,
        order_type: "market",
        total_quantity: quantity,
        leverage: 5,
      }
    );

    executorStats.tradesExecuted++;

    // Record in DB
    const database = getDb();
    const updatedSession = globalRiskEngine.recordTrade(session, { pnl: 0 });
    updateSession(updatedSession);

    await database.insert(trades).values({
      userId,
      symbol: coindcxMarket,
      side: side === "buy" ? "buy" : "sell",
      orderType: "market",
      price: String(order.price ?? 0),
      size: String(quantity),
      leverage: 5,
      fee: "0",
      tdsDeducted: "0",
      total: String(quantity),
      status: "filled",
      exchangeOrderId: order.id,
      clientOrderId: order.client_order_id,
      executedAt: new Date(),
    }).catch(() => {});

    const decision: BotDecision = {
      id: decisionId,
      timestamp: Date.now(),
      symbol: signal.symbol,
      direction: signal.direction,
      compositeScore: signal.compositeScore,
      riskApproved: true,
      llmApproved,
      llmConfidence,
      llmReason,
      executed: true,
      orderId: order.id,
    };
    pushDecision(decision);

    await logSystemEvent("info", "trade-executed", `Executed ${signal.direction} ${coindcxMarket} qty=${quantity} order=${order.id}`, {
      orderId: order.id, signal: signal.symbol, direction: signal.direction, score: signal.compositeScore,
    });

    executorEvents.emit("trade-executed", decision);
  } catch (err: any) {
    console.error("[auto-executor] Order placement failed:", err.message);
    pushDecision({
      id: decisionId, timestamp: Date.now(), symbol: signal.symbol, direction: signal.direction,
      compositeScore: signal.compositeScore, riskApproved: true, llmApproved, llmConfidence, llmReason,
      executed: false, skipReason: `Order error: ${err.message}`,
    });
    await logSystemEvent("error", "order-error", err.message, { symbol: signal.symbol });
  }
}

// ─── Signal listener ───

// The signal-router emits "update" when signals are stored, but doesn't
// expose the gated signal objects directly. We add a "gated-signal" event
// that the signal-router will emit when it writes a gated signal.
// This allows auto-executor to subscribe cleanly.

const USER_ID = 1; // Bot always trades on user 1 (admin)

function onGatedSignal(signal: ConfluenceScore) {
  if (!autoExecutorEnabled) return;
  handleGatedSignal(signal, USER_ID).catch((err) => {
    console.error("[auto-executor] Unhandled error in signal handler:", err);
  });
}

// ─── Lifecycle ───

export function startAutoExecutor(opts?: { useLLM?: boolean }) {
  if (opts?.useLLM !== undefined) useLLMFilter = opts.useLLM;
  if (autoExecutorEnabled) return;

  autoExecutorEnabled = true;
  executorStats.startedAt = Date.now();
  signalEvents.on("gated-signal", onGatedSignal);

  console.log(`[auto-executor] Started — placeOrders=${env.placeOrders} llm=${useLLMFilter}`);
  logSystemEvent("info", "started", `Auto-executor started — placeOrders=${env.placeOrders} llmFilter=${useLLMFilter}`);
}

export function stopAutoExecutor() {
  if (!autoExecutorEnabled) return;
  autoExecutorEnabled = false;
  signalEvents.off("gated-signal", onGatedSignal);
  console.log("[auto-executor] Stopped");
  logSystemEvent("info", "stopped", "Auto-executor stopped");
}

// ─── Status API ───

export function getExecutorStatus() {
  return {
    enabled: autoExecutorEnabled,
    placeOrders: env.placeOrders,
    useLLMFilter,
    stats: { ...executorStats },
    recentDecisions: decisionHistory.slice(0, 20),
    ollamaPool: getOllamaPoolStatus(),
  };
}

export function setUseLLMFilter(enabled: boolean) {
  useLLMFilter = enabled;
}
