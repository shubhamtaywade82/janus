import { EventEmitter } from "events";

export type KillReason = "manual" | "drawdown" | "feed_failure" | "api_error" | "margin_breach";

export interface KillState {
  type: KillReason;
  reason: string;
  triggeredAt: number;
}

export const killSwitchEvents = new EventEmitter();
killSwitchEvents.setMaxListeners(20);

export class KillSwitch {
  state: KillState | null = null;

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
    killSwitchEvents.emit("triggered", this.state);
  }

  reset() {
    const prev = this.state;
    this.state = null;
    console.log(`[kill-switch] RESET — was: ${prev?.reason ?? "none"}`);
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
