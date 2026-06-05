/**
 * AlertEngine — backend source of truth for all user-defined and system-level alerts.
 *
 * Replaces the three UI-coupled alert subsystems:
 *   1. localStorage "janus_alert_rules" evaluated in Layout.tsx
 *   2. checkIndicatorAlerts / checkSMCAlerts in Dashboard.tsx
 *   3. checkKnnAlerts in Signals.tsx
 *
 * Runs headlessly — no browser connection required.
 */

import { EventEmitter } from "events";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userAlertRules, userAlertLogs, systemAlertLogs } from "@db/schema";
import { marketStateManager } from "./market-state";
import { broadcastTelegramAlert } from "./telegram";
import type { UserAlertRule } from "@db/schema";

export interface SystemAlertEvent {
  symbol: string;
  type: string;
  direction: string | null;
  interval: string | null;
  message: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export const alertEngineEvents = new EventEmitter();
alertEngineEvents.setMaxListeners(50);

// Cooldown map: ruleId → lastTriggerMs
const cooldownMap = new Map<number, number>();

class AlertEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  start(pollIntervalMs = 5_000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.evaluateUserRules().catch((err) =>
        console.error("[alert-engine] evaluateUserRules error:", err)
      );
    }, pollIntervalMs);
    console.log("[alert-engine] Started (poll interval:", pollIntervalMs, "ms)");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[alert-engine] Stopped");
  }

  // ─── User-defined rule evaluation ─────────────────────────────────────────

  private async evaluateUserRules(): Promise<void> {
    const db = getDb();
    const activeRules = await db
      .select()
      .from(userAlertRules)
      .where(eq(userAlertRules.isActive, true));

    if (activeRules.length === 0) return;

    const now = Date.now();
    const triggered: Array<{ rule: UserAlertRule; message: string }> = [];

    for (const rule of activeRules) {
      const lastFired = cooldownMap.get(rule.id) ?? 0;
      if (now - lastFired < rule.cooldownSeconds * 1_000) continue;

      const state = marketStateManager.get(rule.symbol);
      if (!state) continue;

      const { fired, message } = this.evaluateRule(rule, state);
      if (!fired) continue;

      cooldownMap.set(rule.id, now);
      triggered.push({ rule, message });
    }

    for (const { rule, message } of triggered) {
      await this.dispatchUserAlert(rule, message).catch((err) =>
        console.error("[alert-engine] dispatchUserAlert error:", err)
      );
    }
  }

  private evaluateRule(
    rule: UserAlertRule,
    state: ReturnType<typeof marketStateManager.get> & object
  ): { fired: boolean; message: string } {
    const ltp = state.ltp ?? 0;
    const metrics = state.metrics ?? {};
    const threshold = parseFloat(rule.value ?? "0");
    const op = rule.operator ?? ">";
    const sym = rule.symbol;

    switch (rule.type) {
      case "price": {
        if (op === ">" && ltp > threshold)
          return { fired: true, message: `💰 ${sym} price crossed ABOVE ${threshold} (current: ${ltp.toFixed(2)})` };
        if (op === "<" && ltp < threshold)
          return { fired: true, message: `💰 ${sym} price crossed BELOW ${threshold} (current: ${ltp.toFixed(2)})` };
        break;
      }
      case "sweep": {
        const sweep = (metrics as any).sweepScore ?? 0;
        if (sweep > threshold)
          return { fired: true, message: `🌊 ${sym} sweep intensity ${sweep.toFixed(0)} crossed above ${threshold}` };
        break;
      }
      case "absorption": {
        const absorb = (metrics as any).absorptionScore ?? 0;
        if (absorb > threshold)
          return { fired: true, message: `🧱 ${sym} wall absorption ${absorb.toFixed(0)} crossed above ${threshold}` };
        break;
      }
      case "imbalance": {
        const imbalance = (metrics as any).bidAskImbalance ?? 0;
        if (op === ">" && imbalance > threshold)
          return { fired: true, message: `⚖️ ${sym} OFI imbalance +${imbalance.toFixed(2)} above ${threshold}` };
        if (op === "<" && imbalance < threshold)
          return { fired: true, message: `⚖️ ${sym} OFI imbalance ${imbalance.toFixed(2)} below ${threshold}` };
        break;
      }
      case "volatility": {
        if ((metrics as any).volatilityRegime === "HIGH")
          return { fired: true, message: `⚡ ${sym} volatility regime shifted to HIGH` };
        break;
      }
    }

    return { fired: false, message: "" };
  }

  private async dispatchUserAlert(rule: UserAlertRule, message: string): Promise<void> {
    const db = getDb();

    // Persist to DB
    await db.insert(userAlertLogs).values({
      userId: rule.userId,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      message,
      metadata: { operator: rule.operator, value: rule.value },
    });

    // Push real-time event to any subscribed UI clients
    alertEngineEvents.emit("user-alert", {
      userId: rule.userId,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      message,
      timestamp: Date.now(),
    });

    // Send Telegram via existing broadcastTelegramAlert (reads credentials from DB)
    if (rule.notifyTelegram) {
      await broadcastTelegramAlert(`🔔 <b>Janus Alert: ${rule.symbol}</b>\n\n${message}`).catch(
        () => {}
      );
    }

    // Send Webhook
    if (rule.notifyWebhook) {
      fetch(rule.notifyWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: rule.symbol, type: rule.type, message, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
  }

  // ─── System-level alert emission (called from signal-router) ──────────────

  async emitSystemAlert(
    symbol: string,
    type: string,
    direction: string | null,
    interval: string | null,
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const db = getDb();

    // Persist to DB (best-effort, non-blocking)
    db.insert(systemAlertLogs)
      .values({ symbol, type, direction, interval, message, metadata })
      .catch((err) => console.error("[alert-engine] systemAlertLogs insert error:", err));

    const event: SystemAlertEvent = {
      symbol,
      type,
      direction,
      interval,
      message,
      metadata,
      timestamp: Date.now(),
    };

    // Broadcast to subscribed UI clients
    alertEngineEvents.emit("system-alert", event);

    // Send Telegram for high-signal events
    const highSignalTypes = new Set([
      "bos", "choch", "knn_bias_flip", "supertrend_flip",
      "direction_flip", "gated_flip", "knn_rejection",
    ]);
    if (highSignalTypes.has(type)) {
      broadcastTelegramAlert(`📡 <b>${symbol}</b> ${message}`).catch(() => {});
    }
  }
}

// Singleton — survives Vite HMR via globalThis guard
const _key = "__alertEngine__";
if (!(globalThis as any)[_key]) {
  (globalThis as any)[_key] = new AlertEngine();
}
export const alertEngine: AlertEngine = (globalThis as any)[_key];
