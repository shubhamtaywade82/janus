import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { KillSwitch } from "../kill-switch";

const STATE_FILE = path.resolve(process.cwd(), "kill-switch-state.json");
const TMP_FILE = STATE_FILE + ".tmp";

// ─── Mock DB for initFromDb tests ────────────────────────────────────────────
let mockDbRows: Array<{
  key: string;
  isActive: boolean;
  type: string | null;
  reason: string | null;
  triggeredAt: string | null;
  updatedAt: Date;
}> = [];

vi.mock("../../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        limit: async () => mockDbRows,
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {},
      }),
    }),
  }),
}));

describe("KillSwitch — in-memory behaviour", () => {
  let ks: KillSwitch;

  beforeEach(() => {
    // Clean up any leftover state files so each test starts fresh.
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
    mockDbRows = [];
    ks = new KillSwitch();
  });

  afterAll(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
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

describe("KillSwitch — file persistence (atomic write)", () => {
  let ks: KillSwitch;

  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
    mockDbRows = [];
    ks = new KillSwitch();
  });

  afterAll(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
  });

  it("writes state file atomically (no tmp file left behind)", () => {
    ks.trigger("manual", "test");
    expect(fs.existsSync(STATE_FILE)).toBe(true);
    expect(fs.existsSync(TMP_FILE)).toBe(false); // tmp cleaned up by rename
  });

  it("removes state file on reset", () => {
    ks.trigger("manual", "test");
    expect(fs.existsSync(STATE_FILE)).toBe(true);
    ks.reset();
    expect(fs.existsSync(STATE_FILE)).toBe(false);
  });

  it("state file content matches in-memory state", () => {
    ks.trigger("drawdown", "daily -6%");
    const content = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(content.type).toBe("drawdown");
    expect(content.reason).toBe("daily -6%");
  });

  it("new instance loads state from file on construction", () => {
    ks.trigger("api_error", "exchange 500");
    const ks2 = new KillSwitch();
    expect(ks2.isActive).toBe(true);
    expect(ks2.state!.type).toBe("api_error");
  });

  it("ignores shutdown_ state file artifacts on construction", () => {
    ks.trigger("manual", "shutdown_SIGTERM");
    const ks2 = new KillSwitch();
    expect(ks2.isActive).toBe(false);
  });
});

describe("KillSwitch — DB persistence (initFromDb)", () => {
  let ks: KillSwitch;

  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
    mockDbRows = [];
    ks = new KillSwitch();
  });

  afterAll(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
  });

  it("starts inactive when DB has no row", async () => {
    mockDbRows = [];
    await ks.initFromDb();
    expect(ks.isActive).toBe(false);
  });

  it("remains inactive when DB row shows isActive=false", async () => {
    mockDbRows = [{
      key: "global", isActive: false, type: null, reason: null,
      triggeredAt: null, updatedAt: new Date(),
    }];
    await ks.initFromDb();
    expect(ks.isActive).toBe(false);
  });

  it("activates from DB when DB row shows isActive=true", async () => {
    const ts = Date.now();
    mockDbRows = [{
      key: "global", isActive: true, type: "drawdown",
      reason: "daily -5.5%", triggeredAt: String(ts), updatedAt: new Date(),
    }];
    await ks.initFromDb();
    expect(ks.isActive).toBe(true);
    expect(ks.state!.type).toBe("drawdown");
    expect(ks.state!.reason).toBe("daily -5.5%");
  });

  it("ignores DB shutdown_ artifact and stays inactive", async () => {
    mockDbRows = [{
      key: "global", isActive: true, type: "manual",
      reason: "shutdown_SIGTERM", triggeredAt: String(Date.now()), updatedAt: new Date(),
    }];
    await ks.initFromDb();
    expect(ks.isActive).toBe(false);
  });

  it("DB inactive overrides file-loaded active state", async () => {
    // Manually set in-memory state as if loaded from file
    ks.trigger("api_error", "exchange down");
    expect(ks.isActive).toBe(true);
    // DB says inactive
    mockDbRows = [{
      key: "global", isActive: false, type: null, reason: null,
      triggeredAt: null, updatedAt: new Date(),
    }];
    await ks.initFromDb();
    expect(ks.isActive).toBe(false);
  });
});
