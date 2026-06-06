# AUDIT.md — Janus Platform Technical Audit

**Audited:** 2026-06-06  
**Auditor perspective:** Principal Engineer + SRE + Quant Trader + Security Engineer  
**Assumption:** This system will trade real personal capital, fully autonomously, 24/7.

> This audit is brutally honest. It does not optimize for politeness.
> Every issue found here represents a real risk to capital or system integrity.

---

## Scores

| Domain | Score | Verdict |
|--------|-------|---------|
| Architecture | 6 / 10 | Functional monolith, serious state-management gaps |
| Trading Logic | 5 / 10 | Signals are untested, assumptions unvalidated |
| Execution Safety | 4 / 10 | Multiple race conditions, orphan risk |
| Risk Management | 4 / 10 | In-memory state defeats safeguards on restart |
| Security | 5 / 10 | Critical auth gaps on signal endpoints |
| Reliability / Ops | 5 / 10 | No startup health check, 500ms shutdown guess |
| AI Readiness | 6 / 10 | Infrastructure present, governor is too soft |
| Autonomous Trading | 3 / 10 | Not ready — too many critical gaps |

**Overall: Not ready for live autonomous capital deployment.**  
Paper trading and shadow-mode AI: ready with minor fixes.

---

## Top 20 Critical Issues

| # | Severity | Issue | File |
|---|----------|-------|------|
| 1 | CRITICAL | Risk engine state is in-memory — resets on server restart, bypassing cooldowns and drawdown | `risk-engine.ts` |
| 2 | CRITICAL | Kill switch state file (`kill-switch-state.json`) is not written atomically — power loss can corrupt it, silently clearing an active halt | `kill-switch.ts` |
| 3 | CRITICAL | Signal and market data endpoints use `publicQuery` — anyone can see your real-time signals and front-run you | `signal-router.ts`, `market-router.ts` |
| 4 | CRITICAL | Dedup cache is a non-atomic JSON file — corruption on crash causes duplicate positions | `auto-executor.ts` |
| 5 | CRITICAL | Race condition: exit-manager and trailing-stop can both write to the same position simultaneously, re-opening a closed position | `exit-manager.ts`, `trailing-stop.ts` |
| 6 | CRITICAL | Daily drawdown limit only applies to auto-executor, not manual positions — bypass is trivial | `risk-engine.ts` |
| 7 | CRITICAL | Available margin calculation ignores isolated margin per position — position sizing can exceed actual free margin | `auto-executor.ts` |
| 8 | CRITICAL | Liquidation price is used without validation — API returning 0 or NaN is accepted as-is | `trading-router.ts` |
| 9 | CRITICAL | Brain governor silently downsizes oversized proposals instead of rejecting them — brain's own risk model is now broken | `brain-governor.ts` |
| 10 | CRITICAL | Auto-executor is hardcoded to `userId=1` throughout — single-user assumption, no isolation | `auto-executor.ts`, `bot-router.ts` |
| 11 | CRITICAL | No DB health check at startup — server boots successfully then crashes on first request if PostgreSQL is down | `queries/connection.ts` |
| 12 | CRITICAL | Auto-reduce at 2% liquidation proximity can trigger a loss spiral by increasing effective leverage on remaining size | `liquidation-monitor.ts` |
| 13 | HIGH | KNN label generation has potential look-ahead bias — backtests are misleading, live performance unknown | `knn-supertrend.ts` |
| 14 | HIGH | ADX calculation in regime detector is non-standard — uses DI divergence, not Wilder's ADX — regime flips every candle in choppy markets | `regime-detector.ts` |
| 15 | HIGH | Kill switch is only checked at start of signal batch, not immediately before each `createFuturesOrder()` call — partial batches execute after halt | `auto-executor.ts` |
| 16 | HIGH | Reconciliation gap: order is placed on exchange before DB insert — reconciler can flag the live position as orphan in a 50–500ms window | `auto-executor.ts`, `position-reconciler.ts` |
| 17 | HIGH | Binance data drives signals, CoinDCX executes — no price drift buffer — 10–20% of trades execute 0.5–2% worse than signal price | `confluence.ts`, `auto-executor.ts` |
| 18 | HIGH | OAuth mock mode triggers on any URL containing "localhost" string match — `http://localhost.attacker.com` bypasses auth | `oauth/auth.ts` |
| 19 | HIGH | CoinDCX private WebSocket has no reconnect logic exposed — if it drops, position cache becomes stale indefinitely until 5-minute reconciler catches it | `coindcx-ws.ts` |
| 20 | HIGH | No tests for `auto-executor.ts`, `position-lifecycle.ts`, or `confluence.ts` — the three most critical paths have zero test coverage | missing |

---

## Part 1 — Architecture

### Strengths

- Clear service boundaries between market data, signal generation, execution, and position management
- `globalThis` singleton pattern correctly prevents double-init under Vite HMR for most services
- Position manager is a genuinely self-contained additive system — no existing files modified
- Event-driven communication via `tradingEvents` / `positionManagerBus` keeps services loosely coupled where it counts
- Ring buffers properly bound memory per symbol

### Weaknesses

**CRITICAL — Race condition in boot sequence** (`boot.ts:192`)  
`positionLifecycleManager.start()` fires 5 seconds after boot via `setTimeout`. LLM advisor initialisation is async and completes when it completes. If position manager boots before `globalLlmAdvisor.init()` finishes, the first AI assessment call hits a half-initialised LLM service. Fix: chain via Promise, not a timing guess.

**CRITICAL — Risk engine state does not survive restart**  
`RiskSession` objects live in a `Map` in memory. After any crash, restart, or deployment:
- Active loss cooldowns are gone — user can trade immediately after 3 consecutive losses
- Daily drawdown counters reset — user can exceed the daily limit by restarting mid-day
- This completely defeats the risk safeguards for a long-running trading system

Fix: persist sessions to DB. Hydrate from DB on boot. Compare `session.date` against DB record to detect daily resets correctly.

**HIGH — No ordered, awaited shutdown**  
Shutdown handler calls `.stop()` on multiple services simultaneously then waits 500ms and exits. Any in-flight DB write (position status update, trade record) that takes > 500ms is lost. Next boot thinks the position is still open.

Fix: serialize shutdown (stop trading → await in-flight writes → close connections → exit). Allow at least 2–5s.

**HIGH — `dedup-cache-state.json` and `kill-switch-state.json` are non-atomic writes**  
Both files are written with `fs.writeFileSync()` (or equivalent). A power failure mid-write produces invalid JSON. On next boot, `JSON.parse()` throws inside a `try/catch`, the state is silently treated as empty, and the emergency halt is cleared.

Fix: write to a `.tmp` file, then `fs.renameSync()` (atomic on POSIX). Or move both to the database.

**MEDIUM — Three independent price caches with no TTL**  
`latestTickerCache`, `markPriceCache`, and `tickerStateCache` grow without eviction. If a symbol is unsubscribed, its stale price persists in cache forever. In production running for weeks, this is a slow memory leak and a source of stale-price bugs.

Fix: key cache entries with a `lastUpdated` timestamp. Expire entries older than 10s. Evict on unsubscribe.

**MEDIUM — Background loop exceptions are inconsistently handled**  
- `initCoinDCXPrivateWs()` failure → `console.error` only (trading continues without private WS)
- Trailing stop loop catches `loopErr` but continues spinning (may retry forever on persistent DB failure)
- Exit manager catches `loopErr` similarly

No service uses a circuit breaker. One persistent DB error can cause a hot loop of failing queries.

Fix: per-position try/catch in trailing stop and exit manager. Add a circuit breaker (N consecutive failures → pause loop, alert, trigger kill switch).

### Refactor Recommendations

1. Persist risk engine sessions to `risk_sessions` DB table
2. Move kill switch and dedup state to DB (atomic transactions)
3. Add a `preBootHealthCheck()` that validates DB + required env vars before starting any service
4. Add circuit breakers to all background interval loops
5. Introduce a proper shutdown coordinator that serializes service teardown

---

## Part 2 — Trading Logic

### Strengths

- Composite scoring (micro/intra/swing) is conceptually sound — captures multiple timeframes
- SMC concepts (order blocks, FVGs, BOS/CHoCH) are correctly defined per established theory
- Regime detection exists and routes to appropriate strategies — most systems skip this entirely
- KNN SuperTrend correctly suppresses entry in ranging regimes

### Weaknesses

**CRITICAL — Confluence threshold (75) has no backtested justification**  
The gate threshold is hardcoded. No historical analysis of signal win rate, profit factor, or Sharpe ratio at this threshold is documented or present. A system can generate gated signals that lose money on average with a composite score ≥ 75. The current weights (20/45/35) and point adjustments (RSI > 70 → −15, etc.) are engineering estimates, not empirically validated.

Fix: Walk-forward backtest across 6+ months. Plot win rate and profit factor at every threshold from 60 to 90. Pick the knee point. Document it.

**HIGH — KNN has unverified look-ahead bias**  
The KNN classifier labels data using "future return." If that future return is computed at the same timestamp as the features (or before a proper train/test split), the model is fitted to future data it cannot know in production. Backtests would show exceptional accuracy; live trading would not.

Fix: document label generation explicitly. Ensure features at `t` use only data from `[t-window, t]`. Labels at `t` use only data from `[t+1, t+lookahead]`. Enforce a strict temporal split.

**HIGH — ADX calculation is not Wilder's ADX**  
The regime detector computes:
```
ADX ≈ |plusDI - minusDI| / (plusDI + minusDI)
```
This is the raw DI divergence ratio, which oscillates significantly. Wilder's ADX is a 14-period smoothed average of this value — the smoothing is what makes ADX a reliable trend strength indicator. Without it, regime classification flips every candle in sideways markets.

Fix: implement proper Wilder's smoothed ADX. Add 2-candle confirmation before any regime switch.

**HIGH — No regime hysteresis**  
A single ADX crossing causes an immediate regime switch. In noisy markets, ADX oscillates around 20–25, causing the system to alternate between `intraday_trend` and `ranging` every 30 seconds. Each switch can change target leverage, trail percentage, and SL distance for open positions.

Fix: require N consecutive periods above/below threshold to confirm a regime change. Hysteresis prevents churn.

**MEDIUM — RSI, EMA, and ADX computed independently in 4+ services**  
`confluence.ts`, `knn-supertrend.ts`, `regime-detector.ts`, and `position-manager/market-context.ts` each maintain their own indicator calculations. There is no guarantee they use identical formulas, the same lookback periods, or the same initial seed values.

Fix: centralise all indicator math in a shared `indicators.ts`. Each service consumes pre-computed values from `MarketContextBuilder`. Test the shared implementation.

**MEDIUM — Confluence assumes tight Binance/CoinDCX price correlation**  
Confluence scoring uses Binance order book and klines. Execution happens on CoinDCX. During high-volatility events, CoinDCX can trade 1–5% away from Binance. A signal gated on Binance data may be economically invalid on CoinDCX by execution time.

Fix: score ≥ 80 required if Binance/CoinDCX spread > 0.3%. Or compute signals from CoinDCX market data directly.

### Assessment

Trading architecture score: **5/10**. The conceptual pipeline is correct. The implementation relies on unvalidated parameters. Before live trading: backtest every threshold, fix the ADX implementation, and enforce temporal correctness on the KNN.

---

## Part 3 — Execution Audit

### Failure Scenarios

**CRITICAL — Duplicate position race condition**  
Gate 4 (dedup open-position check) queries the DB at signal time. If two identical signals fire within < 500ms of each other (before the first position write completes), both pass gate 4 and two positions are created for the same symbol and side. An unexpected leverage spike results.

Fix: use a DB `UNIQUE` constraint on `(userId, symbol, side)` where `status = 'open'`. Let the DB enforce the invariant, not application-level logic.

**CRITICAL — Exit-manager / trailing-stop write conflict**  
If the exit manager closes a position (sets `status = 'closed'`) and the trailing stop engine reads the position in the same 2s tick, the trailing stop will write a new SL to the (now-closed) position. Depending on query timing, the closed position could have its status reverted to `open` with a new SL.

Fix: add a `version` integer column to `positions`. Every write increments it. Trailing stop uses optimistic locking: `WHERE id = ? AND version = ?`. If rows affected = 0, skip (someone else wrote first).

**HIGH — Order placed before DB insert — reconciler orphan false-positive**  
Current sequence:
1. Call `createFuturesOrder()` → exchange confirms
2. Insert position row into DB

If the reconciler runs in the 50–500ms gap between steps 1 and 2, it sees a live exchange position with no DB record and raises an orphan alert. On the next cycle the DB row exists and the alert resolves, but the confusion creates noise.

Fix: reverse the order. Insert DB row with `status = 'pending'` before calling the exchange. Update to `status = 'open'` after exchange confirms.

**HIGH — Partial fills are not handled**  
`createFuturesOrder()` checks `remaining_quantity === "0"` to confirm full fill. If the exchange partially fills (7 BTC of a 10 BTC order), the code treats it as complete. The DB records 10 BTC, the exchange has 7 BTC open + 3 BTC pending. The reconciler will correct the size to 7, but the pending 3 BTC order is never tracked or cancelled.

Fix: compare `requested_quantity` vs `filled_quantity` on the exchange response. If partial, record `filled_quantity` in DB and cancel the remaining order.

**MEDIUM — Reconciler fails silently if exchange credentials are missing or inactive**  
If `exchange_credentials` has no active row for the user, the reconciler returns without scanning the exchange. Orphan positions on the exchange accumulate undetected indefinitely.

Fix: log a CRITICAL alert if credentials are missing in a live environment. Do not silently skip.

**MEDIUM — 5-minute reconciliation window is too long**  
A position manually closed on the exchange is not detected for up to 5 minutes. During that window, the auto-executor could re-enter the same symbol, effectively doubling exposure.

Fix: reduce to 1-minute interval. Add a webhook listener for CoinDCX order events as a first-class signal (not just the polling fallback).

---

## Part 4 — Risk Audit

### Critical Vulnerabilities

**CRITICAL — Risk engine in-memory state**  
(Already covered in Architecture. Priority: fix this first.)

**CRITICAL — Drawdown limit not applied to manual positions**  
`checkTradeAllowed()` is called from `auto-executor.ts`. The `trading.createPosition` tRPC handler does not call it. A user who opens positions manually bypasses the 5% daily drawdown limit, the consecutive-loss cooldown, and the position size cap entirely.

Fix: call `checkTradeAllowed()` in the manual `createPosition` handler. It should be impossible to create any position (manual or auto) without passing the risk check.

**HIGH — Drawdown counts only realised PnL**  
The circuit breaker checks `Math.abs(Math.min(0, session.realizedPnl))`. If a user has -3% realised and -2% unrealised (total -5%), they can still open new trades because unrealised is ignored. A new trade that immediately goes -5% means total exposure is -10% before the drawdown gate fires.

Fix: `effectivePnl = session.realizedPnl + positionStore.totalUnrealizedPnl()`. Gate on the combined figure.

**HIGH — Kill switch not rechecked before each order**  
Gate 2 checks `globalKillSwitch.canTrade()` once at the start of `onSignalBatch()`. If a batch contains 3 signals and the kill switch fires mid-batch (e.g., triggered by the liquidation monitor), signals 2 and 3 still execute.

Fix: recheck the kill switch immediately before each `createFuturesOrder()` call.

**HIGH — Leverage cap enforced only in application code**  
The 10× hard cap is a runtime check in `auto-executor.ts`. There is no DB constraint and no exchange-level enforcement. Editing `autoExecutorConfig.defaultLeverage` to 50 in the DB bypasses the cap.

Fix: add a `CHECK` constraint on the `auto_executor_config.defaultLeverage` column (`<= 10`). Validate in the tRPC update handler.

**MEDIUM — Liquidation monitor auto-reduce can accelerate liquidation**  
At 2% proximity, the system closes 50% of the position at market. Market orders during high volatility incur slippage (1–3%). After closing 50%, the remaining 50% has the same margin but half the size — which means lower leverage, but any further adverse move is still amplified. If the auto-reduce price is worse than the fill estimate, the actual remaining liquidation distance is shorter than calculated.

Fix: before executing auto-reduce, recalculate post-reduce liquidation price including estimated slippage. Only reduce if it provably moves the liquidation price further away.

**Risk Score: 4/10**  
The risk framework is architecturally correct but its primary weakness is that state is non-persistent, making it defeatable by accident (restart) or intent.

---

## Part 5 — Crypto Futures Specifics

### Hidden Capital Risks

**CRITICAL — Liquidation price not validated**  
`liquidation_price` is read from the CoinDCX API response and used directly. No check that:
- For a long: `liqPrice < entryPrice`
- For a short: `liqPrice > entryPrice`
- It is non-zero and non-NaN

An API bug returning `0` or a negative value would cause the liquidation monitor and position manager to compute nonsensical SL distances.

Fix:
```ts
const isLong = position.side === "buy";
if (isLong && liqPrice >= entryPrice) throw new Error(`Invalid liqPrice ${liqPrice} for long`);
if (!isLong && liqPrice <= entryPrice) throw new Error(`Invalid liqPrice ${liqPrice} for short`);
```

**CRITICAL — Available margin calculation assumes cross margin**  
Position sizing uses `walletBalance` (total free balance). For isolated margin positions, each position has its own margin pool. The correct available balance for a new position is `totalBalance - sum(isolatedMarginPerPosition)`. The current calculation can result in position sizing that exceeds actual available margin, leading to an exchange rejection or, worse, an over-leveraged position accepted on a partially-free balance.

Fix: for each live position with `marginMode = 'isolated'`, subtract its margin from the available balance before sizing new positions.

**HIGH — Isolated vs. cross margin liquidation formulas are not distinguished**  
Cross margin: liquidation is account-level (all positions share the margin pool).  
Isolated margin: liquidation is position-level (independent margin per position).  
The system treats both as isolated in the liquidation monitor. Cross-margin positions show wrong liquidation distance estimates.

Fix: branch on `position.marginMode`. Cross-margin liq monitoring requires account-level margin view.

**HIGH — Fees are hardcoded at 0.05% taker throughout**  
CoinDCX fee tiers range from 0.01% (VIP) to 0.10% (new user). The system hardcodes 0.05% in at least three places: trailing stop breakeven, exit manager, and paper adapter. A VIP user holds positions longer than needed; a new user exits too early. Over 100 trades this compounds to a meaningful P&L difference.

Fix: fetch the user's actual tier from the CoinDCX account API on boot. Cache and refresh daily. Pass the actual fee rate to all P&L calculations.

**HIGH — Mark price vs. last price inconsistency**  
Position manager uses mark price (correct — more stable, less gameable). Trailing stop engine uses `latestTickerCache` (last traded price). The two systems now use different prices for SL decisions on the same position, causing conflicts.

Fix: standardise on mark price everywhere. Last traded price is for display only.

**MEDIUM — Funding rate cache can be 10 minutes stale**  
Funding rates change every 8 hours but can shift significantly in anticipation. A 10-minute stale cache means a trade entered just before a funding rate surge sees the wrong rate in its go/no-go decision.

Fix: reduce funding cache TTL to 5 minutes. Fetch fresh funding on every signal batch.

**MEDIUM — No check for exchange trading halts**  
CoinDCX occasionally pauses trading on pairs for maintenance. Binance data still flows. The auto-executor sees a gated signal and fires `createFuturesOrder()`, which is rejected by CoinDCX. The error is logged but no retry or pause logic exists.

Fix: call CoinDCX market status endpoint before execution. Skip the trade if the pair is paused.

---

## Part 6 — Security Audit

### Critical Findings

**CRITICAL — Signal and market routes are public**  
`signal.latest`, `signal.comprehensive`, `signal.analyze`, `signal.analyzeAll`, and all `market.*` endpoints use `publicQuery`. No authentication is required to see:
- Real-time confluence scores and gate status
- KNN regime and bias data
- Multi-timeframe technical analysis
- Order book depth and trade data

Anyone who discovers your server URL can monitor your exact signal logic and front-run your entries. On a single-operator system this means signal alpha leaks to whoever is watching.

Fix: change all signal and market endpoints to `authedQuery`. These contain operational edge.

**CRITICAL — Kill switch accessible to any authenticated user**  
`autoExecutor.killSwitch` uses `authedQuery`, not `adminQuery`. Any logged-in user can trigger an emergency halt, disrupting live trading.

Fix: change `killSwitch` to `adminQuery`.

**CRITICAL — `bot-router.ts` start/stop hardcoded to `userId = 1`**  
```ts
.where(eq(autoExecutorConfig.userId, 1))
```
This appears in `start`, `stop`, and `updateConfig`. The system architecturally supports multiple users but the control plane only operates on user #1.

Fix: use `ctx.user.id` (from session) everywhere. Remove the hardcoded `1`.

**HIGH — OAuth mock mode uses fragile string matching**  
```ts
if (env.authUrl.includes("localhost") || env.authUrl.includes("127.0.0.1"))
```
`http://localhost.attacker.com` passes this check. Mock mode grants any token full access with the `OWNER_UNION_ID`.

Fix: parse the URL and check `.hostname === "localhost"` exactly. Additionally gate on `NODE_ENV !== "production"`.

**HIGH — Encryption key entropy not validated**  
`api/lib/env.ts` validates that `ENCRYPTION_KEY` is 32 bytes of valid hex. It does not reject:
- All-zeros: `0000...0000`
- Trivial patterns: `aaaa...aaaa`

Fix: after decoding, compute Shannon entropy. Reject keys with entropy < 3.5 bits/byte. At minimum, reject all-zero keys.

**HIGH — Symbol inputs not validated by format**  
`symbol: z.string()` allows arbitrary strings including newlines, injection payloads, or malformed identifiers. These flow into cache lookups and WS subscription names.

Fix:
```ts
symbol: z.string().regex(/^[A-Z0-9]{3,20}$/)         // Binance format
coindcxPair: z.string().regex(/^B-[A-Z0-9]+_USDT$/)  // CoinDCX format
```

**MEDIUM — JWT sessions have no server-side invalidation**  
Sessions are valid until `maxAge` expires. There is no token blacklist, no rotation on privilege escalation, and no way to forcibly log out a compromised session.

Acceptable for a single-operator self-hosted system. Document the limitation.

**MEDIUM — LLM key endpoint not validated as a URL**  
`endpoint: z.string()` in `llm.addKey` allows `javascript:alert(1)` or an internal SSRF target (e.g., `http://169.254.169.254/latest/meta-data/`).

Fix: `endpoint: z.string().url().startsWith("http")`.

---

## Part 7 — Reliability & Operations

### Operational Maturity Score: 5/10

**CRITICAL — No database health check at startup**  
`getDb()` creates a connection lazily on first use. If PostgreSQL is unavailable at boot, the server starts, logs "ready," and crashes on the first tRPC request. All background services start and immediately fail on their first DB read.

Fix:
```ts
// boot.ts — before starting any service
await getDb().execute(sql`SELECT 1`);
```
Exit process immediately if this fails. Do not attempt to start background services without a DB.

**HIGH — Binance stream silent failure (60s stale data)**  
The watchdog terminates streams silent for > 60s and triggers reconnection. But for those 60s, market data in `MarketStateManager` and price caches is stale. The auto-executor can execute trades on 60-second-old data. The kill switch only auto-fires if 3 symbols go silent simultaneously — a single-symbol failure is not caught.

Fix: if any primary symbol (BTCUSDT, ETHUSDT) goes silent for > 10s, trigger kill switch and stop new entries until feed recovers.

**HIGH — CoinDCX private WebSocket reconnect not visible**  
Socket.io handles reconnection internally, but there is no explicit reconnect handler in `initCoinDCXPrivateWs()`. After a reconnect, the "join" auth event must be re-sent or the server won't push private events again. If this is not handled, all position and balance updates stop silently.

Fix: implement `socket.on("reconnect")` → re-emit all join events.

**MEDIUM — Graceful shutdown uses a 500ms guess**  
After stopping services, the boot shutdown handler waits exactly 500ms then exits. Any in-flight DB write slower than 500ms is lost. A position exit in progress at shutdown time may not be persisted.

Fix: drain properly:
```ts
await Promise.allSettled([service1.stop(), service2.stop()]);
await new Promise(r => setTimeout(r, 2000)); // real buffer
process.exit(exitCode);
```

**LOW — Ring buffer memory grows with symbol count**  
Each tracked symbol allocates ~4,300 buffer slots. At 100 symbols: ~430,000 objects in memory. Symbols that are unsubscribed are not evicted from `MarketStateManager`. Over days, this accumulates.

Fix: evict instrument state when a symbol is removed from `SUPPORTED_PAIRS` or after 24h without subscription.

---

## Part 8 — AI Readiness

### AI Readiness Score: 6/10 (infrastructure present, governance soft)

**CRITICAL — Brain governor silently downsizes instead of rejecting**  
```ts
if (proposedSize > 5.0) {
  console.warn(`Reducing proposed size from ${proposedSize}% to safety cap 5.0%`);
  proposedSize = 5.0;  // silent cap, brain doesn't know
}
```
The LLM proposed 50% and believes it has a 50% position. The governor capped it at 5%. The brain's subsequent reasoning ("I have 50% long, risk is bounded") is now factually wrong. This cascades into every downstream decision that uses position size in its risk model.

Fix: reject the proposal, return `{ approved: false, reason: "size 50% exceeds cap 5%" }`. Let the brain generate a new proposal with correct parameters.

**MEDIUM — Prompt injection risk from market data**  
Market context (symbol, price, signals) is embedded directly into the LLM system prompt via `JSON.stringify`. If any market data field contains instruction-like text (highly unlikely from Binance, but possible if data is cached from an untrusted source), the LLM could be redirected.

Mitigating factor: all brain proposals must pass `brainGovernor.check()` and `policyGuard()`. A prompt injection that convinces the LLM to propose `size: 50%` is still capped by the governor.

Fix: sanitise all strings embedded in prompts. Strip anything matching `[Ii]gnore previous` or similar patterns.

**MEDIUM — Position manager AI has no latency SLA or priority queue**  
All open positions are assessed sequentially every 30s. If position #1's LLM call takes 15s, positions #2–#5 are delayed by 15s. A position approaching its SL may not be assessed in time.

Fix: assess positions in parallel (capped concurrency). Prioritise positions by urgency: SL proximity, ROE, and hold time determine assessment order.

**MEDIUM — Shadow mode can be overridden per-call**  
`decide(symbol, userId, signalDetails, { shadowMode: false })` disables shadow mode for that call. Any caller with access to the tRPC endpoint can enable live execution without changing configuration.

Fix: in production, ignore the `opts.shadowMode` override. Only the environment variable (or an adminQuery mutation) should control shadow mode.

**MEDIUM — Qdrant vector store failure is silent**  
```ts
initVectorStore().catch(err => console.error("[Brain] Vector store init failed:", err));
startBrainScheduler();
```
The brain scheduler starts regardless of whether Qdrant is available. Reflection and evolution calls that query Qdrant will throw. These are currently swallowed in `.catch()`.

Fix: if Qdrant init fails, set a flag `brainMemoryAvailable = false`. Skip reflection and evolution cycles that require it. Log a periodic warning until Qdrant becomes reachable.

**What is missing for full AI readiness:**
- Persistent, validated training data with temporal integrity for KNN
- Governed paper-trading trial period before shadow → live transition
- LLM response validation (token budget, latency SLA, format enforcement before policy guard)
- Separate governor confidence thresholds per action type (scale-in, full-exit, trail-sl)

---

## Part 9 — Autonomous Trading Readiness

### Readiness Score: 3/10

### Proposed Architecture Assessment

```
Signal Engine → Brain → Governor → Executor
```

This is **architecturally correct** with one modification:

```
Signal Engine → Brain → Governor → Risk Engine → Executor → Reconciler
                  ↑                                    ↓
              Reflection ←←←←←←←←←←←←← Position Monitor
```

The Brain should observe, not control. Every Brain decision must pass through the Governor (hard limits) and Risk Engine (account state) before reaching the Executor. Reconciliation closes the feedback loop.

### What Must Never Be Delegated to an LLM

| Decision | Reason |
|----------|--------|
| Stop-loss placement | Must be deterministic (ATR/swing-based), not hallucinated |
| Leverage calculation | Hard cap must be enforced in code, not suggested by AI |
| Whether to place an order at all | Final gate must be deterministic policy, not LLM confidence |
| Drawdown circuit breaker | Must be guaranteed to fire regardless of AI state |
| Emergency halt (kill switch) | Must be instantaneous, cannot wait for LLM |
| Liquidation price calculation | Must match exchange formula exactly |
| Fee calculation | Must use actual tier, not estimates |

### What Must Remain Deterministic

- All 14 auto-executor gates
- Risk engine session state and circuit breakers
- SL/TP distance calculations
- Position sizing formula
- Reconciliation logic

### Minimum Infrastructure Before Live Autonomous Trading

1. Risk engine state persisted to DB (not in-memory)
2. Kill switch stored atomically in DB (not a JSON file)
3. Signal routes protected by `authedQuery`
4. DB health check at startup
5. LLM brain in governed paper-trading mode for minimum 30 days with validated performance metrics
6. Full test coverage for auto-executor, position manager core, and confluence engine
7. Correlation IDs across all services for traceable audit trail
8. Validated KNN implementation with proper temporal train/test split
9. Corrected ADX implementation in regime detector
10. Kill switch rechecked immediately before every exchange call

---

## Part 10 — Code Quality

### Files Over 450 Lines (Refactor Targets)

| File | Lines | Problem |
|------|-------|---------|
| `api/routers/signal-router.ts` | 2238 | Confluence, KNN, regime, analysis, loop — 5 responsibilities |
| `api/routers/trading-router.ts` | 1441 | CRUD, portfolio, PnL, manual execution, market access |
| `api/services/auto-executor.ts` | 904 | Gate logic, order placement, LLM filter, dedup management |
| `api/services/price-action.ts` | 530 | Multiple SMC concepts — split by concept |
| `api/services/market-state.ts` | 501 | State management + metric computation mixed |

### Magic Numbers (Non-Exhaustive)

| Value | Location | What it controls |
|-------|----------|-----------------|
| `75` | signal-router | Confluence gate threshold |
| `78` / `22` | ai-advisor | RSI overbought / oversold |
| `0.0005` | paper-adapter, exit-manager, trailing-stop | Taker fee rate |
| `5.0` | brain-governor | Brain max position size % |
| `0.003` | signal-router | POC tolerance |
| `0.0001` / `0.001` | signal-router | Funding "heavy" / "squeeze" thresholds |
| `0.35` | signal-router | Liquidity reversal weight |
| `60_000` | auto-executor | Dedup window (ms) |
| `5_000` | boot.ts | Position manager startup delay (ms) |
| `500` | boot.ts | Shutdown drain buffer (ms) |

Fix: consolidate all configurable thresholds into a `TRADING_CONSTANTS` or per-strategy config object. This enables paper-trading parameter sweeps without code changes.

### Missing Tests for Critical Paths

| File | Test Coverage | Risk |
|------|--------------|------|
| `auto-executor.ts` | None | CRITICAL — gate logic, position sizing |
| `position-lifecycle.ts` | None | CRITICAL — AI assessment cycle |
| `confluence.ts` | None | HIGH — signal generation |
| `coindcx-ws.ts` | None | HIGH — private data feed |
| `exit-manager.ts` | None | HIGH — position closure |

Tests that exist: `risk-engine`, `trailing-stop`, `price-action`, `market-state`, `kill-switch`, `llm-advisor`, `telegram` — these are good foundations.

### Inconsistent Error Handling

Three patterns in use across background services, none consistent:
1. `.catch(err => console.error(...))` — swallows silently
2. `.catch(err => positionManagerBus.emit("manager:error", ...))` — emits event
3. `try/catch` with push to decisions array — translates to a skip

Fix: adopt a single pattern. Background loop errors should: log with context → emit to a monitoring bus → increment a failure counter → circuit-break after N failures.

### No Correlation IDs

A signal-to-close flow traverses: `signal-router → auto-executor → trailing-stop → exit-manager → reconciler`. Logs across these services cannot be correlated to a single trade. Debugging a bad trade requires manually matching timestamps across five log streams.

Fix: generate `correlationId = uuidv4()` at signal creation. Propagate it through every service that touches that signal's lifetime. Log it consistently.

### Type Duplication

Three representations of a "position" exist:
- `db/schema.ts` `positions` — raw DB type
- `position-manager/types.ts` `ManagedPosition` — enriched type
- `trading-router.ts` `mapPaperPosition()` — ad-hoc mapped type

These diverge silently when fields are added. Fix: define one canonical `Position` type, derive all others from it via `Pick`/`Omit`.

---

## Top 20 Improvements

| # | Priority | Improvement |
|---|----------|-------------|
| 1 | P0 | Persist risk engine sessions to DB — eliminates cooldown/drawdown bypass on restart |
| 2 | P0 | Move kill switch to DB with atomic transactions — eliminates silent corruption risk |
| 3 | P0 | Add `authedQuery` to all signal and market endpoints |
| 4 | P0 | Add DB health check at startup — fast-fail if DB is unreachable |
| 5 | P0 | Add `UNIQUE` DB constraint on `(userId, symbol, side, status='open')` — eliminates duplicate position race |
| 6 | P0 | Recheck kill switch immediately before every `createFuturesOrder()` call |
| 7 | P0 | Insert DB row before exchange call (status='pending'), update after confirm |
| 8 | P1 | Fix ADX calculation in regime detector (use Wilder's smoothed ADX) |
| 9 | P1 | Add regime hysteresis (N-candle confirmation before switch) |
| 10 | P1 | Call `checkTradeAllowed()` in manual `createPosition` handler |
| 11 | P1 | Include unrealised PnL in daily drawdown calculation |
| 12 | P1 | Brain governor: reject oversized proposals, do not silently downsize |
| 13 | P1 | Validate liquidation price from API (direction sanity check, non-zero, non-NaN) |
| 14 | P1 | Fetch and use actual CoinDCX fee tier — replace all hardcoded 0.0005 |
| 15 | P1 | Standardise on mark price for all SL/TP decisions (trailing stop currently uses last price) |
| 16 | P2 | Backtest confluence thresholds on 6+ months of data — validate the 75 gate |
| 17 | P2 | Add correlation IDs across all service boundaries — enable end-to-end trade tracing |
| 18 | P2 | Implement per-position try/catch in trailing stop and exit manager loops |
| 19 | P2 | Fix OAuth mock mode: use exact hostname matching, gate on `NODE_ENV !== "production"` |
| 20 | P2 | Add test coverage for auto-executor gates, confluence scoring, and position lifecycle |

---

## Recommended 30-Day Roadmap

**Goal:** Make the system safe to run in paper trading mode without risk of state corruption or silent failures.

### Week 1 — Critical State & Safety

- [ ] Persist risk engine sessions to `risk_sessions` DB table. Hydrate on boot.
- [ ] Move kill switch to DB. Remove `kill-switch-state.json`.
- [ ] Move dedup cache to DB. Remove `dedup-cache-state.json`.
- [ ] Add DB startup health check — `SELECT 1` before any service starts.
- [ ] Add `authedQuery` to all signal and market endpoints.

### Week 2 — Execution Correctness

- [ ] Add `UNIQUE` constraint on `(userId, symbol, side)` for open positions.
- [ ] Reverse order: DB insert (pending) before exchange call.
- [ ] Add optimistic locking (`version` column) on `positions` table.
- [ ] Recheck kill switch immediately before every `createFuturesOrder()`.
- [ ] Validate liquidation price from API response.

### Week 3 — Trading Logic

- [ ] Fix ADX implementation in `regime-detector.ts` to use Wilder's smoothed ADX.
- [ ] Add 2-candle hysteresis to regime switching.
- [ ] Centralise indicator calculations into a shared `indicators.ts`.
- [ ] Include unrealised PnL in daily drawdown gate.
- [ ] Call `checkTradeAllowed()` in the manual `createPosition` handler.

### Week 4 — Reliability & Observability

- [ ] Add CoinDCX WS reconnect handler with re-authentication.
- [ ] Add per-position try/catch in trailing stop and exit manager loops.
- [ ] Add circuit breaker (N failures → pause loop + kill switch) to background loops.
- [ ] Add correlation IDs to signal, position, and execution log events.
- [ ] Fix graceful shutdown: await service drain before `process.exit()`.

---

## Recommended 90-Day Roadmap

**Goal:** Production-ready for live autonomous trading on real capital.

### Month 2 — Signal Validation & AI Governance

- [ ] Backtest confluence engine on 6+ months historical data. Validate threshold = 75 or adjust.
- [ ] Fix KNN look-ahead bias. Document and test label generation.
- [ ] Validate all scoring formulas (micro/intra/swing weights, point adjustments) against data.
- [ ] Brain governor: hard rejection for oversized proposals.
- [ ] Shadow mode: enforce via environment variable, not per-call override.
- [ ] LLM position manager: add latency SLA and priority queue.
- [ ] 30-day paper trading trial with governed brain in shadow mode. Track all metrics.

### Month 3 — Production Hardening

- [ ] Fetch actual CoinDCX fee tier on boot. Replace all hardcoded fee rates.
- [ ] Distinguish isolated vs. cross margin in liquidation calculations.
- [ ] Correct available margin calculation for isolated margin positions.
- [ ] Add exchange market-halt check before every order placement.
- [ ] Add replay protection: correlation IDs persisted to DB, duplicates rejected.
- [ ] Write tests: auto-executor gate pipeline, confluence scoring, position lifecycle state machine.
- [ ] Add symbol format validation (`z.string().regex(...)`) on all inputs.
- [ ] Add monitoring dashboard: error rates per service, loop health, LLM key status, feed health.
- [ ] Document and enforce KYC/tier mapping for CoinDCX fee calculation.
- [ ] Conduct final paper-trading PnL review. If Sharpe > 1.0 and max drawdown < 8%, enable live with low capital.

---

## Final Verdict

Janus is a **sophisticated and architecturally ambitious** trading system. The signal pipeline, position manager, and AI brain show genuine engineering depth. The code structure is clean and the intent is correct.

However, **it is not safe to trade real capital autonomously** in its current state. The most dangerous issues are not exotic edge cases — they are fundamental:

1. **Risk engine resets on restart.** Every protective safeguard (cooldown, drawdown limit) evaporates on crash or redeploy.
2. **Kill switch can be silently cleared** by file corruption.
3. **Signal routes are unauthenticated.** Your edge leaks to anyone who finds the URL.
4. **No race condition protection** on position creation or closure.

These are fixable in 2–4 weeks of focused work (Week 1–2 of the 30-day roadmap). After those fixes, the system is appropriate for **live paper trading** with continued monitoring. After 30 days of validated paper performance and completion of Month 2, it becomes a candidate for **low-capital live trading** with manual oversight.

Full autonomous operation on meaningful capital requires the complete 90-day roadmap, backtested signal validation, and a sustained paper-trading track record.

**The architecture is worth fixing. Fix it before it trades real money.**
