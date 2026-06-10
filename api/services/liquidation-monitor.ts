/**
 * Liquidation Proximity Monitor
 *
 * Runs every 10 seconds. For each open live position with a known
 * liquidationPrice, checks how close the current mark price is to
 * the liquidation level. Fires a Telegram alert when within 5% and
 * triggers an auto-reduce (closes 50% of position) when within 2%.
 *
 * Monitors live positions regardless of PLACE_ORDERS — alerts fire even in monitor-only mode.
 */

import { EventEmitter } from "events";
import { getDb } from "../queries/connection";
import { positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { marketStateManager } from "./market-state";
import { markPriceCache } from "./coindcx-ws";
import { broadcastTelegramAlert } from "./telegram";
import { env } from "../lib/env";

export const liquidationMonitorEvents = new EventEmitter();

// Cooldown per position: once alerted at 5%, don't re-alert for 5 min.
// At 2% it fires every cycle (auto-reduce path).
const alertCooldown = new Map<number, number>();
const ALERT_COOLDOWN_MS = 5 * 60_000;

let monitorInterval: ReturnType<typeof setInterval> | null = null;

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

    // Current price: mark price cache first (most accurate), then in-memory LTP
    let markPrice = markPriceCache.get(pos.symbol) ?? 0;
    if (markPrice <= 0) {
      markPrice = markPriceCache.get(`B-${pos.symbol.replace("USDT", "_USDT")}`) ?? 0;
    }
    if (markPrice <= 0) {
      markPrice = marketStateManager.get(pos.symbol)?.ltp ?? 0;
    }

    if (!markPrice || markPrice <= 0) continue;

    // Distance as a fraction of mark price
    const distance = Math.abs(markPrice - liqPrice) / markPrice;

    if (distance <= 0.02) {
      // CRITICAL: within 2% — fire auto-reduce event (position manager/executor handles it)
      console.error(
        `[liq-monitor] CRITICAL: pos ${pos.id} ${pos.symbol} ${pos.side} ` +
        `mark=${markPrice} liq=${liqPrice} distance=${(distance * 100).toFixed(2)}%`
      );
      liquidationMonitorEvents.emit("critical", {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        markPrice,
        liqPrice,
        distancePct: distance * 100,
      });
      await broadcastTelegramAlert(
        `🚨 <b>LIQUIDATION CRITICAL</b>\n` +
        `${pos.symbol} ${pos.side.toUpperCase()} pos #${pos.id}\n` +
        `Mark: ${markPrice.toFixed(4)} | Liq: ${liqPrice.toFixed(4)}\n` +
        `Distance: <b>${(distance * 100).toFixed(2)}%</b> — AUTO-REDUCING`
      ).catch(() => {});
    } else if (distance <= 0.05) {
      // WARNING: within 5% — alert once per cooldown window
      const lastAlert = alertCooldown.get(pos.id) ?? 0;
      if (Date.now() - lastAlert < ALERT_COOLDOWN_MS) continue;
      alertCooldown.set(pos.id, Date.now());

      console.warn(
        `[liq-monitor] WARNING: pos ${pos.id} ${pos.symbol} ${pos.side} ` +
        `mark=${markPrice} liq=${liqPrice} distance=${(distance * 100).toFixed(2)}%`
      );
      liquidationMonitorEvents.emit("warning", {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        markPrice,
        liqPrice,
        distancePct: distance * 100,
      });
      await broadcastTelegramAlert(
        `⚠️ <b>LIQUIDATION WARNING</b>\n` +
        `${pos.symbol} ${pos.side.toUpperCase()} pos #${pos.id}\n` +
        `Mark: ${markPrice.toFixed(4)} | Liq: ${liqPrice.toFixed(4)}\n` +
        `Distance: <b>${(distance * 100).toFixed(2)}%</b>`
      ).catch(() => {});
    } else {
      // Position moved away from danger — clear cooldown
      alertCooldown.delete(pos.id);
    }
  }
}

export function startLiquidationMonitor(intervalMs = 10_000): void {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => {
    checkPositions().catch((err) =>
      console.error("[liq-monitor] Check failed:", err)
    );
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
