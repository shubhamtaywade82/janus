import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { KillSwitch } from "../kill-switch";

const STATE_FILE = path.resolve(process.cwd(), "kill-switch-state.json");

describe("KillSwitch", () => {
  let ks: KillSwitch;

  beforeEach(() => {
    // KillSwitch persists to a cwd state file; clear it so each test starts clean.
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    ks = new KillSwitch();
  });

  afterAll(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  it("starts inactive — canTrade = true", () => {
    expect(ks.isActive).toBe(false);
    expect(ks.canTrade()).toBe(true);
  });

  it("blocks trading after trigger", () => {
    ks.trigger("manual", "test stop");
    expect(ks.isActive).toBe(true);
    expect(ks.canTrade()).toBe(false);
  });

  it("stores reason and type", () => {
    ks.trigger("drawdown", "daily -5.2%");
    expect(ks.state!.reason).toBe("daily -5.2%");
    expect(ks.state!.type).toBe("drawdown");
    expect(ks.state!.triggeredAt).toBeGreaterThan(0);
  });

  it("first trigger wins — second trigger ignored", () => {
    ks.trigger("drawdown", "first");
    ks.trigger("feed_failure", "second");
    expect(ks.state!.type).toBe("drawdown");
    expect(ks.state!.reason).toBe("first");
  });

  it("resets to inactive after reset()", () => {
    ks.trigger("manual", "stop");
    ks.reset();
    expect(ks.isActive).toBe(false);
    expect(ks.canTrade()).toBe(true);
    expect(ks.state).toBeNull();
  });

  it("can trigger again after reset", () => {
    ks.trigger("manual", "first");
    ks.reset();
    ks.trigger("api_error", "second");
    expect(ks.isActive).toBe(true);
    expect(ks.state!.type).toBe("api_error");
  });
});
