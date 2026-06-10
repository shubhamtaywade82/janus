# Plan: Dual Live + Paper Monitor, Paper-Only Execution

## Goal
No matter the trading mode, the system must simultaneously:
1. **Load & sync** both live and paper open positions from the DB.
2. **Monitor & assess** both through the Position Lifecycle Manager.
3. **Execute** automated actions (entry, exit, SL/TP moves, partial exits) **only on paper positions**.
4. **Observe** live positions — track them, record assessments, emit events, log to ledger, but never place exchange orders or mutate them automatically.

## Files Affected
| File | Lines | Change |
|------|-------|--------|
| `api/services/auto-executor.ts` | ~493, ~545, ~555, ~715, ~1030 | Remove mode-gated entry/exit logic; always create paper positions; monitor live exits |
| `api/services/governor.ts` | ~95, ~101 | Duplicate & max-positions checks must span all positions |
| `api/services/position-manager/execution-manager.ts` | ~35 | Add live-position guard at top of `executeAction` |

## Chunk 1: Auto-Executor (Paper-Only Entry + Live Monitor Exit)
**File:** `api/services/auto-executor.ts`

### 1.1 Entry Signal Processing
- **Remove** the `env.isMonitorMode` early-return in `processSignal` (line ~493). Replace with:
  - If in `live_monitor` mode: add a `monitor_mode` gate label in the decision log but **still proceed to Governor + execution** (since execution now creates paper positions regardless).
  - Actually: simpler — just drop the `env.isMonitorMode` gate that causes `this.skip(...)` entirely. The signal still goes through Governor and creates a paper position.
- **In `prepareExecutionContext`**:
  - Change `const isPaperMode = env.tradingMode === "paper"` → `const isPaperMode = true`. We always create paper positions from automated signals.
  - Change open-position count query to count **all open positions** (both paper and live), not filtering by `isPaper`:
    ```ts
    const openCount = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.userId, 1), eq(positions.status, "open")))
      .then((r) => r.length);
    ```
  - The wallet context still uses paper wallet (since `isPaperMode = true`).
- **In `executePosition`**:
  - Always pass `isPaper: true` (remove conditional).
  - The code already skips exchange order placement when `isPaper` is true, so no further change needed.

### 1.2 Exit Signal Processing (`handleExitSignal`)
- When a live position receives an exit signal:
  - Close it in the DB (mark `status: "closed"`, set `realizedPnl`, `unrealizedPnl`, `exitReason`, `closedAt`).
  - **Do NOT** place a live exchange exit order (the `createFuturesOrder` call must be skipped).
  - Still release paper margin if paper.
  - Still emit `portfolio-update` and update risk sessions.
  - Still trigger reflection.
  - The current code already branches on `position.isPaper`, so we only need to remove the `else` branch that places the live exit order. Replace the live-exit `createFuturesOrder` block with a log line:
    ```ts
    console.log(`[auto-executor] Live position ${position.symbol} #${position.id} exit detected — DB updated, no exchange order placed (monitor-only)`);
    ```

## Chunk 2: Governor (Dual-Position Safety Gates)
**File:** `api/services/governor.ts`

### 2.1 Gate 3 — Duplicate Position
- The duplicate check must look across **all open positions** for the symbol, not just paper/live:
  ```ts
  const existing = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.userId, 1), eq(positions.symbol, symbol), eq(positions.status, "open")))
    .limit(1);
  ```

### 2.2 Gate 4 — Max Positions
- The `openCount` already comes from the caller, and the caller in `auto-executor.ts` will now count all positions. So no code change is strictly needed **inside** Governor, but document that `openCount` now covers both live + paper.
- Keep `maxTotal` logic as-is (paper uses `PAPER_MAX_POSITIONS = 10`, live uses `config.maxTotalPositions ?? 3`). Since we always execute as paper, the paper cap applies.

## Chunk 3: Execution Manager — Live Guard
**File:** `api/services/position-manager/execution-manager.ts`

### 3.1 Live-Position Block
At the top of `executeAction`, replace the `env.isMonitorMode` guard:
```ts
// Live positions are monitor-only regardless of mode (paper-only execution policy)
if (!position.isPaper && action !== PA.KEEP_OPEN) {
  positionManagerBus.emit(
    "position:action-executed",
    position.id,
    action,
    "ok",
    `[monitor] would execute ${action}: ${recommendation.reasoning ?? ""}`
  );
  return { success: true, detail: `[monitor] ${action} observed — live position, no automatic execution` };
}
// Also keep the existing env.isMonitorMode guard for true monitor mode
if (env.isMonitorMode && action !== PA.KEEP_OPEN) {
  ...existing monitor mode block...
}
```

This ensures:
- Live positions get logged/assessed/emitted but never get exchange orders.
- Paper positions continue full execution.
- True `live_monitor` mode still blocks paper execution too (the existing guard).

## Chunk 4: Verification (No Code Changes)
**File:** `api/services/position-manager/position-lifecycle.ts`

- Already syncs ALL open positions from DB (no `isPaper` filter in the query on line ~135).
- Already assesses ALL open positions in the loop.
- `executeAction` will now block live positions, so no code change needed here.

## Acceptance Criteria
1. `npx tsc --noEmit` passes in `api/` (type-safe).
2. `grep -n 'isPaperMode.*===.*env.tradingMode'` in `auto-executor.ts` returns no results.
3. `grep -n 'position.isPaper' in execution-manager.ts shows the live guard at the top.
4. Governor duplicate check query does not filter on `eq(positions.isPaper, ...)`.
5. Starting the system in `TRADING_MODE=live_trade` still loads both live and paper positions into the PositionStore and runs assessment cycles on both.
6. Live positions never trigger `createFuturesOrder` calls (can be verified by log inspection or by checking that the `!position.isPaper` branches in execution-manager.ts all return before exchange calls).
7. Signal processing in any mode creates paper positions (DB rows with `isPaper = true`).
