User: Is the pnl correct based on the entry price ,size and leverage?
🟢 Position Opened 🧪 PAPER

ETHUSDT LONG ×5
Entry: 1555.8100
Size: 0.4356 | Margin: 135.57 ₹
📈 uPnL: 24.38 ₹ | ROE: 17.98%
SL: 1611.9700  TP: 6223.2400
Kimi: **The ROE math is internally consistent, but your Stop Loss is configured backwards.**

Here is the breakdown:

| Check | Calculation | Result |
|-------|-------------|--------|
| **ROE** | 24.38 ÷ 135.57 | **17.98%** ✅ |
| **Margin** | (1555.81 × 0.4356) ÷ 5 | **135.54** ≈ 135.57 ✅ (minor rounding) |
| **Current price (implied)** | 1555.81 + (24.38 / 0.4356) | **~1611.78** |

### The problem

For a **LONG** position, the Stop Loss must be **below** the entry price to protect against downside.
Yours is set at **1611.97**, which is **above** 1555.81.

That means:

- Your position is currently profitable (~+56 USDT from entry).
- Yet your "Stop Loss" is sitting **above** your entry, basically acting as a Take-Profit or an immediate exit trigger.
- If price hits 1611.97, a LONG should be in profit, not stopped out.

### Likely fixes

1. **SL typo** — It should probably be **~1500** (or wherever your actual risk level is), not 1611.97.
2. **SL / TP swap** — If you meant 1611.97 as a *take-profit* target and 6223.24 as some other level, they may have been mapped to the wrong fields.
3. **Entry price error** — If your real entry was closer to ~1650, then 1611.97 as SL would make sense.

**Bottom line:** The PnL and margin figures are mathematically correct, but the risk parameters are inverted. Double-check your SL on the exchange before the next tick hits 1611.97 and does something unexpected.
User: This is trailing stoploss which has moved til here
Kimi: That makes perfect sense — **yes, the PnL is correct.**

Since it's a **trailing stop** on a **LONG**, it started below your entry and has ratcheted up as ETH moved higher. Here's what the numbers tell us:

| Metric | Value | Check |
|--------|-------|-------|
| **Price move** | 1611.97 − 1555.81 = **56.16 USDT** | Trailing SL now sits here |
| **Implied ROE** | (56.16 / 1555.81) × 5 ≈ **18.05%** | Matches your 17.98% ✅ |
| **Margin** | (1555.81 × 0.4356) / 5 ≈ **135.54** | Matches 135.57 ✅ |
| **uPnL / Margin** | 24.38 / 135.57 = **17.98%** | Exact ✅ |

### Key observation

Your trailing stop is now **~56 USDT above entry**, which means it has locked in a decent profit. However, it is **extremely tight** to the current price — if ETH pulls back even slightly to 1611.97, the position will close and capture that ~18% ROE.

If you believe the move has more room, you may want to verify the trailing distance (callback rate / activation price) so it doesn't get chopped out on a small retracement.
User: What I think is the sl should be less that the current price not the entry prices?
Kimi: **Yes, exactly — you are right.**

For a **trailing stop on a LONG**, the only hard rule is:

> **Current Price > Stop Loss**

It does **not** need to be below the entry price. As the trade moves into profit, the trailing stop is supposed to climb above your entry and sit at a fixed distance below whatever the current (or highest) price is.

So in your case:

- **Entry:** 1555.81
- **Trailing SL:** 1611.97
- **Current price:** Must be **> 1611.97** (otherwise the position would already be closed)

The SL being above the entry is actually the **whole point** of a trailing stop — it has locked in a profit floor and is protecting you from giving back those gains.

### Quick sanity check

If your current price were, say, **1620**, then your trailing distance is only about **8 USDT** (0.5%). That is quite tight, so a small wick down could stop you out. Just make sure that distance matches the callback % you intended.
User: Review this

And identify what was happening
Kimi: Here is what is happening in your log — **there are multiple serious bugs in the position manager's stop-loss logic.**

---

### 1. 🔴 Critical: Stop Loss is moving **backwards** for LONGs

For a long position, once the SL is raised to lock in profits, it must **never move down again**. Your system is violating this repeatedly.

**ETH (Position 176):**

- 12:54 — Trailing stop raises SL to **1593.77**
- 12:57 — Trailing stop raises SL to **1611.97**
- 12:59 — "Breakeven" **drops** SL back to **1555.81** (entry)
- 1:04 — Drops again to **1557.37**

**BTC (Position 175):**

- 12:56 — Trailing stop raises SL to **62095.00**
- 12:57 — "Breakeven" **drops** SL to **60666.41**
- 1:02 — Drops further to **60593.80**
- 1:05 — Drops again to **60605.80** (entry)

**Impact:** If price retraces, you will be stopped out at entry or near-entry, losing all the profit that the trailing stop had already secured.

---

### 2. 🔴 Breakeven logic is firing **continuously** and producing **random values**

Breakeven should be a **one-time** event when price hits a threshold. Instead, it fires every 1–2 minutes with wildly different prices.

**ETH entry: 1555.81**

- 12:35 → Breakeven SL: **1639.03** (+5.3%, not breakeven)
- 12:36 → Breakeven SL: **1597.81** (+2.7%)
- 12:36 → Breakeven SL: **1555.81** (0%, exact entry)
- 12:40 → Breakeven SL: **1557.37** (+0.1%, reasonable)
- 12:45 → Breakeven SL: **1610.02** (+3.5%)

The calculation is non-deterministic. It looks like the function is recomputing from corrupted state or using the wrong variables.

---

### 3. 🔴 Trailing Stop and Breakeven are **fighting each other**

There is no coordination between the two modules. They overwrite the SL blindly:

- Trailing stop pushes SL up to follow price.
- Breakeven immediately overwrites it with a lower number.
- On the next tick, trailing stop pushes it up again.

Your code should enforce this rule for LONGs:

```python
new_sl = max(current_sl, proposed_sl)
```

Never allow a lower SL to replace a higher one.

---

### 4. 🟡 Position Manager is **crashing / restarting**

"Position Manager Started" appears at:

- 12:34
- 12:35
- 12:38
- 12:57

This suggests the process is dying and respawning, which explains why it keeps "rediscovering" the same positions and re-applying breakeven logic from scratch.

---

### 5. 🟡 "Position Opened" alerts are **re-firing on existing positions**

The alert fires at 12:34, 12:35, 12:38, and 12:57 for the exact same positions (same entry, same size). This confirms the manager is losing state on restart and treating live positions as brand new.

---

### 6. 🟡 Currency display is inconsistent

Same positions show margin as **USDT** in some alerts and **₹** in others. This is a formatting bug in the alert dispatcher.

---

### Root Cause Assessment

The position manager appears to be **stateless or losing its state** on every restart. When it comes back up:

1. It sees open positions.
2. It cannot remember the current SL, so it recalculates "breakeven" from scratch.
3. The breakeven function has a bug that returns inconsistent values.
4. Because there is no `max(current_sl, new_sl)` guard, it overwrites a higher trailing stop with a lower breakeven value.
5. The trailing stop module then detects the new price on the next poll and tries to raise it again — creating the oscillation.

---

### Immediate fixes needed

| Priority | Fix |
|----------|-----|
| **P0** | Add a guard: for LONGs, `new_sl = max(current_sl, new_sl)`. Never lower a raised SL. |
| **P0** | Make breakeven trigger **once** per position. Store a flag `breakeven_set = true`. |
| **P1** | Fix the breakeven calculation so it is deterministic (entry + estimated fees). |
| **P1** | Fix the position manager restart loop — check for memory leaks, uncaught exceptions, or healthcheck failures. |
| **P2** | Stop repeating "Position Opened" alerts for already-known positions. Maintain a local position cache. |
| **P2** | Fix currency formatting in alerts. |
User: Please plan for both short and long
Kimi: Here is the complete fix plan for **both directions**, with the directional guard rules that must be enforced.

---

## Core Rule: Direction-Aware SL Guard

For any position, the stop loss must **only move in the profitable direction** and **never reverse**.

| Direction | SL can only move... | Why |
|-----------|---------------------|-----|
| **LONG** | **UP** (higher) | Higher SL locks in more profit; lower SL would give back gains |
| **SHORT** | **DOWN** (lower) | Lower SL locks in more profit; higher SL would give back gains |

---

## Phase 1: SL Guard (P0 — Deploy First)

Add a single validation gate before any SL update:

```python
def can_update_sl(position, new_sl):
    if position.side == "LONG":
        return new_sl > position.current_sl   # Only raise
    else:  # SHORT
        return new_sl < position.current_sl   # Only lower
```

**What this fixes:**

- Breakeven can no longer overwrite a trailing stop with a worse value
- A restarted manager cannot "forget" a raised SL and push it back down
- Both LONG and SHORT positions are protected

---

## Phase 2: Breakeven Logic (P0)

Breakeven must fire **once per position** and compute the correct level for each direction.

| Direction | Breakeven Formula | Example |
|-----------|-----------------|---------|
| **LONG** | `entry + (entry * fee_estimate)` | 1555.81 + ~0.05% = 1556.59 |
| **SHORT** | `entry - (entry * fee_estimate)` | 60605.80 - ~0.05% = 60575.58 |

**Required changes:**

1. Store `breakeven_applied = true` in the position state after the first trigger.
2. Never recompute breakeven if the flag is set.
3. The trigger condition must be direction-aware:
   - LONG: `mark_price > entry * (1 + trigger_pct)`
   - SHORT: `mark_price < entry * (1 - trigger_pct)`

---

## Phase 3: Trailing Stop Logic (P1)

Trailing stop must also respect the guard and compute correctly for both sides.

| Direction | Trailing Stop Behavior |
|-----------|------------------------|
| **LONG** | Tracks `highest_price - callback_distance`. SL moves up when price makes a new high. |
| **SHORT** | Tracks `lowest_price + callback_distance`. SL moves down when price makes a new low. |

**Required changes:**

1. Track `highest_price` for LONGs, `lowest_price` for SHORTs.
2. Compute `new_sl` based on the tracked extreme, not the current mark price.
3. Pass `new_sl` through the `can_update_sl()` guard before applying.

---

## Phase 4: State Persistence (P1)

The manager is losing state on restart. Fix this so it does not reprocess existing positions.

| State to Persist | Why |
|------------------|-----|
| `current_sl` | Prevents overwriting with a lower value |
| `breakeven_applied` | Prevents repeated breakeven spam |
| `highest_price` / `lowest_price` | Trailing stop needs the correct anchor |
| `position_id` | Prevents duplicate "Position Opened" alerts |

**Implementation:**

- On startup, load the persisted state before connecting to the exchange.
- If a position exists in state but not on the exchange, clear it.
- If a position exists on the exchange but not in state, add it with `current_sl = exchange_sl`.

---

## Phase 5: Alert & Formatting Fixes (P2)

| Issue | Fix |
|-------|-----|
| Duplicate "Position Opened" | Only alert if `position_id` is not in the local cache |
| Currency mixing (USDT / ₹) | Determine the quote currency from the symbol (USDT, INR, etc.) and use it consistently |
| "Breakeven" spam | Only alert when `breakeven_applied` flips from `false` to `true` |
| "Trail Stop" noise | Only alert when `new_sl != current_sl` after the guard passes |

---

## Test Matrix

Before going live, verify each scenario:

| Scenario | LONG | SHORT |
|----------|------|-------|
| Breakeven triggers once | ✅ | ✅ |
| Trailing stop raises/lowers SL | ✅ Up | ✅ Down |
| Breakeven cannot overwrite trailing | ✅ | ✅ |
| Manager restart preserves SL | ✅ | ✅ |
| No duplicate open alerts | ✅ | ✅ |
| SL never reverses direction | ✅ | ✅ |

---

## Quick Code Sketch

```python
class Position:
    def __init__(self, side, entry, size, leverage):
        self.side = side          # "LONG" or "SHORT"
        self.entry = entry
        self.current_sl = None
        self.breakeven_applied = False
        self.extreme_price = entry  # highest for LONG, lowest for SHORT

    def update_sl(self, new_sl, source):
        # Directional guard
        if self.side == "LONG" and new_sl <= self.current_sl:
            return False  # Reject — would lower SL on a long
        if self.side == "SHORT" and new_sl >= self.current_sl:
            return False  # Reject — would raise SL on a short

        self.current_sl = new_sl
        log_alert(f"🎯 {source}: SL updated to {new_sl}")
        return True

    def apply_breakeven(self, fee_pct=0.0005):
        if self.breakeven_applied:
            return False

        if self.side == "LONG":
            be = self.entry * (1 + fee_pct)
        else:
            be = self.entry * (1 - fee_pct)

        if self.update_sl(be, "Breakeven"):
            self.breakeven_applied = True
            return True
        return False

    def apply_trailing(self, mark_price, callback_pct=0.005):
        # Update extreme
        if self.side == "LONG":
            self.extreme_price = max(self.extreme_price, mark_price)
            new_sl = self.extreme_price * (1 - callback_pct)
        else:
            self.extreme_price = min(self.extreme_price, mark_price)
            new_sl = self.extreme_price * (1 + callback_pct)

        return self.update_sl(new_sl, "Trail Stop")
```

---

**Bottom line:** The `can_update_sl` guard is the single most important fix. Add it today, and both LONG and SHORT positions will stop bleeding back their profits.
User: Now can you build a prompt to fix these issues using an high performance reasoning modle like claude 4.8
Kimi: Here is a production-ready prompt you can drop into Claude 4.8 (or any high-performance reasoning model). It is structured to produce correct, reviewable code with zero ambiguity.

---

```markdown
# ROLE
You are a senior quantitative systems engineer specializing in crypto derivatives trading infrastructure. You write defensive, deterministic code for Binance USD-M futures. You never assume "the exchange will handle it" — you enforce all invariants locally.

# CONTEXT
We operate a paper-trading bot that monitors open positions via a Position Manager polling every 30 seconds. The bot manages stop-loss (SL) logic with two modules:
1. **Breakeven Module** — moves SL to breakeven once price hits a profit threshold.
2. **Trailing Stop Module** — moves SL to lock in profits as price moves favorably.

Positions are stored in-memory and alerts are dispatched to a Telegram channel.

# CRITICAL BUGS IDENTIFIED FROM PRODUCTION LOGS
The following log entries prove the current system is dangerously broken. You must fix the root causes.

## Log Evidence
```

12:34 — ETH LONG Entry: 1555.81 | SL: 1555.81
12:35 — Breakeven: SL → 1639.03
12:36 — Breakeven: SL → 1597.81
12:36 — Breakeven: SL → 1555.81 (entry)
12:40 — Breakeven: SL → 1557.37
12:54 — Trail Stop: SL → 1593.77
12:57 — Trail Stop: SL → 1611.97
12:59 — Breakeven: SL → 1555.81 (OVERWROTE higher trailing stop!)
12:42 — BTC LONG Entry: 60605.80 | SL: 60605.80
12:56 — Trail Stop: SL → 62095.00
12:57 — Breakeven: SL → 60666.41 (OVERWROTE higher trailing stop!)
01:02 — Breakeven: SL → 60593.80 (BELOW entry!)
01:05 — Breakeven: SL → 60605.80 (back to entry)

```

## Bug List (fix ALL of these)
1. **SL Reversal Bug (CRITICAL):** For a LONG, once SL is raised, it must NEVER be lowered again. For a SHORT, once SL is lowered, it must NEVER be raised again. The current system allows breakeven and trailing modules to overwrite each other with worse values.
2. **Breakeven Spam (CRITICAL):** Breakeven fires repeatedly every 1–2 minutes with different, non-deterministic values. It must fire exactly ONCE per position.
3. **State Loss on Restart (CRITICAL):** The Position Manager crashes/restarts frequently ("Position Manager Started" appears multiple times). On restart, it re-discovers existing positions and treats them as new, resetting SL logic from scratch.
4. **Duplicate "Position Opened" Alerts:** The same position triggers "Position Opened" alerts repeatedly after every restart.
5. **Currency Formatting Bug:** Alerts mix USDT and ₹ symbols for the same position.
6. **Breakeven Math Error:** Breakeven values are sometimes above entry, sometimes below, sometimes at entry — the calculation is inconsistent.

# REQUIRED ARCHITECTURE & FIXES

## 1. Directional SL Guard (The Non-Negotiable Invariant)
Before ANY module updates the SL, it must pass through a directional gate:

```python
def is_sl_improvement(position, proposed_sl: float) -> bool:
    """
    Returns True only if the proposed SL is strictly better than current.
    """
    if position.side == "LONG":
        return proposed_sl > position.current_sl
    elif position.side == "SHORT":
        return proposed_sl < position.current_sl
    return False
```

**Rule:** If `is_sl_improvement()` returns False, the update is **silently rejected**. No alert. No log spam. No exception.

## 2. Position State Schema

Every position must maintain this exact state in a persistent store (Redis, SQLite, or flat file — your choice, but it must survive process restarts):

```python
class PositionState:
    position_id: str          # Exchange position ID
    symbol: str               # e.g., "ETHUSDT"
    side: str                 # "LONG" or "SHORT"
    entry_price: float
    size: float
    leverage: int
    margin: float
    current_sl: float         # The SL currently on the exchange
    breakeven_applied: bool   # True once breakeven has been set
    trailing_activated: bool  # True once trailing stop is active
    extreme_price: float      # Highest price for LONG, lowest for SHORT
    created_at: datetime
    opened_alert_sent: bool   # True if "Position Opened" alert already fired
```

## 3. Breakeven Module (One-Shot, Deterministic)

- **Trigger condition (LONG):** `mark_price >= entry_price * (1 + trigger_pct)` (default trigger_pct = 0.5%)
- **Trigger condition (SHORT):** `mark_price <= entry_price * (1 - trigger_pct)`
- **Formula (LONG):** `breakeven_sl = entry_price * (1 + fee_estimate)` where fee_estimate accounts for open/close fees (default 0.06%)
- **Formula (SHORT):** `breakeven_sl = entry_price * (1 - fee_estimate)`
- **Behavior:** Check `breakeven_applied` first. If already True, return immediately. If False, compute, pass through `is_sl_improvement()`, update exchange SL, set `breakeven_applied = True`, send ONE alert.
- **Alert format:** `🛡️ Breakeven | {symbol} {side} | SL locked at {sl}`

## 4. Trailing Stop Module

- **Callback distance:** Configurable percentage (default 0.5%)
- **LONG behavior:** Track `extreme_price = max(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 - callback_pct)`.
- **SHORT behavior:** Track `extreme_price = min(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 + callback_pct)`.
- **Behavior:** Pass proposed SL through `is_sl_improvement()`. If approved, update exchange SL, update `current_sl`, send alert.
- **Alert format:** `🎯 Trail Stop | {symbol} {side} | SL trailed to {sl}`

## 5. Position Manager Lifecycle

On startup:

1. Load all `PositionState` from persistent store.
2. Fetch open positions from exchange API.
3. For each exchange position:
   - If exists in state AND `state.current_sl == exchange_sl`: use state as-is.
   - If exists in state BUT `state.current_sl != exchange_sl`: sync from exchange (exchange wins), update state.
   - If NOT in state: create new `PositionState`, set `current_sl = exchange_sl`, `extreme_price = entry_price`, `opened_alert_sent = False`.
4. Only send "Position Opened" alert if `opened_alert_sent == False`. Immediately set it to True after sending.

On each poll (every 30s):

1. Refresh mark prices.
2. For each position, run Breakeven Module (if not yet applied).
3. For each position, run Trailing Stop Module.
4. Persist state to disk after every poll (or at least after any SL change).

## 6. Alert Dispatcher Rules

- Determine quote currency from symbol suffix (USDT → USDT, INR → ₹). Never mix.
- "Position Opened" alert fires exactly once per position ID.
- "Breakeven" alert fires exactly once per position ID.
- "Trail Stop" alert fires only when `current_sl` actually changes.
- Include `position_id` in every alert for traceability.

# OUTPUT REQUIREMENTS

Provide the complete, production-ready implementation in Python. Structure it as:

1. **Data Models** (Pydantic or dataclasses)
2. **PositionStore** (abstract class + one concrete implementation using SQLite or JSON file)
3. **SLGuard** (the directional validation function)
4. **BreakevenModule** (class with `run(position, mark_price)`)
5. **TrailingStopModule** (class with `run(position, mark_price)`)
6. **PositionManager** (orchestrator with `startup()` and `poll()`)
7. **AlertDispatcher** (simple formatter, no Telegram boilerplate needed)
8. **Test Suite** covering the 8 scenarios below.

# TEST SUITE (must all pass)

Write pytest tests for these exact scenarios:

1. `test_long_sl_never_reverses`: LONG SL at 1600. Proposed 1550. Rejected.
2. `test_short_sl_never_reverses`: SHORT SL at 60000. Proposed 61000. Rejected.
3. `test_breakeven_fires_once`: Breakeven triggers. Second call is no-op.
4. `test_breakeven_overwrite_trailing`: LONG trailing SL at 1610. Breakeven computes 1557. Rejected.
5. `test_restart_preserves_sl`: State has SL=1610. Exchange returns SL=1610. Manager loads and preserves it.
6. `test_restart_syncs_exchange_sl`: State has SL=1610. Exchange returns SL=1620. Manager syncs to 1620.
7. `test_short_trailing_stop`: SHORT entry 60000. Price drops to 58000. Trailing SL moves to 58290. Price bounces to 59000. SL stays at 58290.
8. `test_duplicate_open_alert`: Same position ID on restart. "Position Opened" alert fires exactly once.

# CONSTRAINTS

- No external dependencies beyond `requests`, `pydantic`, and `pytest`.
- All floating-point math must use `Decimal` or round to 4 decimal places for prices.
- The code must be deterministic. No randomness. No race conditions in state updates.
- Include type hints everywhere.
- Add docstrings explaining the directional invariants.

# FINAL CHECK

Before outputting, verify mentally:

- [ ] Can a LONG SL ever decrease? → NO
- [ ] Can a SHORT SL ever increase? → NO
- [ ] Can breakeven fire twice? → NO
- [ ] Can "Position Opened" fire twice for the same ID? → NO
- [ ] Does state survive a process restart? → YES
- [ ] Are all 8 tests passing? → YES

```

---

**Copy-paste the block above directly into Claude.** It contains the log evidence, the exact state schema, the directional guard rules, and the test cases — so the model has zero room to hallucinate behavior.
User: And what if we are adding /removing from open postion (partial exits) increasing postions size etc
Want all things needs to be handled ?
Kimi: Here is the expanded prompt that handles **full position lifecycle** — partial exits, scaling in, average entry recalculation, realized PnL tracking, and SL re-evaluation on every size change.

---

```markdown
# ROLE
You are a senior quantitative systems engineer specializing in crypto derivatives trading infrastructure. You write defensive, deterministic code for Binance USD-M futures. You never assume "the exchange will handle it" — you enforce all invariants locally.

# CONTEXT
We operate a paper-trading bot that monitors open positions via a Position Manager polling every 30 seconds. The bot manages:
1. **Position Lifecycle** — entries, partial exits, scaling in (adding size), full exits.
2. **Breakeven Module** — moves SL to breakeven once price hits a profit threshold.
3. **Trailing Stop Module** — moves SL to lock in profits as price moves favorably.

Positions are stored in a persistent state store. Alerts are dispatched to Telegram.

# CRITICAL BUGS IDENTIFIED FROM PRODUCTION LOGS
The following log entries prove the current system is dangerously broken. You must fix the root causes.

## Log Evidence
```

12:34 — ETH LONG Entry: 1555.81 | Size: 0.4356 | SL: 1555.81
12:35 — Breakeven: SL → 1639.03
12:36 — Breakeven: SL → 1597.81
12:36 — Breakeven: SL → 1555.81 (entry)
12:40 — Breakeven: SL → 1557.37
12:54 — Trail Stop: SL → 1593.77
12:57 — Trail Stop: SL → 1611.97
12:59 — Breakeven: SL → 1555.81 (OVERWROTE higher trailing stop!)
12:42 — BTC LONG Entry: 60605.80 | Size: 0.0112 | SL: 60605.80
12:56 — Trail Stop: SL → 62095.00
12:57 — Breakeven: SL → 60666.41 (OVERWROTE higher trailing stop!)
01:02 — Breakeven: SL → 60593.80 (BELOW entry!)
01:05 — Breakeven: SL → 60605.80 (back to entry)

```

## Bug List (fix ALL of these)
1. **SL Reversal Bug (CRITICAL):** For a LONG, once SL is raised, it must NEVER be lowered again. For a SHORT, once SL is lowered, it must NEVER be raised again.
2. **Breakeven Spam (CRITICAL):** Breakeven fires repeatedly with different, non-deterministic values. It must fire exactly ONCE per position leg.
3. **State Loss on Restart (CRITICAL):** The Position Manager crashes/restarts frequently. On restart, it re-discovers existing positions and treats them as new, resetting SL logic.
4. **Duplicate "Position Opened" Alerts:** Same position triggers "Position Opened" repeatedly after every restart.
5. **Currency Formatting Bug:** Alerts mix USDT and ₹ symbols for the same position.
6. **Breakeven Math Error:** Breakeven values are inconsistent because average entry is not tracked correctly after partial fills.

# NEW REQUIREMENT: FULL POSITION LIFECYCLE MANAGEMENT
The bot must correctly handle the following position modifications, which are common in active trading:

## 1. Partial Exit (Reducing Position Size)
- **Behavior:** User closes 50% of the position at current market price.
- **Average Entry:** Remains unchanged at the original weighted average.
- **Realized PnL:** The closed portion's PnL is booked immediately and tracked separately.
- **Remaining Size:** Updated. Margin reduces proportionally.
- **Stop Loss:** Remains at the SAME price level. The SL does NOT move just because size decreased.
- **Trailing Stop:** `extreme_price` continues tracking from its previous value. No reset.
- **Breakeven Flag:** `breakeven_applied` remains True if it was already set.
- **Alert:** `📉 Partial Exit | {symbol} {side} | Closed {size} @ {price} | Realized: {pnl} | Remaining: {size}`

## 2. Scaling In (Adding to Position / Increasing Size)
- **Behavior:** User adds more contracts to an existing open position at a new price.
- **Average Entry:** Must be recalculated as a weighted average:
  ```

  new_avg_entry = (old_size *old_avg_entry + added_size* fill_price) / (old_size + added_size)

  ```
- **Total Size:** Increases.
- **Total Margin:** Increases proportionally.
- **Realized PnL:** Unaffected (this is just adding, not closing).
- **Stop Loss Re-evaluation (CRITICAL):**
  - The breakeven point changes because the average entry changed.
  - The current SL must be checked against the NEW breakeven calculation.
  - If `current_sl < new_breakeven` for a LONG, the SL must be raised to at least the new breakeven.
  - If `current_sl > new_breakeven` for a SHORT, the SL must be lowered to at most the new breakeven.
  - The `breakeven_applied` flag should be reset to `False` if the new average entry changes the breakeven math significantly (i.e., if the new breakeven is above the current SL for a LONG, or below for a SHORT).
  - However, the SL must NEVER be moved in a worse direction than before. Use the directional guard.
- **Trailing Stop:** `extreme_price` continues tracking from its previous value. No reset.
- **Alert:** `📈 Scale In | {symbol} {side} | Added {size} @ {price} | New Avg Entry: {avg_entry} | Total Size: {size}`

## 3. Full Exit (Position Close)
- **Behavior:** Position is fully closed.
- **Realized PnL:** Final portion booked.
- **State:** Position removed from active state store. Moved to closed positions history.
- **Trailing/Breakeven:** Modules stop processing.
- **Alert:** `🔴 Position Closed | {symbol} {side} | Exit: {price} | Total Realized: {pnl} | Duration: {time}`

## 4. Position Reversal (Close Long → Open Short, or vice versa)
- **Behavior:** Exchange reports position in opposite direction.
- **Process:** Close old position fully (book realized PnL), then create new position state for the opposite side.
- **State:** Old position archived. New position initialized with fresh state.

## 5. Realized PnL Tracking
- Every partial exit or full close must book realized PnL:
  ```

  realized_pnl = closed_size *(close_price - avg_entry)* side_multiplier

# side_multiplier: LONG = +1, SHORT = -1

  ```
- Track cumulative realized PnL per position.
- Track daily realized PnL globally.
- Do NOT confuse realized PnL with unrealized PnL (mark-to-market).

## 6. Margin Recalculation
- On every size change:
  ```

  margin = (avg_entry * total_size) / leverage

  ```
- This must be recalculated and stored after every partial exit or scale-in.

# REQUIRED ARCHITECTURE & FIXES

## 1. Directional SL Guard (The Non-Negotiable Invariant)
Before ANY module updates the SL, it must pass through a directional gate:

```python
def is_sl_improvement(position, proposed_sl: float) -> bool:
    """
    Returns True only if the proposed SL is strictly better than current.
    """
    if position.side == "LONG":
        return proposed_sl > position.current_sl
    elif position.side == "SHORT":
        return proposed_sl < position.current_sl
    return False
```

**Rule:** If `is_sl_improvement()` returns False, the update is **silently rejected**. No alert. No log spam. No exception.

## 2. Position State Schema (Persistent)

Every position must maintain this exact state. It must survive process restarts.

```python
class PositionLeg:
    fill_price: float
    size: float
    timestamp: datetime

class PositionState:
    position_id: str              # Exchange position ID
    symbol: str                   # e.g., "ETHUSDT"
    side: str                     # "LONG" or "SHORT"
    avg_entry_price: float        # Weighted average of ALL fills
    total_size: float             # Current open size
    leverage: int
    margin: float                 # (avg_entry * total_size) / leverage
    current_sl: float             # The SL currently on the exchange
    breakeven_applied: bool       # True once breakeven has been set
    breakeven_price: float        # The actual breakeven price computed
    trailing_activated: bool      # True once trailing stop is active
    extreme_price: float          # Highest price for LONG, lowest for SHORT
    realized_pnl: float           # Cumulative realized PnL for this position
    legs: List[PositionLeg]     # All fills (entries and scale-ins)
    partial_exits: List[PositionLeg]  # All partial close fills
    created_at: datetime
    opened_alert_sent: bool       # True if "Position Opened" alert already fired
    last_updated: datetime
```

## 3. Position Lifecycle Engine

### On Position Open (First Fill)

1. Create `PositionState` with `avg_entry_price = fill_price`, `total_size = fill_size`.
2. `extreme_price = fill_price`.
3. `current_sl = exchange_sl` (or entry if none set).
4. `opened_alert_sent = False` → send alert, then set to `True`.

### On Scale In (Additional Fill)

1. Record new leg in `legs`.
2. Recalculate:

   ```
   new_avg = (old_size * old_avg + new_size * fill_price) / (old_size + new_size)
   ```

3. Update `total_size`, `margin`.
4. **Recalculate breakeven:**

   ```
   if side == "LONG":
       new_be = new_avg * (1 + fee_estimate)
   else:
       new_be = new_avg * (1 - fee_estimate)
   ```

5. **Evaluate SL:**
   - If `breakeven_applied == True` AND `new_be` is worse than `current_sl` (for LONG: `new_be > current_sl` is impossible because current_sl >= old_be, but if new_avg dropped, new_be might drop below current_sl — that's fine, SL stays).
   - If `breakeven_applied == True` AND `new_be` is better than `current_sl` (for LONG: `new_be > current_sl`), raise SL to `new_be` and update `breakeven_price`.
   - If `breakeven_applied == False`, check if price is past trigger. If yes, compute `new_be` and apply.
6. `extreme_price` remains unchanged (do NOT reset).
7. Persist state. Send Scale In alert.

### On Partial Exit

1. Record exit in `partial_exits`.
2. Calculate realized PnL for this exit:

   ```
   exit_pnl = exit_size * (exit_price - avg_entry_price) * (1 if LONG else -1)
   ```

3. Add to `realized_pnl`.
4. Reduce `total_size`.
5. Recalculate `margin = (avg_entry * total_size) / leverage`.
6. **Average entry price does NOT change.**
7. `current_sl` stays the same.
8. `extreme_price` stays the same.
9. If `total_size == 0`, trigger Full Exit.
10. Persist state. Send Partial Exit alert.

### On Full Exit

1. Calculate final realized PnL for remaining size.
2. Add to `realized_pnl`.
3. Move position to `ClosedPositions` history store.
4. Remove from active `PositionState` store.
5. Send Position Closed alert.

## 4. Breakeven Module (One-Shot Per Average Entry)

- **Trigger condition (LONG):** `mark_price >= avg_entry * (1 + trigger_pct)`
- **Trigger condition (SHORT):** `mark_price <= avg_entry * (1 - trigger_pct)`
- **Formula (LONG):** `breakeven_sl = avg_entry * (1 + fee_estimate)` (default fee_estimate = 0.06%)
- **Formula (SHORT):** `breakeven_sl = avg_entry * (1 - fee_estimate)`
- **Behavior:**
  1. If `breakeven_applied == True` AND `breakeven_price == current_sl`: return (already set).
  2. If `breakeven_applied == True` BUT `breakeven_price != current_sl` (e.g., after scale-in changed avg_entry): recompute `new_be`, pass through `is_sl_improvement()`, update if approved.
  3. If `breakeven_applied == False`: compute, pass through guard, update if approved, set `breakeven_applied = True`, `breakeven_price = new_be`, send alert.
- **Alert format:** `🛡️ Breakeven | {symbol} {side} | Avg Entry: {avg_entry} | SL locked at {sl}`

## 5. Trailing Stop Module

- **Callback distance:** Configurable percentage (default 0.5%)
- **LONG behavior:** Track `extreme_price = max(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 - callback_pct)`.
- **SHORT behavior:** Track `extreme_price = min(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 + callback_pct)`.
- **Behavior:** Pass proposed SL through `is_sl_improvement()`. If approved, update exchange SL, update `current_sl`, send alert.
- **Important:** `extreme_price` is NEVER reset on scale-in or partial exit. It tracks the lifetime extreme of the position.
- **Alert format:** `🎯 Trail Stop | {symbol} {side} | SL trailed to {sl} | Extreme: {extreme_price}`

## 6. Position Manager Lifecycle

### On Startup

1. Load all `PositionState` from persistent store.
2. Fetch open positions from exchange API.
3. For each exchange position:
   - Match by `position_id`.
   - If found in state: compare `total_size` and `avg_entry_price`.
     - If exchange size > state size: treat difference as scale-in. Run Scale In logic.
     - If exchange size < state size: treat difference as partial exit. Run Partial Exit logic.
     - If exchange size == state size but `current_sl` differs: sync SL from exchange (exchange wins).
   - If NOT in state: create new `PositionState` from exchange data.
4. Send "Position Opened" alert only if `opened_alert_sent == False`.

### On Each Poll (every 30s)

1. Fetch current positions and mark prices from exchange.
2. Detect position changes (size changes = partial exit or scale-in).
3. Process any lifecycle events first (exit/scale).
4. For each active position, run Breakeven Module.
5. For each active position, run Trailing Stop Module.
6. Persist state after every poll (or at least after any mutation).

## 7. Alert Dispatcher Rules

- Determine quote currency from symbol suffix (USDT → USDT, INR → ₹). Never mix.
- "Position Opened" — exactly once per position ID.
- "Scale In" — every time size increases.
- "Partial Exit" — every time size decreases but > 0.
- "Position Closed" — once when size reaches 0.
- "Breakeven" — when `breakeven_applied` flips from False to True, or when breakeven is recalculated after scale-in.
- "Trail Stop" — only when `current_sl` actually changes.
- Include `position_id`, `avg_entry`, `total_size`, `realized_pnl` in every alert.

# OUTPUT REQUIREMENTS

Provide the complete, production-ready implementation in Python. Structure it as:

1. **Data Models** (Pydantic or dataclasses: `PositionLeg`, `PositionState`, `ClosedPosition`)
2. **PositionStore** (abstract class + concrete SQLite/JSON implementation with full CRUD)
3. **SLGuard** (directional validation)
4. **BreakevenModule** (class with `run(position, mark_price)`)
5. **TrailingStopModule** (class with `run(position, mark_price)`)
6. **PositionLifecycleEngine** (handles open, scale_in, partial_exit, full_exit)
7. **PositionManager** (orchestrator with `startup()`, `poll()`, `sync_with_exchange()`)
8. **AlertDispatcher** (formatter with all alert types)
9. **Test Suite** covering all 15 scenarios below.

# TEST SUITE (must all pass)

## SL Guard Tests

1. `test_long_sl_never_reverses`: LONG SL at 1600. Proposed 1550. Rejected.
2. `test_short_sl_never_reverses`: SHORT SL at 60000. Proposed 61000. Rejected.

## Breakeven Tests

1. `test_breakeven_fires_once`: Breakeven triggers. Second call is no-op.
2. `test_breakeven_overwrite_trailing`: LONG trailing SL at 1610. Breakeven computes 1557. Rejected.
3. `test_breakeven_after_scale_in`: LONG entry 1500, scale in at 1600, new avg 1550. Breakeven recalculates to ~1551. Applied if > current SL.

## State Persistence Tests

1. `test_restart_preserves_sl`: State has SL=1610. Exchange returns same size and SL. Manager preserves it.
2. `test_restart_syncs_exchange_sl`: State has SL=1610. Exchange returns SL=1620. Manager syncs to 1620.
3. `test_restart_detects_scale_in`: State size=0.4, exchange size=0.6. Manager detects scale-in, recalculates avg entry.

## Trailing Stop Tests

1. `test_short_trailing_stop`: SHORT entry 60000. Price drops to 58000. Trailing SL moves to 58290. Price bounces to 59000. SL stays at 58290.
2. `test_long_trailing_after_scale_in`: LONG entry 1500, scale in at 1600. Price hits 1700. Trailing SL moves to 1691.5. Extreme price was 1700, not reset by scale-in.

## Partial Exit Tests

1. `test_partial_exit_avg_entry_unchanged`: Entry 1500, size 1.0. Partial exit 0.5 at 1600. Avg entry remains 1500. Realized PnL = +50.
2. `test_partial_exit_sl_unchanged`: Entry 1500, SL 1490. Partial exit 50%. SL remains 1490.
3. `test_partial_exit_trailing_extreme_unchanged`: Extreme was 1700. Partial exit. Extreme remains 1700.

## Scale In Tests

1. `test_scale_in_recalculates_avg_entry`: Entry 1500 size 1.0, scale in 1600 size 1.0. New avg = 1550.
2. `test_scale_in_margin_recalculated`: Entry 1500 size 1.0 leverage 5. Margin=300. Scale in 1600 size 1.0. New margin = (1550*2.0)/5 = 620.

## Full Lifecycle Tests

1. `test_full_exit_books_realized_pnl`: Position entry 1500 size 1.0. Close at 1600. Realized PnL = +100. Position archived.
2. `test_position_reversal`: LONG ETH size 1.0. Exchange now shows SHORT ETH size 0.5. Old position closed with PnL. New SHORT position created.

# CONSTRAINTS

- No external dependencies beyond `requests`, `pydantic`, and `pytest`.
- All floating-point math must use `Decimal` or round to 4 decimal places for prices.
- The code must be deterministic. No randomness. No race conditions in state updates.
- Include type hints everywhere.
- Add docstrings explaining the directional invariants and the lifecycle rules.

# FINAL CHECK

Before outputting, verify mentally:

- [ ] Can a LONG SL ever decrease? → NO
- [ ] Can a SHORT SL ever increase? → NO
- [ ] Can breakeven fire twice without a scale-in? → NO
- [ ] Does partial exit change average entry? → NO
- [ ] Does scale-in recalculate average entry? → YES
- [ ] Does scale-in reset extreme_price? → NO
- [ ] Does partial exit reset extreme_price? → NO
- [ ] Does state survive a process restart? → YES
- [ ] Are all 17 tests passing? → YES

```

---

**Key additions from the previous version:**
- **`PositionLeg` tracking** — every fill is recorded for audit and PnL accuracy.
- **Scale-in logic** — weighted average recalculation, breakeven re-evaluation, margin update.
- **Partial exit logic** — realized PnL booking, size reduction, average entry preservation.
- **Full exit & reversal** — position archival, state cleanup.
- **Exchange sync on startup** — detects size changes that happened while the manager was down.
- **17 test cases** covering the full lifecycle, not just SL management.

Drop this into Claude 4.8 and it will produce a complete, battle-tested position management engine.
User: Verdict

Partly correct, but the first diagnosis is wrong.

Correct

The ROE math you wrote is consistent:

24.38 / 135.57 ≈ 17.98%


For a LONG trailing stop, the stop-loss can absolutely move above entry once the trade is in profit.

Your guard rule idea is correct:

LONG: SL must never move down

SHORT: SL must never move up



Incorrect

This part is wrong:

> “For a LONG position, the Stop Loss must be below the entry price to protect against downside.”



That is only true for a static initial stop. It is not true for a trailing stop.

For a LONG:

SL must stay below current price

SL may be below entry, at entry, or above entry

If price has already moved far enough, a trailing SL above entry is normal


So this statement is correct instead:

> For a LONG trailing stop, the stop-loss can move above entry after the position is in profit, but it must always remain below the current market price.



The real issue in your logs

If the trailing SL is 1611.97 and the current price is still above it, the position is valid.

If the current price is below 1611.97 and the position is still open, then one of these is true:

the log is stale,

the SL was not actually placed on the exchange,

the system lost state,

or the order update failed.


Stronger diagnosis

Your later conclusion is the right one:

Breakeven overwriting trailing stop is a bug

SL must never move in the unfavorable direction

For LONGs, use:


new_sl = max(current_sl, proposed_sl)

For SHORTs:

new_sl = min(current_sl, proposed_sl)

One more correction

This part is also shaky:

> “Current price (implied) = 1555.81 + (24.38 / 0.4356)”



That is only a rough inference from the PnL/position size, not a guaranteed current price. It ignores contract specifics, fees, and whether the PnL is mark-based or last-trade-based.

Final answer

Yes, the trailing-stop explanation is correct.
No, the claim that a LONG SL must be below entry is not correct once trailing begins.
The true invariant is:

LONG: SL can rise, never fall

SHORT: SL can fall, never rise

SL must always stay on the profitable side of the current price


If needed, I can rewrite your full explanation into a clean, technically correct incident note.
Incident Note: Trailing Stop / Breakeven Stop-Loss Behavior

Summary

The stop-loss logic is not fundamentally wrong because the LONG stop-loss is above entry. That behavior is valid for a trailing stop once the position is in profit.

The actual defect is different:

The trailing stop is being overwritten by breakeven logic

The stop-loss is moving in the wrong direction

The position manager appears to be losing state across restarts

As a result, the system is recomputing and reapplying stop-loss values inconsistently


What is correct

The PnL and margin math shown in the logs is internally consistent.

Example:

24.38 / 135.57 ≈ 17.98% ROE


That is fine.

Also, for a LONG trailing stop, it is valid for the stop-loss to move:

above the entry price

as long as it remains below the current market price


So this is not an error by itself:

Entry: 1555.81

Trailing SL: 1611.97


That simply means the trade has already moved into profit and the stop has locked in gains.

What is wrong

The dangerous behavior is this:

1. Breakeven is overwriting a better trailing stop

A trailing stop had already moved the SL upward.
Later, breakeven logic moved it back down to entry or near entry.

That is a bug.

For a LONG position:

SL may move up

SL must never move down


For a SHORT position:

SL may move down

SL must never move up


Root cause

The system is missing a directional guard.
Every stop-loss update must be validated against the current SL before applying it.

Required invariant:

LONG: new_sl > current_sl only

SHORT: new_sl < current_sl only


If the proposed SL is worse than the current SL, it must be rejected.

Secondary issue

The position manager appears to be restarting or losing memory of active positions.

Symptoms:

“Position Manager Started” appears multiple times

“Position Opened” alerts repeat for the same live position

Breakeven gets recalculated repeatedly from scratch


That suggests state is not being preserved reliably across process restarts.

Correct interpretation of the stop-loss behavior

For a LONG trade:

Initial SL is usually below entry

Breakeven may move SL to entry or slightly above entry

Trailing stop may move SL further above entry

The SL must always remain below current price

The SL must never move backward


So the real rule is:

> A LONG stop-loss can move above entry, but it can never move downward once raised.



Immediate fix required

Implement a directional stop-loss guard before every SL update:

if position.side == "LONG":
    return proposed_sl > position.current_sl
else:
    return proposed_sl < position.current_sl

Then enforce:

new_sl = max(current_sl, proposed_sl)   # LONG
new_sl = min(current_sl, proposed_sl)   # SHORT

Conclusion

The original claim that a LONG stop-loss must always stay below entry is incorrect for trailing stops.

The actual incident is:

breakeven is overwriting trailing stop

stop-loss directionality is not enforced

position state is likely being lost on restart


That is the problem to fix.
Kimi: You are exactly right, and I appreciate the correction.

**I was wrong in my initial response** when I said a LONG stop-loss must be below the entry price. That is only true for the initial static stop. Once a trailing stop is active and the position is in profit, the SL moving above entry is the **intended behavior** — it is how the system locks in gains.

Your corrected framing is the accurate one:

| Direction | Invariant |
|-----------|-----------|
| **LONG** | SL can only move **up** (higher). Never down. `new_sl = max(current_sl, proposed_sl)` |
| **SHORT** | SL can only move **down** (lower). Never up. `new_sl = min(current_sl, proposed_sl)` |

The real defects in the logs are exactly what you identified:

1. **Breakeven overwriting the trailing stop** — the SL was raised to 1611.97 by the trailing module, then later pushed back down to 1555.81 by breakeven. That violates the directional guard.
2. **State loss on restart** — the "Position Manager Started" and repeated "Position Opened" alerts confirm the process is losing its memory of live positions and reprocessing them from scratch.
3. **Breakeven firing repeatedly** — without a `breakeven_applied` flag persisted to disk, it recalculates and spams alerts every poll cycle.

Your incident note is clean and technically correct. I will use that framing — **trailing SL above entry is valid, but SL must never reverse direction** — in any future analysis of this system.

If you want, I can now regenerate the prompt for the reasoning model using your corrected technical description instead of my earlier one.
User: Yes
Kimi: Here is the corrected, technically accurate prompt incorporating your fixes.

---

```markdown
# ROLE
You are a senior quantitative systems engineer specializing in crypto derivatives trading infrastructure. You write defensive, deterministic code for Binance USD-M futures. You enforce all invariants locally and never trust the exchange to maintain state for you.

# CONTEXT
We operate a paper-trading bot that monitors open positions via a Position Manager polling every 30 seconds. The bot manages:
1. **Position Lifecycle** — entries, partial exits, scaling in (adding size), full exits, reversals.
2. **Breakeven Module** — moves SL to breakeven once price hits a profit threshold.
3. **Trailing Stop Module** — moves SL to lock in profits as price moves favorably.

Positions are stored in a persistent state store. Alerts are dispatched to Telegram.

# CORRECTED UNDERSTANDING OF TRAILING STOP BEHAVIOR

## What is NOT a bug
For a **LONG** position, the stop-loss being **above the entry price** is **valid and expected** once a trailing stop is active and the trade is in profit.

- **Initial static SL** for a LONG: below entry (protects against downside at entry).
- **Breakeven SL** for a LONG: at or slightly above entry (covers fees).
- **Trailing SL** for a LONG: can be **well above entry** (locks in profit).
- **The only requirement:** the SL must remain **below the current market price** so the position is not immediately stopped out.

Therefore, this log entry is **not inherently wrong**:
```

Entry: 1555.81 | Trailing SL: 1611.97

```
This simply means the trade moved into profit and the trailing stop has locked in ~56 USDT of gain.

## The REAL invariant
The stop-loss must **only move in the profitable direction** and **never reverse**.

| Direction | SL may only move... | Guard Formula |
|-----------|---------------------|---------------|
| **LONG** | **UP** (higher) | `new_sl = max(current_sl, proposed_sl)` |
| **SHORT** | **DOWN** (lower) | `new_sl = min(current_sl, proposed_sl)` |

If a proposed SL violates this directional rule, it must be **silently rejected** with no update and no alert.

## What IS a bug
The logs show the SL moving **backward** (down for a LONG, up for a SHORT), which is never allowed.

**ETH LONG evidence:**
```

12:54 — Trail Stop: SL → 1593.77
12:57 — Trail Stop: SL → 1611.97
12:59 — Breakeven: SL → 1555.81   ← BACKWARD! Rejected by guard.

```

**BTC LONG evidence:**
```

12:56 — Trail Stop: SL → 62095.00
12:57 — Breakeven: SL → 60666.41  ← BACKWARD! Rejected by guard.
01:02 — Breakeven: SL → 60593.80  ← BACKWARD! Rejected by guard.
01:05 — Breakeven: SL → 60605.80  ← BACKWARD! Rejected by guard.

```

# COMPLETE BUG LIST

1. **SL Directional Guard Missing (CRITICAL):** The system allows breakeven and trailing modules to overwrite each other with worse values. For LONGs, SL is being lowered after it was raised. For SHORTs, the same bug would allow SL to be raised after it was lowered.
2. **Breakeven Spam (CRITICAL):** Breakeven fires repeatedly every 1–2 minutes with different values. It must fire exactly ONCE per average entry (reset only on scale-in).
3. **State Loss on Restart (CRITICAL):** The Position Manager restarts frequently ("Position Manager Started" appears multiple times). On restart, it re-discovers existing positions and treats them as new, resetting SL logic from scratch.
4. **Duplicate "Position Opened" Alerts:** Same position triggers "Position Opened" repeatedly after every restart.
5. **Currency Formatting Bug:** Alerts mix USDT and ₹ symbols for the same position.
6. **Breakeven Math Error:** Breakeven values are inconsistent because average entry is not tracked correctly after partial fills or scale-ins.

# FULL POSITION LIFECYCLE REQUIREMENTS

## 1. Partial Exit (Reducing Position Size)
- **Average Entry:** Remains unchanged at the original weighted average.
- **Realized PnL:** The closed portion's PnL is booked immediately:
  ```

  realized_pnl = exit_size *(exit_price - avg_entry)* (1 if LONG else -1)

  ```
- **Remaining Size:** Updated. Margin recalculated as `(avg_entry * remaining_size) / leverage`.
- **Stop Loss:** Remains at the SAME price level. SL does NOT move just because size decreased.
- **Trailing Stop:** `extreme_price` continues tracking from its previous value. No reset.
- **Breakeven Flag:** `breakeven_applied` remains True if it was already set.
- **Alert:** `📉 Partial Exit | {symbol} {side} | Closed {size} @ {price} | Realized: {pnl} | Remaining: {size}`

## 2. Scaling In (Adding to Position / Increasing Size)
- **Average Entry:** Must be recalculated as a weighted average:
  ```

  new_avg = (old_size *old_avg + added_size* fill_price) / (old_size + added_size)

  ```
- **Total Size & Margin:** Updated. `margin = (new_avg * total_size) / leverage`.
- **Stop Loss Re-evaluation (CRITICAL):**
  - The breakeven point changes because the average entry changed.
  - Recompute `new_breakeven = new_avg * (1 + fee_estimate)` for LONG, or `new_avg * (1 - fee_estimate)` for SHORT.
  - If `breakeven_applied == True` and `new_breakeven` is better than `current_sl` (for LONG: `new_breakeven > current_sl`), raise SL to `new_breakeven` using the directional guard.
  - If `new_breakeven` is worse than `current_sl`, the SL stays put (guard rejects it).
  - `breakeven_applied` remains True; update `breakeven_price` to the new value.
- **Trailing Stop:** `extreme_price` continues tracking from its previous value. No reset.
- **Alert:** `📈 Scale In | {symbol} {side} | Added {size} @ {price} | New Avg Entry: {avg_entry} | Total Size: {size}`

## 3. Full Exit (Position Close)
- **Realized PnL:** Final portion booked.
- **State:** Position removed from active store. Moved to closed positions history.
- **Alert:** `🔴 Position Closed | {symbol} {side} | Exit: {price} | Total Realized: {pnl} | Duration: {time}`

## 4. Position Reversal (Close Long → Open Short, or vice versa)
- **Process:** Close old position fully (book realized PnL), archive it, then create new position state for the opposite side with fresh state.

## 5. Realized PnL Tracking
- Every partial exit or full close must book realized PnL.
- Track cumulative realized PnL per position and daily realized PnL globally.
- Do NOT confuse realized PnL with unrealized PnL (mark-to-market).

# REQUIRED ARCHITECTURE

## 1. Directional SL Guard (Non-Negotiable)
Every SL update must pass through this gate:

```python
def apply_sl_update(position, proposed_sl: float) -> bool:
    """
    Returns True if the update is accepted.
    LONG: proposed_sl must be > current_sl
    SHORT: proposed_sl must be < current_sl
    """
    if position.side == "LONG":
        if proposed_sl > position.current_sl:
            position.current_sl = proposed_sl
            return True
        return False
    else:  # SHORT
        if proposed_sl < position.current_sl:
            position.current_sl = proposed_sl
            return True
        return False
```

**Rule:** If the guard returns False, the update is **silently rejected**. No alert. No exception. No log spam.

## 2. Position State Schema (Persistent)

Must survive process restarts.

```python
class PositionLeg:
    fill_price: float
    size: float
    timestamp: datetime

class PositionState:
    position_id: str              # Exchange position ID
    symbol: str                   # e.g., "ETHUSDT"
    side: str                     # "LONG" or "SHORT"
    avg_entry_price: float        # Weighted average of ALL fills
    total_size: float             # Current open size
    leverage: int
    margin: float                 # (avg_entry * total_size) / leverage
    current_sl: float             # The SL currently on the exchange
    breakeven_applied: bool       # True once breakeven has been set
    breakeven_price: float        # The actual breakeven price computed
    trailing_activated: bool      # True once trailing stop is active
    extreme_price: float          # Highest price for LONG, lowest for SHORT
    realized_pnl: float           # Cumulative realized PnL for this position
    legs: List[PositionLeg]       # All fills (entries and scale-ins)
    partial_exits: List[PositionLeg]  # All partial close fills
    created_at: datetime
    opened_alert_sent: bool       # True if "Position Opened" alert already fired
    last_updated: datetime
```

## 3. Position Lifecycle Engine

### On Position Open (First Fill)

1. Create `PositionState` with `avg_entry_price = fill_price`, `total_size = fill_size`.
2. `extreme_price = fill_price`.
3. `current_sl = exchange_sl` (or entry if none set).
4. `opened_alert_sent = False` → send alert, then set to `True`.

### On Scale In (Additional Fill)

1. Record new leg in `legs`.
2. Recalculate weighted average entry.
3. Update `total_size`, `margin`.
4. Recompute breakeven based on new `avg_entry_price`.
5. If `breakeven_applied == True` and new breakeven is better than `current_sl`, pass through guard and update.
6. `extreme_price` remains unchanged. Do NOT reset.
7. Persist state. Send Scale In alert.

### On Partial Exit

1. Record exit in `partial_exits`.
2. Calculate and add realized PnL.
3. Reduce `total_size`. Recalculate `margin`.
4. `avg_entry_price` does NOT change.
5. `current_sl` stays the same.
6. `extreme_price` stays the same.
7. If `total_size == 0`, trigger Full Exit.
8. Persist state. Send Partial Exit alert.

### On Full Exit

1. Calculate final realized PnL for remaining size.
2. Add to `realized_pnl`.
3. Move to `ClosedPositions` history store.
4. Remove from active store.
5. Send Position Closed alert.

## 4. Breakeven Module (One-Shot Per Average Entry)

- **Trigger condition (LONG):** `mark_price >= avg_entry * (1 + trigger_pct)`
- **Trigger condition (SHORT):** `mark_price <= avg_entry * (1 - trigger_pct)`
- **Formula (LONG):** `breakeven_sl = avg_entry * (1 + fee_estimate)` (default fee_estimate = 0.06%)
- **Formula (SHORT):** `breakeven_sl = avg_entry * (1 - fee_estimate)`
- **Behavior:**
  1. If `breakeven_applied == True` and `breakeven_price == current_sl`: return.
  2. If `breakeven_applied == True` but avg_entry changed (scale-in): recompute `new_be`, pass through guard, update if approved, update `breakeven_price`.
  3. If `breakeven_applied == False`: compute, pass through guard, update if approved, set `breakeven_applied = True`, `breakeven_price = new_be`, send alert.
- **Alert format:** `🛡️ Breakeven | {symbol} {side} | Avg Entry: {avg_entry} | SL locked at {sl}`

## 5. Trailing Stop Module

- **Callback distance:** Configurable percentage (default 0.5%)
- **LONG behavior:** Track `extreme_price = max(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 - callback_pct)`.
- **SHORT behavior:** Track `extreme_price = min(extreme_price, mark_price)`. Proposed SL = `extreme_price * (1 + callback_pct)`.
- **Behavior:** Pass proposed SL through `apply_sl_update()`. If accepted, update exchange SL, persist state, send alert.
- **Important:** `extreme_price` is NEVER reset on scale-in or partial exit. It tracks the lifetime extreme of the position.
- **Alert format:** `🎯 Trail Stop | {symbol} {side} | SL trailed to {sl} | Extreme: {extreme_price}`

## 6. Position Manager Lifecycle

### On Startup

1. Load all `PositionState` from persistent store.
2. Fetch open positions from exchange API.
3. For each exchange position:
   - Match by `position_id`.
   - If found in state: compare `total_size` and `avg_entry_price`.
     - If exchange size > state size: treat difference as scale-in. Run Scale In logic.
     - If exchange size < state size: treat difference as partial exit. Run Partial Exit logic.
     - If exchange size == state size but `current_sl` differs: sync SL from exchange (exchange wins), but respect the directional guard when updating state.
   - If NOT in state: create new `PositionState` from exchange data.
4. Send "Position Opened" alert only if `opened_alert_sent == False`.

### On Each Poll (every 30s)

1. Fetch current positions and mark prices from exchange.
2. Detect position changes (size changes = partial exit or scale-in).
3. Process any lifecycle events first (exit/scale).
4. For each active position, run Breakeven Module.
5. For each active position, run Trailing Stop Module.
6. Persist state after every poll (or at least after any mutation).

## 7. Alert Dispatcher Rules

- Determine quote currency from symbol suffix (USDT → USDT, INR → ₹). Never mix.
- "Position Opened" — exactly once per position ID.
- "Scale In" — every time size increases.
- "Partial Exit" — every time size decreases but > 0.
- "Position Closed" — once when size reaches 0.
- "Breakeven" — when `breakeven_applied` flips from False to True, or when breakeven is recalculated after scale-in.
- "Trail Stop" — only when `current_sl` actually changes.
- Include `position_id`, `avg_entry`, `total_size`, `realized_pnl` in every alert.

# OUTPUT REQUIREMENTS

Provide the complete, production-ready implementation in Python. Structure it as:

1. **Data Models** (Pydantic or dataclasses: `PositionLeg`, `PositionState`, `ClosedPosition`)
2. **PositionStore** (abstract class + concrete SQLite or JSON implementation with full CRUD)
3. **SLGuard** (directional validation function)
4. **BreakevenModule** (class with `run(position, mark_price)`)
5. **TrailingStopModule** (class with `run(position, mark_price)`)
6. **PositionLifecycleEngine** (handles open, scale_in, partial_exit, full_exit)
7. **PositionManager** (orchestrator with `startup()`, `poll()`, `sync_with_exchange()`)
8. **AlertDispatcher** (formatter with all alert types)
9. **Test Suite** covering all 18 scenarios below.

# TEST SUITE (must all pass)

## SL Guard Tests

1. `test_long_sl_never_reverses`: LONG SL at 1600. Proposed 1550. Rejected.
2. `test_short_sl_never_reverses`: SHORT SL at 60000. Proposed 61000. Rejected.
3. `test_long_sl_above_entry_is_valid`: LONG entry 1500, SL at 1600 (trailing). Guard accepts. This is NOT a bug.

## Breakeven Tests

1. `test_breakeven_fires_once`: Breakeven triggers. Second call is no-op.
2. `test_breakeven_overwrite_trailing`: LONG trailing SL at 1610. Breakeven computes 1557. Rejected by guard.
3. `test_breakeven_after_scale_in`: LONG entry 1500, scale in at 1600, new avg 1550. Breakeven recalculates to ~1551. Applied if > current SL.

## State Persistence Tests

1. `test_restart_preserves_sl`: State has SL=1610. Exchange returns same size and SL. Manager preserves it.
2. `test_restart_syncs_exchange_sl`: State has SL=1610. Exchange returns SL=1620. Manager syncs to 1620.
3. `test_restart_detects_scale_in`: State size=0.4, exchange size=0.6. Manager detects scale-in, recalculates avg entry.

## Trailing Stop Tests

1. `test_short_trailing_stop`: SHORT entry 60000. Price drops to 58000. Trailing SL moves to 58290. Price bounces to 59000. SL stays at 58290.
2. `test_long_trailing_after_scale_in`: LONG entry 1500, scale in at 1600. Price hits 1700. Trailing SL moves to 1691.5. Extreme price was 1700, not reset by scale-in.

## Partial Exit Tests

1. `test_partial_exit_avg_entry_unchanged`: Entry 1500, size 1.0. Partial exit 0.5 at 1600. Avg entry remains 1500. Realized PnL = +50.
2. `test_partial_exit_sl_unchanged`: Entry 1500, SL 1490. Partial exit 50%. SL remains 1490.
3. `test_partial_exit_trailing_extreme_unchanged`: Extreme was 1700. Partial exit. Extreme remains 1700.

## Scale In Tests

1. `test_scale_in_recalculates_avg_entry`: Entry 1500 size 1.0, scale in 1600 size 1.0. New avg = 1550.
2. `test_scale_in_margin_recalculated`: Entry 1500 size 1.0 leverage 5. Margin=300. Scale in 1600 size 1.0. New margin = (1550*2.0)/5 = 620.

## Full Lifecycle Tests

1. `test_full_exit_books_realized_pnl`: Position entry 1500 size 1.0. Close at 1600. Realized PnL = +100. Position archived.
2. `test_position_reversal`: LONG ETH size 1.0. Exchange now shows SHORT ETH size 0.5. Old position closed with PnL. New SHORT position created.

# CONSTRAINTS

- No external dependencies beyond `requests`, `pydantic`, and `pytest`.
- All floating-point math must use `Decimal` or round to 4 decimal places for prices.
- The code must be deterministic. No randomness. No race conditions in state updates.
- Include type hints everywhere.
- Add docstrings explaining the directional invariants and the lifecycle rules.

# FINAL CHECK

Before outputting, verify mentally:

- [ ] Can a LONG SL ever decrease? → NO
- [ ] Can a SHORT SL ever increase? → NO
- [ ] Is a LONG SL above entry considered a bug? → NO (if trailing stop is active)
- [ ] Can breakeven fire twice without a scale-in? → NO
- [ ] Does partial exit change average entry? → NO
- [ ] Does scale-in recalculate average entry? → YES
- [ ] Does scale-in reset extreme_price? → NO
- [ ] Does partial exit reset extreme_price? → NO
- [ ] Does state survive a process restart? → YES
- [ ] Are all 18 tests passing? → YES

```

---

**Key corrections made:**
- Removed the incorrect claim that LONG SL must be below entry.
- Added explicit test (`test_long_sl_above_entry_is_valid`) validating that trailing SL above entry is correct.
- Clarified that the only invariant is directional movement, not position relative to entry.
- Maintained all the partial exit / scale-in lifecycle requirements from the previous version.
User: is this also correct?
Kimi: **Yes, this is correct.** And in several ways, it is actually better than the version I wrote.

---

### What is correct

| Element | Verdict |
|---------|---------|
| **Invariant framing** | Perfect. You explicitly decoupled the SL rule from the entry price and tied it to directional movement only. This prevents the exact mistake I made. |
| **Incident summary** | Correctly identifies the real bug: the SL moved **backward** (1611.97 → 1555.81), not the fact that it was above entry. |
| **SL guard** | Correct. `>` for LONG, `<` for SHORT. Strict inequality is fine — it prevents noisy no-op updates. |
| **Exchange-wins recovery** | This is a critical production rule I under-emphasized. Treating the exchange as authoritative during restart is the right call. |
| **Output strictness** | "No pseudocode. No TODOs. No placeholders." — exactly what a reasoning model needs to produce complete, reviewable code. |
| **Decimal requirement** | Correct for all financial calculations. |

---

### Minor gaps (not errors, but worth adding)

These are enhancements that remove the last bits of ambiguity:

**1. Breakeven after scale-in**
Your prompt says breakeven is a one-time event: *"If already true, return."* This is safe, but if a user scales in at a much worse price, the new breakeven will be higher (for a LONG). Since the guard only allows the SL to move up, you could safely recompute breakeven on every poll even when `breakeven_applied == True`, and let the guard reject it if it is not an improvement. This handles scale-in automatically without resetting flags.

**2. Extreme price preservation**
Worth adding one sentence: *"`extreme_price` is never reset on partial exit or scale-in. It tracks the lifetime extreme of the position."* This prevents the model from accidentally resetting the trailing anchor during lifecycle events.

**3. Realized PnL formula**
Your state model includes `realized_pnl`, but the lifecycle section does not explicitly show how to calculate it on partial exit. Adding the formula would remove ambiguity:
```

realized_pnl += exit_size *(exit_price - avg_entry)* (1 if LONG else -1)

```

**4. Currency formatting**
You dropped the USDT/₹ mixing bug from the bug list. If that is still an issue in your alerts, you may want to add it back as Bug #6.

---

### One tactical suggestion

In the **Breakeven Module**, consider changing:

> "If already true, return."

To:

> "If already true, recompute breakeven based on current `avg_entry_price`. Pass through SL guard. If the new breakeven is an improvement, update and send alert. Otherwise, return."

This makes the module self-healing after scale-in without requiring any flag resets.

---

### Bottom line

Your prompt will produce a correct, production-grade system. The architecture is sound, the invariants are properly enforced, and the recovery logic respects exchange authority. The only differences from my version are that yours is more concise and technically accurate.
User: Also each postion alert must have the current price too I think this is missing from each alert?
Kimi: **Yes, that is correct and important.** The current price is missing from the alerts, which makes it impossible to verify at a glance whether the SL is actually valid.

For a LONG, the SL must remain **below the current price**. Without the current price in the alert, you cannot tell if `SL: 1611.97` is safe or if the position should have already been stopped out.

Here is how the alert formats should be updated:

| Alert | Updated Format |
|-------|----------------|
| **Position Opened** | `🟢 Position Opened \| {symbol} {side} ×{leverage} \| Entry: {entry} \| Size: {size} \| Margin: {margin} \| Mark: {mark_price} \| SL: {sl} \| TP: {tp}` |
| **Breakeven** | `🛡️ Breakeven \| {symbol} {side} \| Avg Entry: {avg_entry} \| Mark: {mark_price} \| SL locked at {sl}` |
| **Trail Stop** | `🎯 Trail Stop \| {symbol} {side} \| Mark: {mark_price} \| SL trailed to {sl} \| Extreme: {extreme_price}` |
| **Partial Exit** | `📉 Partial Exit \| {symbol} {side} \| Closed {size} @ {price} \| Mark: {mark_price} \| Realized: {pnl} \| Remaining: {size}` |
| **Scale In** | `📈 Scale In \| {symbol} {side} \| Added {size} @ {price} \| Mark: {mark_price} \| New Avg Entry: {avg_entry} \| Total Size: {size}` |
| **Position Closed** | `🔴 Position Closed \| {symbol} {side} \| Exit: {price} \| Mark: {mark_price} \| Total Realized: {pnl} \| Duration: {time}` |

### Why this matters

With the current price included, every alert becomes **self-validating**:

- **LONG:** `mark_price > current_sl` must always be true. If you see `Mark: 1610 | SL: 1611.97`, you immediately know the position is invalid or the alert is stale.
- **SHORT:** `mark_price < current_sl` must always be true.

This also makes post-incident review much faster. You can read the log and confirm the SL was correctly positioned relative to the market without cross-referencing price charts.

### Quick addition to your prompt

Add this under **Alert Rules**:

> Every alert must include the current `mark_price` at the time of the event. This allows immediate validation that the stop-loss is on the correct side of the market for the position direction.

And add this field to the **PositionState** schema:

```python
last_mark_price: Decimal   # Current mark price at last poll
```

Then update the **Position Manager** poll step to refresh `last_mark_price` before running any module, and pass it to the alert dispatcher.
