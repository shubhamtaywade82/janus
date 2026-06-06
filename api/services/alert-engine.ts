/**
 * AlertEngine — backend source of truth for all user-defined and system-level alerts.
 *
 * Headless operation: runs independently of any browser connection.
 * Hardening:
 *   - Price rules check the LTP ring buffer high/low (not just snapshot) to catch spikes
 *   - Webhook failures are logged to alert_delivery_failures table
 *   - Global 10s per-symbol:type cooldown prevents alert storms
 *   - All subscriptions require auth (enforced in alerts-router.ts)
 */

import { EventEmitter } from "events";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userAlertRules, userAlertLogs, systemAlertLogs, alertDeliveryFailures } from "@db/schema";
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

// Per-rule cooldown: ruleId → lastTriggerMs
const ruleCooldownMap = new Map<number, number>();

// Global storm protection: "symbol:type" → lastTriggerMs (10s window)
const stormCooldownMap = new Map<string, number>();
const STORM_COOLDOWN_MS = 10_000;

// System alert dedup within the same polling window: "symbol:type" → lastEmitMs
const systemAlertDedup = new Map<string, number>();
const SYSTEM_DEDUP_MS = 5_000;

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

  // ─── Storm cooldown check ──────────────────────────────────────────────────

  private isStormCooled(symbol: string, type: string): boolean {
    const key = `${symbol}:${type}`;
    const last = stormCooldownMap.get(key) ?? 0;
    return Date.now() - last < STORM_COOLDOWN_MS;
  }

  private markStormCooldown(symbol: string, type: string): void {
    stormCooldownMap.set(`${symbol}:${type}`, Date.now());
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
      // Per-rule cooldown
      const lastFired = ruleCooldownMap.get(rule.id) ?? 0;
      if (now - lastFired < rule.cooldownSeconds * 1_000) continue;

      // Global storm protection per symbol:type
      if (this.isStormCooled(rule.symbol, rule.type)) continue;

      const state = marketStateManager.get(rule.symbol);
      if (!state) continue;

      const { fired, message } = this.evaluateRule(rule, state);
      if (!fired) continue;

      ruleCooldownMap.set(rule.id, now);
      this.markStormCooldown(rule.symbol, rule.type);
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
    state: NonNullable<ReturnType<typeof marketStateManager.get>>
  ): { fired: boolean; message: string } {
    const ltp = state.ltp ?? 0;
    const metrics = state.metrics ?? {};
    const threshold = parseFloat(rule.value ?? "0");
    const op = rule.operator ?? ">";
    const sym = rule.symbol;

    const getPriceDecimals = (s: string): number => {
      const clean = s.replace("B-", "").replace("_", "");
      const map: Record<string, number> = {
        BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, BNBUSDT: 2,
        XRPUSDT: 4, ADAUSDT: 4, DOGEUSDT: 5, AVAXUSDT: 2
      };
      return map[clean] ?? 2;
    };

    switch (rule.type) {
      case "price": {
        // Check entire LTP ring buffer so we catch intra-poll spikes that reverse
        const recentPrices = state.ltpWindow.values().map((t) => t.price);
        if (recentPrices.length === 0) recentPrices.push(ltp);

        const dec = getPriceDecimals(sym);
        if (op === ">") {
          const hit = recentPrices.find((p) => p > threshold);
          if (hit)
            return { fired: true, message: `💰 ${sym} price crossed ABOVE ${threshold} (peak: ${hit.toFixed(dec)}, current: ${ltp.toFixed(dec)})` };
        } else {
          const hit = recentPrices.find((p) => p < threshold);
          if (hit)
            return { fired: true, message: `💰 ${sym} price crossed BELOW ${threshold} (trough: ${hit.toFixed(dec)}, current: ${ltp.toFixed(dec)})` };
        }
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

    await db.insert(userAlertLogs).values({
      userId: rule.userId,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      message,
      metadata: { operator: rule.operator, value: rule.value },
    });

    alertEngineEvents.emit("user-alert", {
      userId: rule.userId,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      message,
      timestamp: Date.now(),
    });

    if (rule.notifyTelegram) {
      broadcastTelegramAlert(`🔔 <b>Janus Alert: ${rule.symbol}</b>\n\n${message}`).catch(() => {});
    }

    if (rule.notifyWebhook) {
      await this.sendWebhook(rule, message);
    }
  }

  private async sendWebhook(rule: UserAlertRule, message: string, attempt = 1): Promise<void> {
    const url = rule.notifyWebhook!;
    const payload = JSON.stringify({
      symbol: rule.symbol,
      type: rule.type,
      message,
      timestamp: new Date().toISOString(),
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[alert-engine] Webhook delivery failed for rule ${rule.id} (attempt ${attempt}):`, err.message);
      const db = getDb();
      db.insert(alertDeliveryFailures)
        .values({
          ruleId: rule.id,
          url,
          payload,
          error: String(err?.message ?? err),
          retryCount: attempt - 1,
        })
        .catch(() => {});

      // Retry once after 5s for transient errors
      if (attempt === 1) {
        setTimeout(() => this.sendWebhook(rule, message, 2).catch(() => {}), 5_000);
      }
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
    // Dedup: skip if same symbol:type fired within SYSTEM_DEDUP_MS
    const dedupKey = `${symbol}:${type}`;
    const lastEmit = systemAlertDedup.get(dedupKey) ?? 0;
    if (Date.now() - lastEmit < SYSTEM_DEDUP_MS) return;
    systemAlertDedup.set(dedupKey, Date.now());

    const db = getDb();

    db.insert(systemAlertLogs)
      .values({ symbol, type, direction, interval, message, metadata })
      .catch((err) => console.error("[alert-engine] systemAlertLogs insert error:", err));

    const event: SystemAlertEvent = {
      symbol, type, direction, interval, message, metadata,
      timestamp: Date.now(),
    };

    alertEngineEvents.emit("system-alert", event);

    // Push every emitted transition to Telegram — these are the bot's source-of-truth
    // signals and may go unseen in the UI. SYSTEM_DEDUP_MS (above) already throttles
    // per symbol:type; broadcastTelegramAlert adds a global rate limit + respects the
    // user's Telegram config / enable flag.
    const dirTag = direction === "bullish" ? "🟢" : direction === "bearish" ? "🔴" : "⚪";
    broadcastTelegramAlert(`📡 ${dirTag} <b>${symbol}</b> [${type}] ${message}`).catch(() => {});
  }

  // Called from signal-router when a symbol is removed from tracking
  evictSymbol(symbol: string): void {
    for (const key of stormCooldownMap.keys()) {
      if (key.startsWith(`${symbol}:`)) stormCooldownMap.delete(key);
    }
    for (const key of systemAlertDedup.keys()) {
      if (key.startsWith(`${symbol}:`)) systemAlertDedup.delete(key);
    }
  }
}

// Singleton — survives Vite HMR via globalThis guard
const _key = "__alertEngine__";
if (!(globalThis as any)[_key]) {
  (globalThis as any)[_key] = new AlertEngine();
}
export const alertEngine: AlertEngine = (globalThis as any)[_key];
