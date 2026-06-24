import { EventEmitter } from "events";

export type KillReason = "manual" | "drawdown" | "feed_failure" | "api_error" | "margin_breach";

export interface KillState {
  type: KillReason;
  reason: string;
  triggeredAt: number;
}

export const killSwitchEvents = new EventEmitter();
killSwitchEvents.setMaxListeners(20);

import * as fs from "fs";
import * as path from "path";
import { getDb } from "../queries/connection";
import { killSwitchState } from "@db/schema";

const STATE_FILE = path.resolve(process.cwd(), "kill-switch-state.json");
const DEFAULT_AUTO_RESET_MS = 60 * 60 * 1000;

function getAutoResetMs(): number {
  const raw = process.env.KILL_SWITCH_AUTO_RESET_MS;
  if (raw === "0") return 0;
  const parsed = parseInt(raw ?? String(DEFAULT_AUTO_RESET_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTO_RESET_MS;
}

export class KillSwitch {
  state: KillState | null = null;
  private _autoResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this._loadFromFile();
    this._applyAutoResetPolicy();
  }

  private _loadFromFile() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, "utf-8");
        const loaded = JSON.parse(data) as KillState | null;
        // Shutdown triggers are restart artifacts — the previous process tripped
        // the switch on SIGINT/SIGTERM purely to halt in-flight trading while
        // exiting. They must NOT block trading on the next boot. Only real safety
        // halts (drawdown, margin_breach, feed_failure, api_error, operator manual)
        // should persist across a restart.
        if (loaded && loaded.reason?.startsWith("shutdown_")) {
          console.log(`[kill-switch] Ignoring persisted shutdown artifact (reason="${loaded.reason}") — clearing.`);
          this.state = null;
          this._saveToFile();
        } else if (loaded) {
          this.state = loaded;
          console.log(`[kill-switch] Loaded file state: type=${this.state.type} reason="${this.state.reason}"`);
        }
      }
    } catch (err) {
      console.error("[kill-switch] Failed to load file state:", err);
    }
  }

  // Called at startup after DB is ready. Overrides file state with DB state (more reliable).
  async initFromDb(): Promise<void> {
    try {
      const db = getDb();
      const rows = await db.select().from(killSwitchState).limit(1);
      const row = rows[0];
      if (!row) return;

      if (!row.isActive) {
        // DB says inactive — clear any file-loaded state
        if (this.state && !this.state.reason.startsWith("shutdown_")) {
          console.log(`[kill-switch] DB overrides file — state cleared`);
        }
        this.state = null;
        this._clearAutoResetTimer();
        return;
      }

      // DB has active kill switch
      if (row.reason?.startsWith("shutdown_")) {
        // Shutdown artifact in DB — clear it
        this.state = null;
        this._clearAutoResetTimer();
        this._persistToDb().catch(() => {});
        return;
      }

      const dbState: KillState = {
        type: row.type as KillReason,
        reason: row.reason ?? "unknown",
        triggeredAt: row.triggeredAt ? parseFloat(row.triggeredAt) : Date.now(),
      };

      if (!this.state) {
        // Not loaded from file — restore from DB
        this.state = dbState;
        console.log(`[kill-switch] Restored from DB: type=${dbState.type} reason="${dbState.reason}"`);
      }

      this._applyAutoResetPolicy();
    } catch (err) {
      console.error("[kill-switch] Failed to load DB state:", err);
    }
  }

  private _clearAutoResetTimer(): void {
    if (this._autoResetTimer) {
      clearTimeout(this._autoResetTimer);
      this._autoResetTimer = null;
    }
  }

  private _applyAutoResetPolicy(): void {
    this._clearAutoResetTimer();

    const autoResetMs = getAutoResetMs();
    if (autoResetMs <= 0 || !this.state) return;

    const elapsed = Date.now() - this.state.triggeredAt;
    const remaining = autoResetMs - elapsed;

    if (remaining <= 0) {
      console.log(`[kill-switch] AUTO-RESET — ${Math.round(autoResetMs / 60_000)}min TTL elapsed`);
      this.reset();
      return;
    }

    this._autoResetTimer = setTimeout(() => {
      this._autoResetTimer = null;
      if (!this.isActive) return;
      console.log(
        `[kill-switch] AUTO-RESET — ${Math.round(autoResetMs / 60_000)}min TTL elapsed (was: ${this.state?.reason ?? "unknown"})`
      );
      this.reset();
    }, remaining);
  }

  /** Epoch ms when the active kill switch auto-resets, or null if inactive/disabled. */
  getAutoResetAt(): number | null {
    const autoResetMs = getAutoResetMs();
    if (autoResetMs <= 0 || !this.state) return null;
    return this.state.triggeredAt + autoResetMs;
  }

  private _saveToFile() {
    try {
      if (this.state) {
        const tmpFile = STATE_FILE + ".tmp";
        fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), "utf-8");
        fs.renameSync(tmpFile, STATE_FILE); // atomic on same filesystem
      } else {
        if (fs.existsSync(STATE_FILE)) {
          fs.unlinkSync(STATE_FILE);
        }
        const tmpFile = STATE_FILE + ".tmp";
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    } catch (err) {
      console.error("[kill-switch] Failed to save file state:", err);
    }
  }

  private async _persistToDb(): Promise<void> {
    try {
      const db = getDb();
      if (this.state) {
        await db
          .insert(killSwitchState)
          .values({
            key: "global",
            isActive: true,
            type: this.state.type,
            reason: this.state.reason,
            triggeredAt: String(this.state.triggeredAt),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: killSwitchState.key,
            set: {
              isActive: true,
              type: this.state.type,
              reason: this.state.reason,
              triggeredAt: String(this.state.triggeredAt),
              updatedAt: new Date(),
            },
          });
      } else {
        await db
          .insert(killSwitchState)
          .values({
            key: "global",
            isActive: false,
            type: null,
            reason: null,
            triggeredAt: null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: killSwitchState.key,
            set: {
              isActive: false,
              type: null,
              reason: null,
              triggeredAt: null,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err) {
      console.error("[kill-switch] Failed to persist to DB:", err);
    }
  }

  get isActive(): boolean {
    return this.state !== null;
  }

  canTrade(): boolean {
    return !this.isActive;
  }

  trigger(type: KillReason, reason: string) {
    if (this.isActive) return; // first trigger wins
    this.state = { type, reason, triggeredAt: Date.now() };
    console.error(`[kill-switch] TRIGGERED — type=${type} reason="${reason}"`);
    this._saveToFile();
    this._persistToDb().catch(() => {});
    this._applyAutoResetPolicy();
    killSwitchEvents.emit("triggered", this.state);
  }

  reset() {
    this._clearAutoResetTimer();
    const prev = this.state;
    this.state = null;
    console.log(`[kill-switch] RESET — was: ${prev?.reason ?? "none"}`);
    this._saveToFile();
    this._persistToDb().catch(() => {});
    killSwitchEvents.emit("reset", prev);
  }
}

export const globalKillSwitch = new KillSwitch();

// Auto-trigger: if 3+ symbols lose WS feed within 60s → likely network issue
import { feedHealthEvents } from "./feed-health";
const recentFeedFailures = new Set<string>();
let feedFailureTimer: ReturnType<typeof setTimeout> | null = null;

feedHealthEvents.on("reconnecting", ({ symbol }: { symbol: string }) => {
  recentFeedFailures.add(symbol);
  if (feedFailureTimer) clearTimeout(feedFailureTimer);
  feedFailureTimer = setTimeout(() => recentFeedFailures.clear(), 60_000);

  if (recentFeedFailures.size >= 3 && !globalKillSwitch.isActive) {
    globalKillSwitch.trigger(
      "feed_failure",
      `${recentFeedFailures.size} WS feeds lost simultaneously — trading blind`
    );
  }
});
