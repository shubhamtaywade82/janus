/**
 * Key Rotation Monitor
 *
 * Periodically checks `exchange_credentials.updatedAt` and sends a Telegram
 * reminder when an active credential hasn't been rotated within ROTATION_REMINDER_DAYS.
 * Pure reminder — does not rotate keys automatically.
 *
 * Runs once per day; dedupes so each credential is reminded at most once every
 * REMINDER_DEDUPE_DAYS to avoid spamming.
 */

import { getDb } from "../queries/connection";
import { exchangeCredentials } from "@db/schema";
import { eq } from "drizzle-orm";
import { broadcastTelegramAlert } from "./telegram";

const CHECK_INTERVAL_MS = 24 * 60 * 60_000; // once per day
const ROTATION_REMINDER_DAYS = 90;
const REMINDER_DEDUPE_DAYS = 7;

// credentialId → last reminder timestamp (ms) — in-memory dedupe, resets on restart
const lastReminderMap = new Map<number, number>();

class KeyRotationMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.intervalId) return; // already running

    this.checkCredentials().catch((err) =>
      console.error("[key-rotation-monitor] Boot check failed:", err)
    );

    this.intervalId = setInterval(() => {
      this.checkCredentials().catch((err) =>
        console.error("[key-rotation-monitor] Scheduled check failed:", err)
      );
    }, CHECK_INTERVAL_MS);

    console.log("[key-rotation-monitor] Started (checking daily for credentials older than", ROTATION_REMINDER_DAYS, "days)");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[key-rotation-monitor] Stopped");
  }

  private async checkCredentials(): Promise<void> {
    const db = getDb();
    const creds = await db
      .select()
      .from(exchangeCredentials)
      .where(eq(exchangeCredentials.isActive, true));

    const now = Date.now();
    const reminderThresholdMs = ROTATION_REMINDER_DAYS * 24 * 60 * 60_000;
    const dedupeThresholdMs = REMINDER_DEDUPE_DAYS * 24 * 60 * 60_000;

    for (const cred of creds) {
      const ageMs = now - new Date(cred.updatedAt).getTime();
      if (ageMs < reminderThresholdMs) continue;

      const lastReminded = lastReminderMap.get(cred.id) ?? 0;
      if (now - lastReminded < dedupeThresholdMs) continue;

      const ageDays = Math.floor(ageMs / (24 * 60 * 60_000));
      await broadcastTelegramAlert(
        `🔑 *Key Rotation Reminder*\n\n` +
        `Your *${cred.exchange}* API credentials (id ${cred.id}) haven't been rotated in *${ageDays} days* ` +
        `(recommended: every ${ROTATION_REMINDER_DAYS} days).\n\n` +
        `Consider generating new keys on the exchange and updating them here.`
      );
      lastReminderMap.set(cred.id, now);
    }
  }
}

const _key = "__keyRotationMonitor__";
if (!(globalThis as any)[_key]) {
  (globalThis as any)[_key] = new KeyRotationMonitor();
}
export const keyRotationMonitor: KeyRotationMonitor = (globalThis as any)[_key];
