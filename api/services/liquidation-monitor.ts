/**
 * Liquidation Proximity Monitor
 *
 * Runs every 10 seconds. For each open live position with a known
 * liquidationPrice, checks how close the current mark price is to
 * the liquidation level. Logs critical/warning events and emits internal events
 * for auto-reduce handling. Telegram is intentionally not used here.
 *
 * Monitors live positions regardless of PLACE_ORDERS — alerts fire even in monitor-only mode.
 */

import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { positions, exchangeCredentials } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { marketStateManager } from "./market-state";
import { markPriceCache } from "./coindcx-ws";
import { createFuturesOrder } from "./coindcx";
import { decryptCreds } from "../lib/crypto";

export const liquidationMonitorEvents = new EventEmitter();

// Cooldown per position: once alerted at 5%, don't re-alert for 5 min.
// At 2% it fires every cycle (auto-reduce path).
const alertCooldown = new Map<number, number>();
const ALERT_COOLDOWN_MS = 5 * 60_000;

let monitorInterval: ReturnType<typeof setInterval> | null = null;

// Track positions already auto-reduced to prevent duplicate orders
const autoReducedPositions = new Set<number>();

async function checkPositions(): Promise<void> {
  const db = getDb();
  const openPositions = await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "open"), eq(positions.isPaper, false)))
    .catch(() => []);

  for (const pos of openPositions) {
    if (!pos.liquidationPrice) continue;

    const liqPrice = parseFloat(String(pos.liquidationPrice));
    if (!liqPrice || liqPrice <= 0) continue;

    let markPrice = markPriceCache.get(pos.symbol) ?? 0;
    if (markPrice <= 0) {
      markPrice = markPriceCache.get(`B-${pos.symbol.replace("USDT", "_USDT")}`) ?? 0;
    }
    if (markPrice <= 0) {
      markPrice = marketStateManager.get(pos.symbol)?.ltp ?? 0;
    }

    if (!markPrice || markPrice <= 0) continue;

    const distance = Math.abs(markPrice - liqPrice) / markPrice;

    if (distance <= 0.02) {
      console.error(
        `[liq-monitor] CRITICAL: pos ${pos.id} ${pos.symbol} ${pos.side} ` +
          `mark=${markPrice} liq=${liqPrice} distance=${(distance * 100).toFixed(2)}%`,
      );
      liquidationMonitorEvents.emit("critical", {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        markPrice,
        liqPrice,
        distancePct: distance * 100,
      });

      // Auto-reduce: place 50% market reduce order if not already reduced
      if (!autoReducedPositions.has(pos.id)) {
        try {
          const dbCreds = await db
            .select()
            .from(exchangeCredentials)
            .where(and(eq(exchangeCredentials.userId, pos.userId), eq(exchangeCredentials.exchange, "coindcx")))
            .limit(1);
          if (!dbCreds || dbCreds.length === 0) {
            console.warn(`[liq-monitor] No credentials for user ${pos.userId}, skipping auto-reduce`);
            continue;
          }
          const creds = decryptCreds(dbCreds[0]);
          const reduceSide = pos.side === "long" ? "sell" : "buy";
          const reduceQty = parseFloat(String(pos.size)) * 0.5;
          const coindcxSymbol = pos.symbol.startsWith("B-") ? pos.symbol : `B-${pos.symbol.replace("USDT", "_USDT")}`;

          await createFuturesOrder(creds, {
            market: coindcxSymbol,
            side: reduceSide,
            order_type: "market",
            total_quantity: reduceQty,
            price: markPrice,
            leverage: pos.leverage,
          });
          autoReducedPositions.add(pos.id);
          console.log(`[liq-monitor] Auto-reduced pos ${pos.id} ${pos.symbol}: 50% market ${reduceSide} @ ${markPrice}`);
          liquidationMonitorEvents.emit("auto-reduced", {
            positionId: pos.id,
            symbol: pos.symbol,
            side: pos.side,
            reduceQty,
            markPrice,
          });
        } catch (err: any) {
          console.error(`[liq-monitor] Auto-reduce failed for pos ${pos.id}:`, err.message || err);
        }
      }
    } else if (distance <= 0.05) {
      const lastAlert = alertCooldown.get(pos.id) ?? 0;
      if (Date.now() - lastAlert < ALERT_COOLDOWN_MS) continue;
      alertCooldown.set(pos.id, Date.now());

      console.warn(
        `[liq-monitor] WARNING: pos ${pos.id} ${pos.symbol} ${pos.side} ` +
          `mark=${markPrice} liq=${liqPrice} distance=${(distance * 100).toFixed(2)}%`,
      );
      liquidationMonitorEvents.emit("warning", {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        markPrice,
        liqPrice,
        distancePct: distance * 100,
      });
    } else {
      alertCooldown.delete(pos.id);
      autoReducedPositions.delete(pos.id);
    }
  }
}

export function startLiquidationMonitor(intervalMs = 10_000): void {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => {
    checkPositions().catch((err) => console.error("[liq-monitor] Check failed:", err));
  }, intervalMs);
  console.log(`[liq-monitor] Started (interval=${intervalMs}ms)`);
}

export function stopLiquidationMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[liq-monitor] Stopped");
  }
}
