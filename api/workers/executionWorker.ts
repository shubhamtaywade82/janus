import { Worker } from "bullmq";
import Redis from "ioredis";
import { getDb } from "../queries/connection";
import { orders, positions, autoExecutorConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { WalletLedgerService } from "../services/WalletLedgerService";
import {
  recordPositionTransaction,
  estimateFee,
} from "../services/position-manager/transaction-ledger";
import { registerPositionForTrailing } from "../services/trailing-stop";

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
          await tx
            .update(orders)
            .set({
              status: "FILLED",
              filledQuantity: order.quantity,
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));

          const mappedSide = order.side.toLowerCase() === "buy" ? "long" : "short";

          const qty = new Decimal(order.quantity);
          const price = new Decimal(executionPrice);
          const leverage = new Decimal(order.leverage);
          const notional = qty.mul(price);
          const margin = notional.div(leverage);

          // Fetch user executor config to get the paper currency if it's paper mode
          const [config] = await tx
            .select()
            .from(autoExecutorConfig)
            .where(eq(autoExecutorConfig.userId, order.userId))
            .limit(1);

          const currency = config?.paperCurrency ?? "INR";
          const isPaper = true; // simulated engine matching is for paper trading

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
              margin: margin.toFixed(8),
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
          const feeVal = estimateFee(notional.toNumber());
          await WalletLedgerService.chargeFee(
            order.userId,
            "paper",
            currency,
            feeVal.toFixed(8),
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
            fee: feeVal,
            marginBefore: 0,
            marginAfter: margin.toNumber(),
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
