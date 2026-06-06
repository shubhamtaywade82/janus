import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const CWD = process.cwd();

function readRouter(name: string): string {
  return readFileSync(join(CWD, `api/routers/${name}`), "utf-8");
}

describe("signal-router auth enforcement", () => {
  const src = readRouter("signal-router.ts");

  it("imports authedQuery, not publicQuery", () => {
    expect(src).toContain("authedQuery");
    expect(src).not.toContain("publicQuery");
  });

  it("every procedure uses authedQuery", () => {
    // Extract all procedure-assignment tokens to verify none use publicQuery
    const procedurePattern = /:\s*(publicQuery|authedQuery|adminQuery)\b/g;
    const matches = [...src.matchAll(procedurePattern)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match).not.toBe("publicQuery");
    }
  });
});

describe("market-router auth enforcement", () => {
  const src = readRouter("market-router.ts");

  it("imports authedQuery, not publicQuery", () => {
    expect(src).toContain("authedQuery");
    expect(src).not.toContain("publicQuery");
  });

  it("every procedure uses authedQuery", () => {
    const procedurePattern = /:\s*(publicQuery|authedQuery|adminQuery)\b/g;
    const matches = [...src.matchAll(procedurePattern)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match).not.toBe("publicQuery");
    }
  });
});

describe("trading-router auth enforcement", () => {
  const src = readRouter("trading-router.ts");

  it("createPosition uses authedQuery", () => {
    expect(src).toContain("createPosition: authedQuery");
  });

  it("derives userId from ctx.user.id, not from user input", () => {
    // The old pattern was: userId: z.number() in input, then used input.userId
    // The fix pattern is: const userId = ctx.user.id;
    expect(src).toContain("const userId = ctx.user.id;");
  });
});

describe("schema — open position uniqueness constraint", () => {
  const schemaSrc = readFileSync(join(CWD, "db/schema.ts"), "utf-8");

  it("has a uniqueIndex named uq_positions_open", () => {
    expect(schemaSrc).toContain("uq_positions_open");
  });

  it("uniqueIndex is partial (WHERE status = open)", () => {
    // The uniqueIndex uses a WHERE clause scoped to open positions
    expect(schemaSrc).toContain("uq_positions_open");
    // Ensure both uniqueIndex function and the status filter are present
    expect(schemaSrc).toContain("uniqueIndex");
    expect(schemaSrc).toMatch(/uq_positions_open[\s\S]{0,300}status[\s\S]{0,50}'open'/);
  });

  it("has risk_sessions table for daily drawdown persistence", () => {
    expect(schemaSrc).toContain("risk_sessions");
    expect(schemaSrc).toContain("realized_pnl");
    expect(schemaSrc).toContain("in_cooldown");
  });

  it("has kill_switch_state table for halt state persistence", () => {
    expect(schemaSrc).toContain("kill_switch_state");
    expect(schemaSrc).toContain("is_active");
  });
});
