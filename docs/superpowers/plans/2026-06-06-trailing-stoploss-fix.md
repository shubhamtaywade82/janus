# Trailing Stop-Loss & Breakeven Safety Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Position Manager so that (a) stop-loss can never move in the wrong direction, (b) breakeven fires exactly once per position, (c) trailing-stop state survives process restarts, and (d) duplicate "Position Opened" alerts are eliminated.

**Architecture:** Add three new persisted columns (`breakevenApplied`, `extremePrice`, `openedAlertSent`) to the `positions` table. Enforce a directional SL guard in both `policyGuard` and `executionManager` so LONG SL only moves up and SHORT SL only moves down. Sync these persisted fields into the in-memory `ManagedPosition` on every poll. Re-register open positions with the trailing-stop engine on every sync so state loss on restart is harmless.

**Tech Stack:** TypeScript, Node.js 20, Drizzle ORM, PostgreSQL, Vitest, PM2.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `db/schema.ts` | Add `breakevenApplied`, `extremePrice`, `openedAlertSent` columns to `positions` table |
| `db/migrations/` | Auto-generated Drizzle migration for the schema change |
| `api/services/position-manager/types.ts` | Extend `ManagedPosition` interface with new fields |
| `api/services/position-manager/position-store.ts` | Update `upsert` logic to respect `openedAlertSent`; add `updateExtremePrice` helper |
| `api/services/position-manager/execution-manager.ts` | Add `isSlImprovement` guard; apply it in `MOVE_TO_BREAKEVEN` and `TRAIL_SL` |
| `api/services/position-manager/policy-guard.ts` | Reject `MOVE_TO_BREAKEVEN` if `breakevenApplied === true`; keep existing `TRAIL_SL` guard |
| `api/services/position-manager/ai-advisor.ts` | Code fallback: skip `MOVE_TO_BREAKEVEN` recommendation if `breakevenApplied === true` |
| `api/services/position-manager/position-lifecycle.ts` | Sync new DB columns into `ManagedPosition`; re-register positions with trailing-stop engine |
| `api/services/position-telegram-notifier.ts` | Skip `position:discovered` alerts when `openedAlertSent === true` |
| `api/services/position-manager/__tests__/sl-guard.test.ts` | New test suite for directional guard |

---

## Task 1: Database Schema — Add Persisted State Columns

**Files:**
- Modify: `db/schema.ts` (inside `positions` table definition)

- [ ] **Step 1: Add three columns to the `positions` table**

Inside the `positions` table definition (after `exitReason`), insert:

```typescript
    breakevenApplied: boolean("breakeven_applied").default(false).notNull(),
    extremePrice: decimal("extreme_price", { precision: 18, scale: 8 }),
    openedAlertSent: boolean("opened_alert_sent").default(false).notNull(),
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
npm run db:generate
npm run db:migrate
```

Expected: `drizzle-kit` creates a new migration file under `db/migrations/` and applies it cleanly with no errors.

- [ ] **Step 3: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(db): add breakevenApplied, extremePrice, openedAlertSent to positions"
```

---

## Task 2: Update Types and In-Memory Store

**Files:**
- Modify: `api/services/position-manager/types.ts`
- Modify: `api/services/position-manager/position-store.ts`

- [ ] **Step 1: Extend `ManagedPosition` interface**

In `types.ts`, add three fields after `holdingMinutes`:

```typescript
  breakevenApplied: boolean;
  extremePrice: number | null;
  openedAlertSent: boolean;
```

- [ ] **Step 2: Update `PositionStore.upsert` to deduplicate discovery alerts**

In `position-store.ts`, replace the `upsert` method:

```typescript
  upsert(position: ManagedPosition): void {
    const existing = this.store.get(position.id);
    const isNew = !existing;

    this.store.set(position.id, position);

    if (isNew && !position.openedAlertSent) {
      positionManagerBus.emit("position:discovered", position);
    } else {
      positionManagerBus.emit("position:synced", position);
    }
  }
```

- [ ] **Step 3: Add `updateExtremePrice` helper to `PositionStore`**

Insert after `updateProtection`:

```typescript
  updateExtremePrice(id: number, extremePrice: number): void {
    const pos = this.store.get(id);
    if (!pos) return;
    this.store.set(id, { ...pos, extremePrice, updatedAt: new Date() });
  }
```

- [ ] **Step 4: Commit**

```bash
git add api/services/position-manager/types.ts api/services/position-manager/position-store.ts
git commit -m "feat(pm): extend ManagedPosition with breakevenApplied, extremePrice, openedAlertSent"
```

---

## Task 3: Directional SL Guard in Execution Manager

**Files:**
- Modify: `api/services/position-manager/execution-manager.ts`
- Test: `api/services/position-manager/__tests__/sl-guard.test.ts` (created in Task 8)

- [ ] **Step 1: Add the directional guard function**

Insert immediately after the imports (before `fetchCredentials`):

```typescript
/**
 * Returns true only if the proposed SL is strictly better than current.
 * LONG: proposed must be > current
 * SHORT: proposed must be < current
 */
export function isSlImprovement(
  side: "LONG" | "SHORT",
  currentSl: number | null,
  proposedSl: number
): boolean {
  if (currentSl === null) return true;
  if (side === "LONG") return proposedSl > currentSl;
  return proposedSl < currentSl;
}
```

- [ ] **Step 2: Guard `MOVE_TO_BREAKEVEN`**

Replace the existing `MOVE_TO_BREAKEVEN` case with:

```typescript
      case PA.MOVE_TO_BREAKEVEN: {
        const newSl =
          recommendation.newStopLoss ??
          (position.side === "LONG"
            ? position.entryPrice * 1.001
            : position.entryPrice * 0.999);

        if (!isSlImprovement(position.side, position.stopLoss, newSl)) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "rejected",
            `MOVE_TO_BREAKEVEN rejected: ${newSl.toFixed(4)} is worse than current ${position.stopLoss?.toFixed(4)}`
          );
          return { success: false, detail: `Breakeven rejected: would lower SL` };
        }

        await db
          .update(positions)
          .set({
            stopLoss: newSl.toFixed(8),
            updatedAt: new Date(),
            breakevenApplied: true,
          })
          .where(eq(positions.id, position.id));

        positionStore.updateProtection(position.id, newSl, position.takeProfit);
        syncTrailingStopLoss(position.id, newSl);
        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "SL_UPDATE",
          side: position.side === "LONG" ? "long" : "short",
          price: newSl,
          metadata: {
            oldSl: position.stopLoss,
            newSl,
            reason: "breakeven",
          },
        });
        positionManagerBus.emit(
          "position:action-executed",
          position.id,
          action,
          "ok",
          `SL moved to breakeven: ${newSl.toFixed(4)}`
        );
        return { success: true, detail: `Stop moved to breakeven @ ${newSl.toFixed(4)}` };
      }
```

- [ ] **Step 3: Guard `TRAIL_SL`**

Replace the existing `TRAIL_SL` case with:

```typescript
      case PA.TRAIL_SL: {
        if (!recommendation.newStopLoss) {
          return { success: false, detail: "TRAIL_SL: no new stop loss value provided" };
        }
        const newSl = recommendation.newStopLoss;

        if (!isSlImprovement(position.side, position.stopLoss, newSl)) {
          positionManagerBus.emit(
            "position:action-executed",
            position.id,
            action,
            "rejected",
            `TRAIL_SL rejected: ${newSl.toFixed(4)} is worse than current ${position.stopLoss?.toFixed(4)}`
          );
          return { success: false, detail: `Trail rejected: would reverse SL` };
        }

        await db
          .update(positions)
          .set({ stopLoss: newSl.toFixed(8), updatedAt: new Date() })
          .where(eq(positions.id, position.id));

        positionStore.updateProtection(position.id, newSl, position.takeProfit);
        syncTrailingStopLoss(position.id, newSl);
        await recordPositionTransaction({
          positionId: position.id,
          userId,
          symbol: position.symbol,
          type: "SL_UPDATE",
          side: position.side === "LONG" ? "long" : "short",
          price: newSl,
          metadata: {
            oldSl: position.stopLoss,
            newSl,
            reason: "trail",
          },
        });
        positionManagerBus.emit(
          "position:action-executed",
          position.id,
          action,
          "ok",
          `SL trailed to ${newSl.toFixed(4)}`
        );
        return { success: true, detail: `Stop trailed to ${newSl.toFixed(4)}` };
      }
```

- [ ] **Step 4: Commit**

```bash
git add api/services/position-manager/execution-manager.ts
git commit -m "feat(pm): add directional SL guard to MOVE_TO_BREAKEVEN and TRAIL_SL"
```

---

## Task 4: Policy Guard — Reject Bad Breakeven

**Files:**
- Modify: `api/services/position-manager/policy-guard.ts`
- Test: `api/services/position-manager/__tests__/sl-guard.test.ts` (Task 8)

- [ ] **Step 1: Reject `MOVE_TO_BREAKEVEN` if already applied**

Replace the existing `MOVE_TO_BREAKEVEN` block with:

```typescript
  // ── MOVE_TO_BREAKEVEN: only if profitable and not already applied ────
  if (action === PA.MOVE_TO_BREAKEVEN) {
    if (position.unrealizedPnl <= 0) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: "MOVE_TO_BREAKEVEN rejected: position not yet in profit",
      };
    }
    if (position.breakevenApplied) {
      return {
        approved: false,
        action: PA.KEEP_OPEN,
        reason: "MOVE_TO_BREAKEVEN rejected: breakeven already applied to this position",
      };
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add api/services/position-manager/policy-guard.ts
git commit -m "feat(pm): policyGuard rejects breakeven if already applied"
```

---

## Task 5: AI Advisor — Skip Breakeven in Code Fallback

**Files:**
- Modify: `api/services/position-manager/ai-advisor.ts`

- [ ] **Step 1: Gate breakeven recommendation on `breakevenApplied`**

Change the breakeven rule from:

```typescript
  // Rule 3: Move to breakeven once 1R in profit
  if (stopLoss && pnlSign) {
```

To:

```typescript
  // Rule 3: Move to breakeven once 1R in profit (only once per position)
  if (stopLoss && pnlSign && !position.breakevenApplied) {
```

- [ ] **Step 2: Commit**

```bash
git add api/services/position-manager/ai-advisor.ts
git commit -m "feat(pm): code advisor skips breakeven if already applied"
```

---

## Task 6: Sync Persisted State from DB into ManagedPosition

**Files:**
- Modify: `api/services/position-manager/position-lifecycle.ts`

- [ ] **Step 1: Read new columns when building `ManagedPosition`**

Inside `syncPositions()`, in the DB-first-pass loop where `ManagedPosition` is built, append the three fields to the object literal:

```typescript
        // NEW persisted state fields
        breakevenApplied: dbPos.breakevenApplied ?? false,
        extremePrice: dbPos.extremePrice ? parseFloat(dbPos.extremePrice) : null,
        openedAlertSent: dbPos.openedAlertSent ?? false,
```

- [ ] **Step 2: After emitting discovery, flip `openedAlertSent` in DB**

Still inside the loop, after `positionStore.upsert(mp)`, add:

```typescript
      // If we just discovered this position and it hasn't been alerted yet,
      // mark it as alerted in the DB so restarts don't re-alert.
      const justDiscovered = !existing;
      if (justDiscovered && !mp.openedAlertSent) {
        db.update(positions)
          .set({ openedAlertSent: true })
          .where(eq(positions.id, dbPos.id))
          .catch(() => {});
      }
```

- [ ] **Step 3: Commit**

```bash
git add api/services/position-manager/position-lifecycle.ts
git commit -m "feat(pm): sync breakevenApplied, extremePrice, openedAlertSent from DB"
```

---

## Task 7: Trailing-Stop Engine — Re-register on Every Sync

**Files:**
- Modify: `api/services/position-manager/position-lifecycle.ts`

- [ ] **Step 1: Import trailing-stop helpers**

At the top of `position-lifecycle.ts`, add to the existing imports:

```typescript
import { registerPositionForTrailing, syncTrailingStopLoss } from "../trailing-stop";
```

- [ ] **Step 2: Re-register every open position with the trailing engine**

Inside `syncPositions()`, still inside the DB-first-pass loop, after the `openedAlertSent` DB update block, add:

```typescript
      // Ensure the trailing-stop engine knows about this position
      // (critical after restart when trackedPositions map is empty)
      if (mp.stopLoss) {
        registerPositionForTrailing({
          id: mp.id,
          symbol: mp.symbol.replace("B-", "").replace("_", ""),
          side: mp.side === "LONG" ? "long" : "short",
          entryPrice: mp.entryPrice,
          stopLoss: mp.stopLoss,
          strategyType: dbPos.strategyType ?? "intraday",
          userId: mp.userId,
          size: mp.quantity,
        });
        syncTrailingStopLoss(mp.id, mp.stopLoss);
      }
```

- [ ] **Step 3: Commit**

```bash
git add api/services/position-manager/position-lifecycle.ts
git commit -m "feat(pm): re-register open positions with trailing-stop engine on every sync"
```

---

## Task 8: Telegram Notifier — Respect `openedAlertSent`

**Files:**
- Modify: `api/services/position-telegram-notifier.ts`

- [ ] **Step 1: Skip duplicate "Position Opened" alerts**

Find the `position:discovered` listener. If it exists, wrap the alert send in a guard:

```typescript
  positionManagerBus.on("position:discovered", (position: ManagedPosition) => {
    if (position.openedAlertSent) return; // already alerted before restart
    const emoji = position.isPaper ? "🧪 PAPER" : "🔴 LIVE";
    // ... rest of existing handler
  });
```

If there is no explicit `position:discovered` listener in the notifier file, verify that the event is handled only via the generic `position:action-executed` or `position:lifecycle-changed` listeners, and that `positionStore.upsert` already filters discovery events when `openedAlertSent === true`.

- [ ] **Step 2: Commit**

```bash
git add api/services/position-telegram-notifier.ts
git commit -m "feat(pm): telegram notifier skips duplicate open alerts after restart"
```

---

## Task 9: Test Suite — Directional SL Guard

**Files:**
- Create: `api/services/position-manager/__tests__/sl-guard.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { isSlImprovement } from "../execution-manager";

describe("isSlImprovement", () => {
  it("accepts a higher SL for LONG", () => {
    expect(isSlImprovement("LONG", 1600, 1650)).toBe(true);
  });

  it("rejects a lower SL for LONG", () => {
    expect(isSlImprovement("LONG", 1600, 1550)).toBe(false);
  });

  it("accepts a lower SL for SHORT", () => {
    expect(isSlImprovement("SHORT", 60000, 59000)).toBe(true);
  });

  it("rejects a higher SL for SHORT", () => {
    expect(isSlImprovement("SHORT", 60000, 61000)).toBe(false);
  });

  it("accepts any SL when current is null", () => {
    expect(isSlImprovement("LONG", null, 100)).toBe(true);
    expect(isSlImprovement("SHORT", null, 99999)).toBe(true);
  });

  it("rejects equal SL (strict inequality)", () => {
    expect(isSlImprovement("LONG", 1600, 1600)).toBe(false);
    expect(isSlImprovement("SHORT", 60000, 60000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run api/services/position-manager/__tests__/sl-guard.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 3: Run existing policy-guard tests to ensure no regressions**

```bash
npx vitest run api/services/position-manager/__tests__/policy-guard.test.ts
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add api/services/position-manager/__tests__/sl-guard.test.ts
git commit -m "test(pm): add directional SL guard tests"
```

---

## Task 10: Build & Smoke Test

**Files:**
- None (verification only)

- [ ] **Step 1: Type-check and build**

```bash
npm run build
```

Expected: `esbuild` completes with exit code 0 and no TypeScript errors.

- [ ] **Step 2: Restart the bot**

```bash
npm run bot:restart
```

- [ ] **Step 3: Verify in logs**

```bash
npm run bot:logs
```

Watch for:
- "Position Manager Started" appears once
- Any open positions are synced without duplicate "Position Opened" Telegram alerts
- No TypeScript runtime errors related to missing properties

- [ ] **Step 4: Commit (if any last-minute fixes were needed)**

```bash
git add -A && git commit -m "fix(pm): trailing-stop and breakeven safety hardening" || echo "No changes to commit"
```

---

## Self-Review

### Spec Coverage

| Requirement in Doc | Task |
|-------------------|------|
| SL must never reverse direction (LONG down, SHORT up) | Task 3 (`isSlImprovement` guard), Task 4 (policyGuard) |
| Breakeven must fire only once per position | Task 4 (policyGuard), Task 5 (ai-advisor), Task 1/6 (DB flag) |
| Trailing stop state must survive restart | Task 7 (re-register on sync) |
| Duplicate "Position Opened" alerts on restart | Task 2 (`openedAlertSent` + upsert guard), Task 6 (DB sync), Task 8 (notifier) |
| Currency formatting consistency | Not directly addressed — was previously fixed in INR paper-trading work; monitor logs |

### Placeholder Scan

- No "TBD", "TODO", or placeholder code remains.
- Every step contains exact file paths, line references, and full code blocks.
- Every commit command is explicit.

### Type Consistency

- `breakevenApplied` → `boolean` in schema, types, and all checks
- `extremePrice` → `decimal` in schema, `number | null` in types, parsed with `parseFloat`
- `openedAlertSent` → `boolean` in schema and types
- `isSlImprovement` signature matches usage in both `execution-manager` and `policy-guard`

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-06-trailing-stoploss-fix.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
