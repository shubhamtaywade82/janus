# FEATURES.md — Janus Trading Dashboard

Complete feature reference: what every system does and how it works internally.

---

## Table of Contents

1. [Live Market Data Infrastructure](#1-live-market-data-infrastructure)
2. [Confluence Scoring Engine](#2-confluence-scoring-engine)
3. [Auto-Executor (Signal → Entry)](#3-auto-executor-signal--entry)
4. [Risk Engine](#4-risk-engine)
5. [Trailing Stop Engine](#5-trailing-stop-engine)
6. [Position Manager (AI Lifecycle)](#6-position-manager-ai-lifecycle)
7. [LLM Advisor (Entry Signals)](#7-llm-advisor-entry-signals)
8. [AI Brain (Autonomous Decision Loop)](#8-ai-brain-autonomous-decision-loop)
9. [Price Action / SMC Analysis](#9-price-action--smc-analysis)
10. [Regime Detection](#10-regime-detection)
11. [KNN SuperTrend](#11-knn-supertrend)
12. [Liquidity Engine](#12-liquidity-engine)
13. [Correlation Guard](#13-correlation-guard)
14. [Paper Trading](#14-paper-trading)
15. [Alert Engine](#15-alert-engine)
16. [Telegram Integration](#16-telegram-integration)
17. [Kill Switch](#17-kill-switch)
18. [Liquidation Monitor](#18-liquidation-monitor)
19. [Feed Health Monitoring](#19-feed-health-monitoring)
20. [Position Reconciler](#20-position-reconciler)
21. [Performance Tracker](#21-performance-tracker)
22. [Export Feature](#22-export-feature)
23. [Frontend Dashboard](#23-frontend-dashboard)
24. [Authentication & Security](#24-authentication--security)

---

## 1. Live Market Data Infrastructure

**Files:** `api/services/streaming.ts`, `api/services/coindcx-ws.ts`, `api/services/market-state.ts`

### Binance WebSocket (public data)

One WebSocket connection per symbol, opened on first subscriber and ref-counted (last subscriber closes it). Subscribes to a combined stream:

| Stream | Data |
|--------|------|
| `@depth20@100ms` | Full order book top-20, every 100ms |
| `@trade` | Every individual trade execution |
| `@ticker` | 24h rolling stats (volume, price change) |
| `@kline_1m` | 1-minute OHLCV candles |
| `@markPrice` | Mark price + funding rate |
| `@forceOrder` | Liquidation events |

On disconnect, reconnects with exponential backoff (max 32s between attempts). All data flows into the in-memory `MarketStateManager` and is throttled before DB writes:

| Data type | DB write throttle |
|-----------|------------------|
| Order book depth | 2s |
| Trade ticks | 1s |
| Klines | 5s |
| Liquidation events | immediate |
| Funding rates | 60s |

### CoinDCX WebSocket (private data)

Socket.io v2 connection to `wss://stream.coindcx.com`. Authenticates via HMAC-SHA256 "join" event. Receives:

- `df-position-update` — open position changes (PnL, size, mark price)
- `balance-update` — wallet balance changes
- `user-orders` — order status updates

Feeds three shared caches: `userPositionsCache`, `userBalancesCache`, `markPriceCache`. The mark price cache has highest priority for PnL calculations everywhere in the system.

### In-memory MarketStateManager

Singleton that maintains per-symbol ring buffers:

| Buffer | Capacity | Contents |
|--------|----------|---------|
| `ltpWindow` | 200 | Last traded prices |
| `tradeWindow` | 1000 | Trade tape (price, qty, side, isMaker) |
| `bookWindow` | 50 | Order book snapshots |
| `deltaWindow` | 500 | Liquidity delta events |
| `liquidationWindow` | 1000 | Force-order events |
| `openInterestWindow` | 500 | OI snapshots |
| `cvdWindow` | 1000 | Cumulative volume delta ticks |

On every order book update, computes derived metrics:

| Metric | Formula |
|--------|---------|
| `spread` | ask − bid |
| `spreadPercent` | spread / mid × 100 |
| `imbalance` | (bidDepth − askDepth) / (bidDepth + askDepth) |
| `bidAskImbalance` | Rolling average imbalance over `bookWindow` |
| `volatilityRegime` | LOW / NORMAL / HIGH based on LTP std dev |
| `sweepScore` | price movement × log(volume) |
| `absorptionScore` | log(volume) / price movement |

`analyzeCvd(symbol)` computes CVD trend, signal strength, and session delta across the `cvdWindow`.

---

## 2. Confluence Scoring Engine

**File:** `api/services/confluence.ts`

Runs every 30 seconds on every tracked symbol. Produces a composite score 0–100, a direction, and a gate flag.

```
Composite = 0.20 × Micro + 0.45 × Intra + 0.35 × Swing
isGated = Composite ≥ 75 (configurable threshold)
```

### Micro Score (20%) — short-term order flow

Baseline 50. Adjustments:

| Factor | Condition | Points |
|--------|-----------|--------|
| Spread | < 0.01% | +10 |
| Spread | < 0.05% | +5 |
| Spread | ≥ 0.05% | −5 |
| Imbalance magnitude | min(|imbalance| × 20, 30) | up to +30 |
| Imbalance direction | > 0.2 (bid-heavy) | +5 |
| Imbalance direction | < −0.2 (ask-heavy) | −5 |
| Trade tape delta | positive delta | up to +20 |
| Trade tape delta | negative delta | up to −20 |
| Maker ratio | > 0.6 (informed flow) | +5 |

### Intra Score (45%) — momentum and trend

Baseline 50. Adjustments:

| Factor | Condition | Points |
|--------|-----------|--------|
| RSI(14) | > 70 (overbought) | −15 |
| RSI(14) | < 30 (oversold) | +15 |
| RSI(14) | > 50 | +5 |
| RSI(14) | ≤ 50 | −5 |
| EMA20 vs EMA50 | EMA20 > EMA50 | +10 |
| EMA20 vs EMA50 | EMA20 < EMA50 | −10 |
| Golden cross | EMA20 crosses above EMA50 | +15 |
| Death cross | EMA20 crosses below EMA50 | −15 |
| Volume surge | recent / previous > 1.5 | +10 |
| Volume drought | recent / previous < 0.5 | −5 |
| ROC(10) | > 2% | +10 |
| ROC(10) | 0% to 2% | +5 |
| ROC(10) | −2% to 0% | −5 |
| ROC(10) | < −2% | −10 |

### Swing Score (35%) — macro trend

Baseline 50. Adjustments:

| Factor | Condition | Points |
|--------|-----------|--------|
| EMA50 vs EMA200 | EMA50 > EMA200 (uptrend) | +15 |
| EMA50 vs EMA200 | EMA50 < EMA200 (downtrend) | −15 |
| SMA50 regime | price > SMA50 × 1.05 | +10 |
| SMA50 regime | price > SMA50 | +5 |
| SMA50 regime | price < SMA50 × 0.95 | −10 |
| SMA50 regime | price < SMA50 | −5 |
| S/R proximity | near support (price-low/range < 0.2) | +10 |
| S/R proximity | near resistance (price-low/range > 0.8) | −10 |
| ADX approximation | > 25 (strong trend) | +5 |

### Direction

- **long** — composite ≥ threshold AND intraScore > 50
- **short** — composite ≥ threshold AND intraScore ≤ 50
- **neutral** — composite < threshold

Results stored in the `signals` table. The auto-analysis loop runs every 30s on all `SUPPORTED_PAIRS`.

---

## 3. Auto-Executor (Signal → Entry)

**File:** `api/services/auto-executor.ts`

Converts gated signals into live or paper positions. Each signal must pass all gates in sequence before an order is placed.

### Gate Pipeline (14 checks, in order)

1. **Symbol whitelist** — symbol must be in `config.targetSymbols`
2. **Kill switch** — `globalKillSwitch.canTrade()` must be true
3. **Signal staleness** — reject if signal is > 60s old
4. **Dedup** — reject if same symbol+direction was executed in the last 60s (persisted to `dedup-cache-state.json` on disk, survives restarts)
5. **Duplicate position** — reject if an open position already exists for this symbol in the current mode (paper or live)
6. **Position cap** — reject if open positions ≥ `config.maxTotalPositions` (default 3)
7. **Funding rate** — `isFundingExtreme(symbol, side)` blocks when funding rate is extreme
8. **Correlation limit** — max 2 same-direction positions per correlation group (see [Correlation Guard](#13-correlation-guard))
9. **Spread filter** — reject if spread > 0.01 (1 basis point)
10. **Risk engine** — daily drawdown, cooldown, position size cap, margin health (see [Risk Engine](#4-risk-engine))
11. **KNN SuperTrend** — rejects if regime = `range`, or KNN bias conflicts with signal direction at < 60% confidence
12. **Price drift protection** — reject if `|currentPrice − signalPrice| / signalPrice > 0.5%`
13. **Order book depth** — reject if position notional > 5% of available book depth on the relevant side
14. **LLM Advisor** (optional) — if `config.useLlmAdvisor = true` AND signal is not brain-driven, calls `globalLlmAdvisor.analyzeSignal()` (brain-driven signals skip this to prevent self-veto)

### Position Sizing

```
notional   = min(sizeUsdt × sizeMult, walletBalance × capitalAllocationPct)
quantity   = notional / currentPrice
leverage   = min(manualOverride ?? strategyLeverage ?? defaultLeverage, 10)
margin     = notional / leverage
```

### Price Source Priority

1. CoinDCX mark price cache
2. Binance ticker cache (last price)
3. In-memory LTP from `MarketStateManager`
4. Binance REST (1m kline, 1 candle)

### LLM Advisor Outcomes

| Decision | Effect |
|----------|--------|
| `execute` | Proceeds; applies `sizeMult` (default 1.0) |
| `skip` | Rejects position if confidence ≥ threshold (default 70%) |
| `reduce_size` | Proceeds with reduced `sizeMult` (e.g. 0.5) |
| All keys unhealthy | Proceeds conservatively with `sizeMult = 0.5` |

---

## 4. Risk Engine

**File:** `api/services/risk-engine.ts`

Singleton `globalRiskEngine` maintains a per-user daily `RiskSession`. Sessions reset at UTC midnight and do not survive server restarts.

### Gates (checked in order)

**Gate 1 — Cooldown**
Blocks all trading if `consecutiveLosses ≥ maxConsecutiveLosses` (default 3) for 30 minutes. The cooldown resets to 0 on the first winning trade (PnL > 0).

**Gate 2 — Daily drawdown circuit breaker**
Blocks if `|min(0, realizedPnl)| / startingBalance ≥ dailyDrawdownPct`.
Default: 5% daily loss limit.

**Gate 3 — Position size cap**
Blocks if `notional > walletBalance × maxPositionPct`.
Default: 20% of balance per position.

**Gate 4 — Margin health**
Blocks if `usedMargin / totalBalance ≥ marginHealthHaltPct`.
Default: halts at 85% margin utilisation (i.e. requires ≥ 15% free margin).

### Default Config

```ts
maxPositionPct:        0.20   // 20% per trade
dailyDrawdownPct:      0.05   // 5% daily limit
maxConsecutiveLosses:  3
cooldownMs:            1_800_000  // 30 minutes
marginHealthHaltPct:   0.85
```

---

## 5. Trailing Stop Engine

**File:** `api/services/trailing-stop.ts`

Runs a 2-second tick on all registered positions. Supports three trail modes, applied per position.

### Mode 1 — Swing High/Low + ATR (Market Structure)

Uses detected swing points and 2× ATR as a dynamic buffer:

- **Long:** `newSL = max(currentSL, lastSwingLow, currentPrice − 2×ATR)`
- **Short:** `newSL = min(currentSL, lastSwingHigh, currentPrice + 2×ATR)`

### Mode 2 — Percentage Ratchet

SL ratchets with price, never moves against the position:

- **Long:** `newSL = max(currentSL, currentPrice × (1 − trailPct))`
- **Short:** `newSL = min(currentSL, currentPrice × (1 + trailPct))`

Trail percentages per strategy:

| Strategy | Trail % |
|----------|---------|
| `scalping_micro` | 0.3% |
| `scalping` | 0.5% |
| `bb_reversion` | 0.7% |
| `momentum_reversal` | 0.8% |
| `intraday` | 1.0% |
| `grid` | 1.0% |
| `ml_sizing` | 1.5% |
| `swing` | 2.0% |

### Mode 3 — Fee-Aware Breakeven (1:1 R/R)

When unrealised profit reaches the initial risk distance (1:1 R), moves SL to breakeven + 2× taker fee to guarantee a fee-positive exit:

- `breakeven (long)` = entry × 1.001 (entry + 0.1% buffer)
- `breakeven (short)` = entry × 0.999

Stop-out is fee-adjusted: `unrealisedPnL − (entryFee + exitFee)` where fee = `price × size × 0.05%`.

---

## 6. Position Manager (AI Lifecycle)

**Files:** `api/services/position-manager/`

A self-contained system that manages every open position from entry to close using a combination of market context, AI recommendations, and hard policy rules. Zero existing services were modified to add it.

### Assessment Cycle (every 30s per position)

```
1. buildMarketContext(symbol)
   ├── EMA 20/50/200, RSI(14), ATR(14) from 1m DB klines
   ├── CVD trend from MarketStateManager
   ├── Spread + bid/ask imbalance
   ├── Latest confluence score from signals table
   └── Funding rate, OI change

2. evaluateBias(ctx, position)
   ├── Score: −100 (strong bearish) to +100 (strong bullish)
   ├── EMA stack (+20), RSI (+15), volume (+10), CVD (+10),
   │   confluence alignment (+15), funding (+5)
   └── Sign flipped for shorts (bullish market = bad for a short)

3. ensureProtection(position, ctx)
   └── If SL or TP missing: calculate and place (ATR → Swing → midprice → percentage fallback)

4. getPositionRecommendation(position, ctx, bias)
   ├── LLM path: Ollama local (paper) or Ollama cloud 3-key rotation (live)
   └── Code fallback if LLM unavailable

5. policyGuard(recommendation, position, portfolio)
   ├── SCALE_IN: margin, correlation, equity %, risk engine checks
   ├── FULL_EXIT: confidence ≥ 0.60 required
   ├── PARTIAL_EXIT: confidence ≥ 0.45 required
   ├── TRAIL_SL: new SL must be strictly better than current
   └── MOVE_TO_BREAKEVEN: only allowed when unrealisedPnL > 0

6. executeAction → exchange call or DB update
```

### LLM Prompt Context (sent to AI)

Every AI call includes:

- Symbol, side, entry price, mark price, ROE %, unrealised PnL, hold time
- Leverage, current SL, current TP
- Market: trend direction, volatility regime, RSI, EMA20/50/200, CVD, funding
- Confluence score + aligned direction
- Bias score + confidence + contributing factors
- Portfolio: free balance, total unrealised PnL, open position count
- Behavioural instructions: default to KEEP_OPEN, never exit < 15 min hold unless stop triggered, confidence > 0.60 for full exits only

Response must be valid JSON with `action`, `confidence`, `reasoning`, and optional `newStopLoss`, `newTakeProfit`, `exitSizePct`.

### Code Fallback Rules (priority order)

1. Bias score < −65 → `FULL_EXIT`
2. RSI > 78 on long, RSI < 22 on short → `PARTIAL_EXIT` 50%
3. Price has moved ≥ 1R from entry → `MOVE_TO_BREAKEVEN`
4. ROE > 10% + strong trend + aligned bias → `TRAIL_SL` (2× ATR)
5. High volatility + held > 2h + ROE < 3% → `PARTIAL_EXIT` 30%
6. Bearish bias developing + ROE > 5% → `TIGHTEN_TP`
7. Confluence ≥ 65 and aligned with position → `KEEP_OPEN`
8. Default → `KEEP_OPEN`

### Supported Actions

| Action | Effect |
|--------|--------|
| `KEEP_OPEN` | No-op |
| `MOVE_TO_BREAKEVEN` | Set SL to entry + 0.1% buffer |
| `TRAIL_SL` | Move SL using 2× ATR |
| `PARTIAL_EXIT` | Close 30–50% via market order (live) or DB update (paper) |
| `FULL_EXIT` | Close entire position |
| `REDUCE_SIZE` | Reduce size (same as partial, different context) |
| `SCALE_IN` | Emit event to auto-executor queue (goes through full 14-gate pipeline) |
| `EXTEND_TP` | Move TP further away |
| `TIGHTEN_TP` | Move TP closer to lock in profit |

### Opportunity Cost Evaluator (every 10 min)

Compares the current position against fresh gated signals from the last 5 minutes:

```
ROE > 5%  AND  best_opportunity < 88                           → KEEP
ROE > 5%  AND  best_opportunity > 88  AND  position_score < 55 → REDUCE
ROE < -3% AND  best_opportunity > 80                           → EXIT
Held > 4h AND  |ROE| < 2%  AND  score < 55                    → REDUCE
Default                                                         → KEEP
```

### LLM Routing (paper vs live)

| Mode | LLM Used |
|------|----------|
| Paper (`isPaper=true`) | Local Ollama (`OLLAMA_ENDPOINT` + `OLLAMA_MODEL`) |
| Live (`isPaper=false`) | Ollama cloud — 3-key rotation (`pm-live-1/2/3` in DB or env vars) |

Cloud key backoff: 429 → 5 min, 503 → 2 min, other error → 30s. All keys down → code fallback.

### Position Lifecycle States

```
DISCOVERED → SYNCED → PROTECTED → MANAGED → REDUCING → EXITING → CLOSED
```

---

## 7. LLM Advisor (Entry Signals)

**File:** `api/services/llm-advisor.ts`

Optional gate in the auto-executor that filters low-conviction entry signals before an order is placed.

### Prompt Context Sent

```
Symbol: [symbol] perpetual
Market regime: [regime] → strategy: [strategy]
Signal direction: LONG|SHORT (composite score [N] / threshold [N])
Current price: [price]

Recent metrics:
- RSI(14): [N], EMA20: [N], EMA50: [N]
- Spread: [N]%, Imbalance: [N]
- Drawdown today: [N]%, Open positions: [N], Trades today: [N]

Conviction gates:
- Confluence score: [N] (threshold: [N])
- Confidence required to execute: [N]%

Decide: execute | skip | reduce_size
```

### Providers

- **Ollama** (local or cloud) — `/api/generate`
- **OpenAI-compatible** — `/v1/chat/completions`

### Key Rotation

Keys stored in `llm_api_keys` table sorted by `priority` ASC. On failure:

| Error | Backoff |
|-------|---------|
| 429 rate limit | 5 minutes |
| 503 unavailable | 2 minutes |
| Network error | 30 seconds |
| All keys unhealthy | Allow execute with `sizeMult = 0.5` |

---

## 8. AI Brain (Autonomous Decision Loop)

**Files:** `api/brain/`

An autonomous LLM-driven trading brain that operates independently from the Position Manager and Auto-Executor. Available via both a Hono HTTP router at `/api/brain` and a tRPC router (`trpc.brain.*`).

### Shadow Mode (default: on)

In shadow mode the brain logs all decisions to `brain_episodes` with `status = "shadow_logged"` but does NOT execute any trades or call the governor. This allows safe observation of brain behaviour before enabling live execution.

### ReAct Decision Loop

```
1. Observe — fetch MarketSnapshot + PortfolioSnapshot
2. Build system prompt with constrained format (Thought/Action/Observation/Final Answer)
3. Call LLM (local Ollama by default)
4. Parse response for tool calls or final answer
5. Execute read-only tools (up to 3 iterations for latency control)
6. Parse final answer:
   PROPOSE_TRADE LONG|SHORT|HOLD <size_pct> <sl_pct> <tp_pct> "<rationale>"
7. Validate with Zod schema
8. Run brainGovernor.check() if NOT in shadow mode
9. Emit decision event for tRPC subscription stream
```

### Brain Tools (read-only)

| Tool | Returns |
|------|---------|
| `getMarketSnapshot(symbol)` | LTP, bid/ask, spread, imbalance, absorptionScore, sweepScore, volatilityRegime, CVD |
| `getPortfolioSnapshot(userId)` | Balance, margin, unrealisedPnL, equity, drawdown, win rate, trade count |

### Governor (live mode only)

`brainGovernor.check()` applies hard risk constraints before any brain decision becomes a real trade: position size limits, drawdown checks, correlation limits, kill switch state.

### Learning Cycle (via `brain-scheduler.ts`, every 15 min)

1. **Reflection** (`brain-reflection.ts`) — after a trade closes, analyses the episode + realised PnL and writes lessons to `brain_reflections` and candidate rules to `brain_candidate_rules`
2. **Evolution** (`brain-evolution.ts`) — backtests stored strategies against historical data, promotes or rejects candidate rules based on Sharpe ratio and win rate

### Stored Data

| Table | Contents |
|-------|----------|
| `brain_episodes` | Every decision: observation, reasoning, proposed action, governor result |
| `brain_strategies` | Evolved strategy templates (name, prompt, Sharpe, win rate, status) |
| `brain_reflections` | Post-trade lessons extracted from episodes |
| `brain_candidate_rules` | Rules proposed by reflection, with backtest score and approval status |
| `brain_actions` | Every tool call made during an episode |

---

## 9. Price Action / SMC Analysis

**File:** `api/services/price-action.ts`

Detects Smart Money Concepts on 1m OHLCV data.

### Order Blocks

Bullish OB: bearish candle immediately followed by 3+ bullish candles that break the previous swing high. Bearish OB: inverse. Strength = `|displacement candle body| / ATR`. An OB is considered mitigated once price crosses its midpoint.

### Fair Value Gaps (FVGs)

Bullish FVG: gap between candle 1 high and candle 3 low (price skipped over a zone). Bearish FVG: inverse. Fill percentage tracked as penetration of the gap size.

### Market Structure (BOS / CHoCH)

- **Break of Structure (BOS)** — price breaks a swing high/low in the direction of the existing trend (continuation)
- **Change of Character (CHoCH)** — price breaks a swing high in a downtrend or swing low in an uptrend (potential reversal)

### Swing Points

5-bar lookback, classified as HH (higher high) / LH (lower high) / HL (higher low) / LL (lower low).

### Liquidity Levels

Swing high/low clusters with 0.1% tolerance. Labelled buy-side (previous highs, targets for shorts) or sell-side (previous lows, targets for longs). Marked as swept once price trades through them.

### Other Concepts

- **Displacement candles** — body > 2× ATR; signals institutional activity
- **Premium / Discount zones** — defined from swing range with 25%/75% equilibrium levels
- **On-Balance Volume (OBV)** — +volume if close > prev close, −volume if close < prev close

All concepts are exposed via the `market` tRPC router and consumed by the confluence engine, position manager, and the AI brain.

---

## 10. Regime Detection

**File:** `api/services/regime-detector.ts`

Classifies current market conditions and maps them to a trading strategy. Updates every 30s.

### Regime → Strategy Mapping

| Regime | Strategy | Detection logic |
|--------|----------|-----------------|
| `ranging_tight` | `scalping_micro` | ADX < 15 AND spread < 0.02% |
| `ranging` | `bb_reversion` | ADX < 20 (default) |
| `reversal` | `momentum_reversal` | ADX 20–30 AND RSI extreme (< 30 or > 70) |
| `intraday_trend` | `intraday` | ADX 20–30 AND EMA building |
| `swing_trend` | `swing` | ADX > 30 AND 4h EMA50 > EMA200 |
| `high_volatility` | `intraday` | ATR% > 2.0 |

### Priority Order

1. ATR > 2% → `high_volatility` (never scalp in chaos)
2. ADX > 30 → `swing_trend`
3. ADX ≥ 20 + RSI extreme → `reversal`
4. ADX ≥ 20 → `intraday_trend`
5. Spread < 0.02% + ADX < 15 → `ranging_tight`
6. Default → `ranging`

Per-regime strategy configs define `maxLeverage`, `stopLossPct`, `takeProfitPct`, `trailPct`, and `assessmentFrequency`. Auto-executor and position manager consume these.

---

## 11. KNN SuperTrend

**File:** `api/services/knn-supertrend.ts`

Combines a classic SuperTrend indicator with KNN classification to detect trend quality and suppress entries in ranging markets.

### SuperTrend Mechanics

- Bands computed as `HL/2 ± mult × ATR(14)` (Wilder smoothing)
- Upper band can only ratchet down; lower band can only ratchet up
- Direction flips when price crosses the active band
- ST level = lower band in uptrend, upper band in downtrend

### KNN Classification

- Feature vectors: RSI, MACD, volume, rate-of-change
- K = 7 nearest neighbours
- Labels derived from future return vs threshold
- Combined with SuperTrend direction to produce regime + confidence

### Regime Output

| Regime | Effect on auto-executor |
|--------|------------------------|
| `trend` | Entry allowed (ST + KNN agree) |
| `weak_trend` | Entry allowed (low confidence) |
| `range` | **Entry suppressed regardless of KNN confidence** |
| `transition` | Entry allowed with caution |

If KNN bias conflicts with signal direction at < 60% confidence, the auto-executor also rejects the signal.

---

## 12. Liquidity Engine

**File:** `api/services/liquidity-engine.ts`

Analyses order flow for institutional activity patterns. Outputs priority-rated events consumed by the alert engine.

### Concepts Detected

**Sweep Score** — `price_movement × log(volume)`. High score = aggressive directional move with volume support.

**Absorption Score** — `log(volume) / price_movement`. High score = large volume absorbed with minimal price impact, suggesting smart money accumulation or distribution.

**Liquidation Cascades** — 10+ liquidation events in 60s AND > $500k volume → priority `SS` alert.

**Short Squeeze** — negative funding (< −0.1%) + sweepScore > 60 → priority `SS`.

**Long Squeeze** — positive funding (> 0.1%) + sweepScore > 60 + price declining → priority `SS`.

**Absorption Signal** — absorptionScore > 40 + volume ≥ 2% of book depth → priority `S`. Upgraded to `SSS` if score > 80 + volume ≥ 5% of depth.

### Priority Levels

`SSS` (extreme) → `SS` (severe) → `S` (significant) → `A` (alert) → `B` (broadcast)

Per-symbol, per-type cooldown: 15s to prevent alert spam.

---

## 13. Correlation Guard

**File:** `api/services/correlation-guard.ts`

Prevents building multiple correlated positions that would amplify a single market move.

### Correlation Groups

| Group | Symbols |
|-------|---------|
| `crypto_beta` | BTC, ETH, SOL, BNB, AVAX, ADA, XRP, DOGE (all major perpetuals) |
| `other` | Everything else |

### Rule

Maximum 2 same-direction open positions per group. If 2 are already open, any new entry in that direction is rejected with the reason: `"[N] [side] crypto_beta positions open — correlation limit (max 2)"`.

---

## 14. Paper Trading

**File:** `api/services/paper-wallet.ts`

Fully isolated virtual trading environment that mirrors all live trading logic without touching the exchange.

### How It Works

Paper positions are stored with `isPaper = true` and excluded from all live position tracking. The virtual balance lives in `trading_accounts` (mode = "paper") with a full double-entry audit trail in `account_ledger`.

**Entry flow:**
1. Lock virtual margin: reduce available balance by `notional / leverage`
2. Create position with `isPaper = true`

**Exit flow:**
1. Calculate `realisedPnL`
2. Release margin: `availableBalance += margin + realisedPnL`
3. Update win/loss counters

**Equity formula:** `equity = walletBalance + unrealisedPnL` — `availableBalance = equity − lockedMargin`

### Isolation Guarantees

- No real orders ever sent to CoinDCX
- Paper positions use in-memory mark prices for PnL, same as live
- Paper LLM calls use local Ollama (free), live uses Ollama cloud
- Paper wallet can be reset at any time via `trpc.autoExecutor.resetPaperWallet()`

### Equity Snapshots

Hourly snapshots to `paper_equity_snapshots` for equity curve charting.

---

## 15. Alert Engine

**File:** `api/services/alert-engine.ts`

Evaluates user-defined and system-generated alert rules every 5 seconds.

### User-Defined Alert Types

| Type | Trigger condition |
|------|------------------|
| `price` | LTP crosses threshold (> or <) |
| `sweep` | `sweepScore` exceeds threshold |
| `absorption` | `absorptionScore` exceeds threshold |
| `imbalance` | Bid-ask imbalance crosses threshold (> or <) |
| `volatility` | `volatilityRegime` transitions to HIGH |

### System Event Types (emitted by confluence / signal analysis)

`bos` · `choch` · `fvg_fill` · `liq_sweep` · `ema_cross` · `bb_breakout` · `supertrend_flip` · `rsi_extreme` · `knn_bias_flip` · `knn_rejection` · `knn_regime_change` · `direction_flip` · `gated_flip`

### Delivery

- **Telegram:** broadcast to configured chat
- **Webhook:** POST to user-configured URL; 10s timeout; 1 automatic retry after 5s on failure; failures logged to `alert_delivery_failures`

### Cooldowns (spam prevention)

| Scope | Duration |
|-------|----------|
| Per-rule cooldown | Configurable (default 60s) |
| Per-symbol:type global cooldown | 10s |
| System alert dedup | 5s per symbol:type |

---

## 16. Telegram Integration

**Files:** `api/services/telegram.ts`, `api/services/telegram-bot.ts`

Two separate components: a notification service and a command bot.

### Notification Service (`telegram.ts`)

Broadcasts automatic alerts and events:

- Position opened / closed
- Liquidation warnings (5% proximity) and critical alerts (2% proximity)
- Risk events: cooldown started, drawdown limit hit
- All user and system alert dispatches

### Command Bot (`telegram-bot.ts`)

Polling-based bot. Supported commands:

| Command | Effect |
|---------|--------|
| `/status` | Open positions, unrealised PnL, today's realised PnL, uptime, kill switch status |
| `/pause` or `/stop` | Trigger global kill switch |
| `/resume` | Reset kill switch |
| `/closeall` | Emit close-all event (handled by execution manager) |
| `/pos <SYM>` | Single position detail |
| `/pnl` | Daily / weekly realised PnL summary |
| `/help` | List available commands |

---

## 17. Kill Switch

**File:** `api/services/kill-switch.ts`

A persistent emergency halt that blocks all new position creation until manually reset.

### State Persistence

State is written to `kill-switch-state.json` in the process working directory and survives server restarts. On boot, if the state reason starts with `"shutdown_"` it is treated as a clean restart artifact and cleared automatically; all other trigger types persist and must be manually reset.

### Trigger Types

| Type | Cause |
|------|-------|
| `manual` | Telegram `/pause`, dashboard button, or tRPC call |
| `drawdown` | Daily drawdown limit exceeded |
| `feed_failure` | 3+ symbols lose WebSocket feed within 60s |
| `api_error` | Exchange API unresponsive |
| `margin_breach` | Margin health below threshold |

### Reset

Via Telegram `/resume` or `trpc.autoExecutor.killSwitch({ action: "reset" })`. Clears the state file.

---

## 18. Liquidation Monitor

**File:** `api/services/liquidation-monitor.ts`

Monitors live positions every 10 seconds using CoinDCX mark price (LTP fallback). Paper positions are excluded.

### Actions by Proximity

| Proximity to liquidation | Action |
|--------------------------|--------|
| ≤ 5% | Telegram warning (once per 5-min cooldown per position) |
| ≤ 2% (CRITICAL) | Telegram critical alert + auto-reduce 50% of position size immediately |

---

## 19. Feed Health Monitoring

**File:** `api/services/feed-health.ts`

Monitors WebSocket feed liveness and triggers graceful degradation.

### Feed States

| State | Condition |
|-------|-----------|
| `connected` | Receiving messages normally |
| `degraded` | Silence > 3s, still connected |
| `reconnecting` | Silence > 10s, attempting reconnect |
| `rest_fallback` | Falls back to REST polling after max reconnect attempts |

### Backoff Formula

`delay = min(1000 × 2^attempt, 32_000 ms)`

### Events Emitted

| Event | When |
|-------|------|
| `degraded` | > 3s silence |
| `reconnecting` | > 10s silence (includes attempt count and next backoff) |
| `recovered` | Messages resume after degradation |

### Auto Kill Switch

If 3+ symbols enter `reconnecting` state within 60 seconds, the kill switch is triggered with reason `"feed_failure"` to prevent trading blind on stale data.

---

## 20. Position Reconciler

**File:** `api/services/position-reconciler.ts`

Runs every 5 minutes. Compares open positions in the database against positions on the exchange and corrects mismatches.

- Positions open in DB but not on exchange → marked as `closed` or `liquidated`
- Positions on exchange not in DB → flagged as orphaned (logged to `system_logs`)
- Size or PnL discrepancies → DB updated to match exchange

---

## 21. Performance Tracker

**File:** `api/services/performance-tracker.ts`

Computes rolling and aggregate trade metrics.

### Metrics

| Metric | Formula |
|--------|---------|
| Win Rate | `winCount / totalTrades` |
| Profit Factor | `grossWins / grossLosses` |
| Average Win | `grossWins / winCount` |
| Average Loss | `grossLosses / lossCount` |
| Largest Win/Loss | Max individual trade PnL |
| Current Streak | Consecutive wins (+) or losses (−) |
| Total Realised PnL | Sum of all closed position PnLs |

Also breaks down wins, losses, PnL, and trade count **per strategy type** (scalping, intraday, swing, etc.).

Equity snapshots are taken hourly and stored in `equity_snapshots` for charting.

---

## 22. Export Feature

**File:** `api/routers/export-router.ts`

### exportState (JSON)

Exports a full account snapshot:
- All open positions (current mode)
- Last 100 closed positions
- Last 50 signals
- Last 30 equity snapshots (chronological, ready for charting)

### exportTrades (CSV)

Columns: `id, symbol, side, entryPrice, exitPrice, size, leverage, realisedPnl, strategyType, createdAt, closedAt`

Supports optional `from` / `to` date range filters (ISO 8601). Fields containing commas, quotes, or newlines are properly escaped.

---

## 23. Frontend Dashboard

**File:** `src/App.tsx` + `src/pages/`

All authenticated pages are wrapped in `<Layout>` (sidebar + header + auth guard). Dark mode via `next-themes`.

| Route | Page | What it shows |
|-------|------|---------------|
| `/` | Dashboard | Portfolio summary, open positions, real-time PnL, quick stats, auto-executor controls |
| `/signals` | Signals | Gated signal list, confluence scores, direction, regime per symbol, live signal stream |
| `/portfolio` | Portfolio | Trade history, closed positions, equity curve, per-strategy performance breakdown |
| `/ai-analysis` | AiAnalysis | LLM advisor key health, entry signal recommendation stream, key rotation status |
| `/brain` | BrainDashboard | AI Brain episodes, reflections, proposed vs actual actions, shadow/live mode toggle |
| `/risk` | RiskMetrics | Daily drawdown, consecutive-loss cooldown, margin health, risk session state, equity snapshots |
| `/logs` | Logs | Structured system logs viewer — filterable by component, level (info/warn/error/critical/debug), date |
| `/login` | Login | OAuth redirect flow |
| `/` (home) | Home | Landing / index page |
| `*` | NotFound | 404 page |

### Real-time Updates

Subscriptions use the tRPC WebSocket link (automatic via `splitLink`). Key live streams:

- `trading.portfolioStream` — portfolio balance updates
- `signal.analysisStream` — new confluence scores
- `positionManager.assessmentStream` — AI assessment events
- `alerts.alertStream` — user and system alert delivery
- `llm.decisionStream` — LLM advisor decisions
- `/api/brain/logs/stream` (SSE) — AI Brain decision log

---

## 24. Authentication & Security

**Files:** `api/oauth/`, `api/lib/crypto.ts`

### OAuth2 Flow

1. Frontend redirects to OAuth provider with `redirect_uri` and `state` (base64 callback URL)
2. Provider redirects to `/api/oauth/callback?code=...&state=...`
3. Backend exchanges code for access token, verifies JWT via JWKS, fetches user profile
4. User upserted in `users` table; `OWNER_UNION_ID` match sets `role = admin`
5. Session JWT signed with `APP_SECRET`, stored as `janus_sid` cookie (1-year, httpOnly)
6. Every tRPC request: `createContext` reads cookie → verifies JWT → resolves user from DB

**Local dev:** when `AUTH_URL` = localhost, JWKS verification is skipped (mock OAuth, any token works).

### API Credential Encryption

Exchange API keys entered by users are encrypted with AES-256-GCM before storage in the `exchange_credentials` table. The encryption key is provided via `ENCRYPTION_KEY` (32-byte hex). This env var is required at production startup — the server throws if it is missing.

### Middleware Tiers

| Type | Requirement |
|------|-------------|
| `publicQuery` | No auth required |
| `authedQuery` | Valid `janus_sid` cookie → resolved user |
| `adminQuery` | `authedQuery` + `user.role === "admin"` |

All trading, risk, and portfolio routes use `authedQuery` and derive `userId` from `ctx.user.id` (the session), never from caller input.

### Trading Safety Defaults

All execution is off by default:

| Env var | Default | Effect when `"true"` |
|---------|---------|----------------------|
| `PLACE_ORDERS` | `false` | Sends real orders to CoinDCX |
| `AUTO_EXECUTE` | `false` | Enables the auto-executor |
| `PAPER_TRADING` | `false` | Forces all positions to paper mode |
| `USE_TESTNET` | `false` | Routes Binance data to testnet |
| `BOT_AUTO_START` | `false` | Auto-starts executor on boot |
