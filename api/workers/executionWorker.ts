import { Worker } from "bullmq";
import Redis from "ioredis";
import { getDb } from "../queries/connection";
import { orders, positions, autoExecutorConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { systemEvents } from "@db/pta-schema";
import { WalletLedgerService } from "../services/WalletLedgerService";
import {
  recordPositionTransaction,
  estimateFee,
} from "../services/position-manager/transaction-ledger";
import { registerPositionForTrailing } from "../services/trailing-stop";
import { usdtToWallet } from "../services/paper-currency";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const executionWorker = new Worker(
  "EngineExecution",
  async (job) => {
    if (job.name === "ExecuteMatch") {
      const { clientOrderId, executionPrice } = job.data;
      const db = getDb();

      console.log(
        `[executionWorker] Processing ExecuteMatch for ${clientOrderId} at price ${executionPrice}`
      );

      try {
        await db.transaction(async (tx) => {
          // Find and lock the order record
          const [order] = await tx
            .select()
            .from(orders)
            .where(eq(orders.clientOrderId, clientOrderId))
            .for("update");

          if (!order) {
            console.warn(`[executionWorker] Order not found: ${clientOrderId}`);
            return;
          }

          if (order.status !== "OPEN" && order.status !== "PENDING") {
            console.log(
              `[executionWorker] Order ${clientOrderId} already in status: ${order.status}`
            );
            return;
          }

          // Update order status to FILLED
          const now = new Date();
          await tx
            .update(orders)
            .set({
              status: "FILLED",
              filledQuantity: order.quantity,
              updatedAt: now,
              // ─── PTA fill attribution ────────────────────────────────────────
              executionMode: "PAPER",
              fillModel: "ORDERBOOK_WALK",
              simulatedSlippageBps: "5",
              orderSentAt: order.orderSentAt ?? now,
              orderAckedAt: order.orderAckedAt ?? now,
            })
            .where(eq(orders.id, order.id));

          const mappedSide = order.side.toLowerCase() === "buy" ? "long" : "short";

          const qty = new Decimal(order.quantity);
          const SLIPPAGE_BPS = 5;
          const isBuy = order.side.toLowerCase() === "buy";
          const slippageMultiplier = new Decimal(1).add(new Decimal(isBuy ? 1 : -1).mul(SLIPPAGE_BPS).div(10000));
          const price = new Decimal(executionPrice).mul(slippageMultiplier);
          const leverage = new Decimal(order.leverage);
          const notional = qty.mul(price);
          const marginUsdt = notional.div(leverage);

          // Fetch user executor config to get the paper currency if it's paper mode
          const [config] = await tx
            .select()
            .from(autoExecutorConfig)
            .where(eq(autoExecutorConfig.userId, order.userId))
            .limit(1);

          const currency = config?.paperCurrency ?? "INR";
          const isPaper = true; // simulated engine matching is for paper trading

          const marginUsdtNum = marginUsdt.toNumber();
          const marginStored =
            currency === "INR"
              ? await usdtToWallet(marginUsdtNum, "INR")
              : marginUsdtNum;
          const feeUsdt = estimateFee(notional.toNumber());
          const feeStored =
            currency === "INR" ? await usdtToWallet(feeUsdt, "INR") : feeUsdt;

          // Create the open position record
          const [position] = await tx
            .insert(positions)
            .values({
              userId: order.userId,
              symbol: order.symbol,
              side: mappedSide,
              entryPrice: price.toFixed(8),
              currentPrice: price.toFixed(8),
              size: qty.toFixed(8),
              leverage: order.leverage,
              margin: marginStored.toFixed(8),
              marginCurrency: currency,
              stopLoss: order.stopLoss ? String(order.stopLoss) : null,
              takeProfit: order.takeProfit ? String(order.takeProfit) : null,
              unrealizedPnl: "0.00000000",
              realizedPnl: "0.00000000",
              status: "open",
              exchangeOrderId: order.clientOrderId,
              isPaper: isPaper,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          // Settle transaction ledger
          await WalletLedgerService.chargeFee(
            order.userId,
            "paper",
            currency,
            feeStored.toFixed(8),
            position.id
          );

          await recordPositionTransaction({
            positionId: position.id,
            userId: order.userId,
            symbol: order.symbol,
            type: "OPEN",
            side: mappedSide,
            quantityBefore: 0,
            quantityAfter: qty.toNumber(),
            quantityDelta: qty.toNumber(),
            price: price.toNumber(),
            avgEntryPrice: price.toNumber(),
            realizedPnl: 0,
            fee: feeUsdt,
            marginBefore: 0,
            marginAfter: marginUsdtNum,
            executionMode: "PAPER",
            liquiditySide: "TAKER",
            fillModel: "ORDERBOOK_WALK",
            simulatedSlippageBps: 0,
            fillLatencyMs: 0,
            metadata: {
              isPaper,
              leverage: order.leverage,
              stopLoss: order.stopLoss,
            },
          });

          // Register for trailing stop loss
          if (order.stopLoss) {
            registerPositionForTrailing({
              id: position.id,
              symbol: order.symbol,
              side: mappedSide,
              entryPrice: price.toNumber(),
              stopLoss: parseFloat(order.stopLoss),
              strategyType: "intraday",
              userId: order.userId,
              size: qty.toNumber(),
            });
          }

          await tx.insert(systemEvents).values({
            component: "execution-worker",
            eventType: "execute_match",
            severity: "INFO",
            symbol: order.symbol,
            message: `Simulated fill for order ${clientOrderId} -> position ${position.id}`,
            metadata: {
              executionMode: "PAPER",
              fillModel: "ORDERBOOK_WALK",
              executionPrice,
              clientOrderId,
              positionId: position.id,
            },
          });

          console.log(
            `[executionWorker] Successfully filled order ${clientOrderId} and opened position ${position.id}`
          );
        });
      } catch (err) {
        console.error(
          `[executionWorker] Failed transaction for order ${clientOrderId}:`,
          err
        );
        throw err;
      }
    }
  },
  { connection: connection as any }
);

executionWorker.on("completed", (job) => {
  console.log(`[executionWorker] Job ${job.id} completed successfully`);
});

executionWorker.on("failed", (job, err) => {
  console.error(`[executionWorker] Job ${job?.id} failed:`, err);
});
