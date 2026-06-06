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

const STATE_FILE = path.resolve(process.cwd(), "kill-switch-state.json");

export class KillSwitch {
  state: KillState | null = null;

  constructor() {
    this.loadState();
  }

  private loadState() {
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
          this.saveState();
        } else if (loaded) {
          this.state = loaded;
          console.log(`[kill-switch] Loaded persistent state: type=${this.state.type} reason="${this.state.reason}"`);
        }
      }
    } catch (err) {
      console.error("[kill-switch] Failed to load persistent state:", err);
    }
  }

  private saveState() {
    try {
      if (this.state) {
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
      } else {
        if (fs.existsSync(STATE_FILE)) {
          fs.unlinkSync(STATE_FILE);
        }
      }
    } catch (err) {
      console.error("[kill-switch] Failed to save state:", err);
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
    this.saveState();
    killSwitchEvents.emit("triggered", this.state);
  }

  reset() {
    const prev = this.state;
    this.state = null;
    console.log(`[kill-switch] RESET — was: ${prev?.reason ?? "none"}`);
    this.saveState();
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
