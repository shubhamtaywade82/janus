# CLAUDE.md — Janus Trading Dashboard

Complete reference for development, maintenance, and onboarding. Always trust the code over this file; update this file when behaviour changes.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Essential Commands](#essential-commands)
4. [High-Level Architecture](#high-level-architecture)
5. [Directory Structure](#directory-structure)
6. [Environment Variables](#environment-variables)
7. [Database Schema](#database-schema)
8. [TypeScript Path Aliases](#typescript-path-aliases)
9. [Authentication Flow](#authentication-flow)
10. [Real-time Data Pipeline](#real-time-data-pipeline)
11. [Confluence Scoring Engine](#confluence-scoring-engine)
12. [Auto-Executor (Signal → Entry)](#auto-executor-signal--entry)
13. [Risk Engine](#risk-engine)
14. [Trailing Stop Engine](#trailing-stop-engine)
15. [LLM Advisor (Entry Signals)](#llm-advisor-entry-signals)
16. [Position Manager (AI Lifecycle)](#position-manager-ai-lifecycle)
17. [tRPC Routers Reference](#trpc-routers-reference)
18. [Frontend Conventions](#frontend-conventions)
19. [Backend Conventions](#backend-conventions)
20. [Risk Safeguards Summary](#risk-safeguards-summary)
21. [Symbol Format Conventions](#symbol-format-conventions)
22. [Known Quirks & Gotchas](#known-quirks--gotchas)
23. [Build & Deploy](#build--deploy)

---

## Project Overview

Janus is a full-stack algorithmic trading dashboard and autonomous execution engine for CoinDCX futures. It:

- Streams live market data from Binance (public) and CoinDCX (private)
- Scores every tracked symbol every 30s using a multi-timeframe confluence engine
- Automatically opens positions when a signal is gated (score ≥ 75) via the auto-executor
- Manages open positions through their full lifecycle using an AI-driven position manager
- Provides a React dashboard for monitoring, manual trading, risk metrics, and logs

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS v3, shadcn/ui |
| Backend | Hono (HTTP), Node.js, tRPC v11 |
| Database | PostgreSQL via Drizzle ORM |
| Real-time | WebSocket (ws library) — tRPC subscriptions + Binance/CoinDCX streams |
| Auth | Custom OAuth2 flow + JWT/cookie sessions (jose) |
| Validation | Zod v4 |
| AI/LLM | Ollama (local), Ollama.com cloud, OpenAI-compatible providers |

> **Note**: The `README.md` references MySQL. The codebase uses PostgreSQL. Always trust the code.

---

## Essential Commands

```bash
# Development
npm run dev          # Vite dev server (port 3010) + Hono API backend
npm run build        # Build React SPA → dist/public + bundle api/boot.ts → dist/boot.js
npm start            # Run production server (NODE_ENV=production node dist/boot.js)

# Code quality
npm run check        # TypeScript type-check (tsc -b, all three tsconfigs)
npm run lint         # ESLint
npm run format       # Prettier (writes in-place)
npm run test         # Vitest (run once)

# Database
npm run db:generate  # Generate Drizzle migration files from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:push      # Push schema directly to DB (dev shortcut — no migration file created)
```

---

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  React SPA (Vite, port 3010 dev)                               │
│  trpc.tsx → splitLink → HTTP (queries/mutations)               │
│                       → WebSocket (subscriptions/streams)      │
└──────────────────────────────┬─────────────────────────────────┘
                               │ tRPC
┌──────────────────────────────▼─────────────────────────────────┐
│  Hono Server  api/boot.ts                                       │
│  /api/trpc/*  /api/oauth/*  /* (SPA static files)              │
│                                                                 │
│  Background services (started on boot):                         │
│  1. CoinDCX private WS  ──► positions, balances, mark prices   │
│  2. Auto signal analysis loop (30s) ──► confluence scores      │
│  3. Binance streaming WS per symbol ──► depth, trades, klines  │
│  4. LLM Advisor init ──► loads keys, starts refresh loop       │
│  5. Position Manager ──► AI lifecycle loop on open positions   │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Drizzle ORM
┌──────────────────────────────▼─────────────────────────────────┐
│  PostgreSQL                                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Signal-to-close full flow

```
Binance WS + CoinDCX WS
        │
        ▼
MarketStateManager (in-memory ring buffers per symbol)
        │
        ▼
Confluence Engine (every 30s) ─► signals table
        │ score ≥ 75
        ▼
AutoExecutor (8-gate check + LLM advisor)
        │ approved
        ▼
CoinDCX REST createFuturesOrder ─► positions table
        │
        ▼
TrailingStopEngine (2s tick)
        │
        ▼
Position Manager (30s assessment cycle)
   ├── MarketContextBuilder
   ├── BiasEvaluator
   ├── ProtectionManager (auto SL/TP)
   ├── AI Advisor (Ollama local/cloud)  ──► AiRecommendation
   ├── PolicyGuard  ──► approved action
   └── ExecutionManager ──► exchange call / DB update
```

### Dev vs Production ports

| Mode | HTTP | WebSocket |
|---|---|---|
| Dev | 3010 (Vite) | 3011 (standalone WS) |
| Production | `PORT` env (default 3010) | attached to HTTP server |

---

## Directory Structure

```
├── api/
│   ├── boot.ts                    # Server entry — HTTP, WS, background services
│   ├── router.ts                  # Root tRPC router (composes all sub-routers)
│   ├── context.ts                 # tRPC request context (session/user resolution)
│   ├── middleware.ts              # publicQuery / authedQuery / adminQuery factories
│   ├── auth-router.ts             # Auth tRPC endpoints
│   │
│   ├── oauth/                     # OAuth2 flow
│   │   └── auth.ts                # Token exchange, JWT session, platform user API
│   │
│   ├── queries/
│   │   ├── connection.ts          # getDb() — single Drizzle client instance
│   │   └── users.ts               # User DB helpers
│   │
│   ├── lib/
│   │   ├── env.ts                 # Typed env vars — throws in prod if missing
│   │   ├── cookies.ts             # Cookie read/write helpers
│   │   └── http.ts                # Lightweight fetch wrapper
│   │
│   ├── routers/                   # tRPC domain routers
│   │   ├── market-router.ts       # OHLC, order book, signals, price-action analysis
│   │   ├── trading-router.ts      # Positions, trades, portfolio, PnL, execution
│   │   ├── signal-router.ts       # Confluence scores, auto-analysis loop, regime detection
│   │   ├── bot-router.ts          # Auto-executor control (start/stop/config)
│   │   ├── auto-executor-router.ts# Executor config, paper wallet, kill switch, metrics
│   │   ├── llm-router.ts          # LLM key management, test, decision stream
│   │   ├── position-manager-router.ts  # AI position lifecycle status + stream
│   │   ├── logs-router.ts         # system_logs query
│   │   └── telegram-router.ts     # Telegram bot config + test message
│   │
│   └── services/                  # Core business logic
│       ├── market-state.ts        # MarketStateManager + RingBuffer per symbol
│       ├── confluence.ts          # Scoring: micro / intra / swing → composite
│       ├── streaming.ts           # Binance WS manager + marketEvents EventEmitter
│       ├── coindcx.ts             # CoinDCX REST API client (HMAC-SHA256 auth)
│       ├── coindcx-ws.ts          # CoinDCX private WS (positions/balances/mark prices)
│       ├── binance.ts             # Binance REST API client
│       ├── auto-executor.ts       # 8-gate signal pipeline → position creation
│       ├── risk-engine.ts         # Per-user daily risk session + trade gate
│       ├── trailing-stop.ts       # 2s trailing stop tick engine
│       ├── price-action.ts        # Swings, order blocks, FVGs, structure, liquidity
│       ├── strategy-config.ts     # STRATEGY_CONFIGS per regime
│       ├── llm-advisor.ts         # Multi-provider LLM client (entry signal filter)
│       ├── telegram.ts            # Telegram notification service
│       ├── ring-buffer.ts         # Fixed-capacity circular buffer
│       │
│       └── position-manager/      # AI position lifecycle system (self-contained)
│           ├── types.ts           # All types: ManagedPosition, PositionAction enum, etc.
│           ├── event-bus.ts       # Typed EventEmitter (positionManagerBus)
│           ├── position-store.ts  # In-memory hot state (no DB reads on hot path)
│           ├── market-context.ts  # MarketContextBuilder (EMA/RSI/ATR/CVD/confluence)
│           ├── bias-evaluator.ts  # STRONG_BULLISH → STRONG_BEARISH scorer
│           ├── sl-calculator.ts   # SL: ATR → Swing → mid-price → percentage
│           ├── tp-calculator.ts   # TP1/TP2/TP3 using R-multiples + EMA anchors
│           ├── protection-manager.ts  # Auto-place SL/TP on unprotected positions
│           ├── ai-advisor.ts      # AI call + 7-rule code fallback
│           ├── llm-client.ts      # Paper → local Ollama; Live → cloud 3-key rotation
│           ├── policy-guard.ts    # Validates AI actions against risk rules
│           ├── opportunity-cost.ts # Every 10min: KEEP / REDUCE / EXIT verdict
│           ├── execution-manager.ts # Maps PositionAction → exchange call / DB update
│           ├── position-lifecycle.ts # Main orchestrator (sync + assess + act loops)
│           └── index.ts           # Singleton export + wiring instructions
│
├── contracts/                     # Shared frontend ↔ backend
│   ├── constants.ts               # Session config, ErrorMessages, Paths
│   ├── types.ts                   # Re-exports db schema types + errors
│   └── errors.ts                  # AppError factory
│
├── db/
│   ├── schema.ts                  # All PostgreSQL table definitions (Drizzle)
│   ├── position-manager-schema.ts # Position manager tables (separate — additive)
│   ├── relations.ts               # Drizzle relation definitions
│   └── migrations/                # Generated SQL migration files
│
├── src/                           # React frontend
│   ├── main.tsx                   # Entry: TRPCProvider + BrowserRouter
│   ├── App.tsx                    # Route definitions
│   ├── providers/trpc.tsx         # tRPC + React Query client setup
│   ├── components/                # App-level components (Layout, AuthLayout, modals)
│   ├── components/ui/             # shadcn/ui primitives (do not modify)
│   ├── hooks/                     # useAuth, use-mobile
│   ├── pages/                     # Dashboard, Signals, Portfolio, Logs, RiskMetrics
│   └── lib/utils.ts               # cn() helper
│
└── scratch/                       # Throwaway scripts — never import in production
```

---

## Environment Variables

Copy `.env.example` to `.env`. All vars are optional in dev (default to empty string); required vars throw at production startup.

```ini
# ── Core ─────────────────────────────────────────────────────────
APP_ID=              # OAuth application ID
APP_SECRET=          # JWT signing secret
DATABASE_URL=        # PostgreSQL: postgres://user:pass@host:5432/dbname
PORT=                # HTTP server port in production (default: 3010)

# ── OAuth ────────────────────────────────────────────────────────
VITE_AUTH_URL=       # OAuth server URL (browser-visible)
VITE_APP_ID=         # OAuth app ID (browser-visible)
AUTH_URL=            # OAuth server URL (backend only)
AUTH_PLATFORM_URL=   # OAuth open platform URL (backend only)
OWNER_UNION_ID=      # First user to log in gets role=admin

# ── Trading safety ────────────────────────────────────────────────
PLACE_ORDERS=false   # Must be "true" to send real orders to CoinDCX
AUTO_EXECUTE=false   # Must be "true" to enable the auto-executor

# ── LLM / AI (entry signal advisor) ─────────────────────────────
OLLAMA_ENDPOINT=http://localhost:11434   # Local Ollama base URL
OLLAMA_BASE_URL=http://localhost:11434   # Alias — same as above
OLLAMA_MODEL=llama3.2                    # Model name for local Ollama
OLLAMA_API_KEYS=key1,key2               # Comma-separated keys for cloud Ollama
                                         # (used by main LLM advisor for entry signals)

# ── LLM / AI (position manager — live mode) ─────────────────────
# Used when no pm-live-* DB keys are configured (see Position Manager section)
PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com
PM_OLLAMA_CLOUD_MODEL=llama3.2
PM_OLLAMA_CLOUD_KEY_1=<key>
PM_OLLAMA_CLOUD_KEY_2=<key>
PM_OLLAMA_CLOUD_KEY_3=<key>

# ── Bot automation ────────────────────────────────────────────────
BOT_AUTO_START=false # Auto-start executor on server boot
```

---

## Database Schema

All tables defined in `db/schema.ts` unless noted. Use `.$inferSelect` / `.$inferInsert` for types.

### Core tables

| Table | File | Purpose |
|---|---|---|
| `users` | schema.ts | Auth users, Telegram integration |
| `market_data` | schema.ts | OHLC candlesticks (symbol + timeframe + timestamp unique) |
| `signals` | schema.ts | Confluence scores — micro/intra/swing/composite, direction, isGated |
| `positions` | schema.ts | Futures positions — live (isPaper=false) + paper (isPaper=true) |
| `trades` | schema.ts | Trade execution records |
| `order_book_snapshots` | schema.ts | Throttled depth snapshots (every 2s) |
| `recent_ticks` | schema.ts | Trade tape (every 1s) |
| `futures_wallets` | schema.ts | CoinDCX wallet balances — synced from balance-update WS |
| `exchange_credentials` | schema.ts | API key/secret per user per exchange |
| `transactions` | schema.ts | PnL ledger / audit trail |
| `system_logs` | schema.ts | Structured audit log (info/warn/error/critical/debug) |
| `llm_api_keys` | schema.ts | LLM provider keys with priority, health stats |
| `auto_executor_config` | schema.ts | Per-user executor config |
| `equity_snapshots` | schema.ts | Equity curve data points |
| `trading_accounts` | schema.ts | Unified live/paper wallet model |
| `account_ledger` | schema.ts | Event-driven double-entry audit trail |
| `account_snapshots` | schema.ts | Periodic equity captures per account |
| `open_interest_data` | schema.ts | OI snapshots (polled every 30s) |
| `funding_rate_history` | schema.ts | Funding rates from @markPrice WS |
| `liquidation_events` | schema.ts | Force orders from @forceOrder WS |

### Position Manager tables (db/position-manager-schema.ts)

| Table | Purpose |
|---|---|
| `ai_assessments` | Every AI/code assessment record — bias, action, reasoning, source, OppCost verdict |
| `position_snapshots` | Periodic mark-price / ROE / SL-TP state captures |
| `position_action_logs` | Audit trail of every action executed on a position |

### Key position fields

```ts
positions.isPaper          // true = DB-only paper position; false = live exchange order
positions.exchangeOrderId  // links to CoinDCX order ID for live positions
positions.status           // "open" | "closed" | "liquidated"
positions.signalId         // links to the signal that triggered auto-entry (null = manual)
positions.strategyType     // scalping | intraday | swing | ... (drives SL/TP/leverage)
positions.marginMode       // "isolated" | "cross"
positions.marginCurrency   // "USDT" | "INR"
```

---

## TypeScript Path Aliases

Defined in `tsconfig.json` and `vite.config.ts`:

| Alias | Resolves to |
|---|---|
| `@/*` | `./src/*` (frontend) |
| `@contracts/*` | `./contracts/*` |
| `@db/*` | `./db/*` |

`@db/position-manager-schema` → `./db/position-manager-schema.ts`

---

## Authentication Flow

1. Frontend redirects to OAuth provider with `redirect_uri` + `state` (base64 callback URL)
2. Provider redirects to `/api/oauth/callback?code=...&state=...`
3. Backend exchanges code for access token, verifies JWT via JWKS, fetches user profile
4. User upserted in `users` table; `OWNER_UNION_ID` match → role set to `admin`
5. Session JWT signed with `APP_SECRET`, set as `janus_sid` cookie (1-year max age, httpOnly)
6. Every tRPC request: `createContext` reads cookie → verifies JWT → looks up user in DB

**Local dev**: When `AUTH_URL` points to localhost, OAuth is mocked — no real provider needed.

---

## Real-time Data Pipeline

### Binance WebSocket (public)

`api/services/streaming.ts`

- `subscribeToSymbol(symbol)` opens a Binance combined stream for a symbol
- Streams: `@depth20@100ms`, `@trade`, `@ticker`, `@kline_1m`, `@forceOrder`, `@markPrice`
- First subscriber opens WS; last subscriber closes it (ref-counted)
- Auto-reconnect with exponential backoff on connection drop

**Emitted events** (via `marketEvents` EventEmitter):

| Event | When |
|---|---|
| `kline-update` | Every 1m candle close |
| `${symbol}:depth` | Every order book update |
| `${symbol}:trade` | Every trade |
| `${symbol}:ticker` | Every ticker update |

**Shared caches:**
```ts
latestTickerCache  // Map<binanceSymbol, { lastPrice, symbol }>
tickerStateCache   // Map<symbol, 24h aggregated stats>
```

**DB writes** (throttled):

| Data | Throttle |
|---|---|
| Order book depth | 2s |
| Trade ticks | 1s |
| Klines | 5s |
| Liquidation events | immediate |
| Funding rates | 60s |

### CoinDCX Private WebSocket (private)

`api/services/coindcx-ws.ts`

- Socket.io v2 to `wss://stream.coindcx.com`
- Auth: HMAC-SHA256 "join" event on channel "coindcx"
- Channels: `currentPrices@futures@rt`, `${pair}@prices-futures`, `${pair}_1m-futures`
- Events: `df-position-update`, `balance-update`, `user-orders`

**Shared caches:**
```ts
userPositionsCache  // Map<userId, livePosition[]>
userBalancesCache   // Map<userId, balance[]>
markPriceCache      // Map<coindcxPair, markPrice>  ← highest priority for PnL calc
tradingEvents       // EventEmitter — fires portfolio-update:${userId}
```

### In-memory MarketStateManager

`api/services/market-state.ts` — singleton `marketStateManager`

Per-symbol `InstrumentState` with typed `RingBuffer` windows:

| Buffer | Capacity | Contents |
|---|---|---|
| `ltpWindow` | 200 | Last traded price ticks |
| `tradeWindow` | 1000 | Trade tape (price, qty, side, isMaker) |
| `bookWindow` | 50 | Order book snapshots |
| `deltaWindow` | 500 | Liquidity delta events |
| `liquidationWindow` | 1000 | Force order events |
| `openInterestWindow` | 500 | OI snapshots |
| `cvdWindow` | 1000 | Cumulative volume delta ticks |

**Computed metrics** (updated on every order book event):

| Metric | Description |
|---|---|
| `spread`, `spreadPercent` | Bid-ask spread |
| `bidDepth`, `askDepth` | Total depth either side |
| `imbalance` | (bid - ask) / (bid + ask) |
| `bidAskImbalance` | Rolling average imbalance over book window |
| `liquidityAdded/Removed` | Rolling sum over delta window |
| `volatilityRegime` | LOW / NORMAL / HIGH based on LTP std dev |
| `sweepScore` | price movement × log(volume) |
| `absorptionScore` | log(volume) / price movement |

**Methods:**
```ts
marketStateManager.getOrInitializeState(symbol) // always safe to call
marketStateManager.analyzeCvd(symbol)           // returns trend + signalStrength + sessionDelta
```

---

## Confluence Scoring Engine

`api/services/confluence.ts`

```
Composite = 0.20 × Micro + 0.45 × Intra + 0.35 × Swing

Gate: signal is actionable only if Composite ≥ 75
```

| Component | Weight | Key inputs |
|---|---|---|
| Micro | 20% | Spread %, bid/ask imbalance, trade tape delta, maker ratio |
| Intra | 45% | RSI(14), EMA(20/50) crossover, volume surge, ROC(10) |
| Swing | 35% | EMA(50/200) trend, SMA(50) regime, S/R proximity, ADX |

All scores 0–100. Direction: `long` / `short` / `neutral`.

**Auto-analysis loop** (`signal-router.ts`): runs every 30s on all `SUPPORTED_PAIRS`, stores in `signals` table, optionally auto-switches regime.

**Regime types** (from `strategy-config.ts`):
`scalping_micro` | `scalping` | `intraday` | `swing` | `momentum_reversal` | `bb_reversion` | `ml_sizing` | `grid`

---

## Auto-Executor (Signal → Entry)

`api/services/auto-executor.ts` — converts gated signals into live/paper positions.

### 8-gate pipeline (all must pass)

1. AutoTrader enabled (`autoExecutorConfig.enabled`)
2. Global kill switch clear
3. Symbol in target list
4. No duplicate open position for that symbol + side
5. Total open positions < `maxTotalPositions`
6. Funding rate within acceptable range
7. Correlation limit: not too many same-direction positions
8. Risk engine approved (drawdown, cooldown, margin health)
9. *(optional)* LLM advisor: `execute` or `reduce_size` decision

### Position sizing

- Capital allocation: configurable % of free balance (e.g. 10%)
- Leverage: from strategy config or `defaultLeverage`, hard-capped at 10×
- Price source priority: CoinDCX mark → Binance ticker → in-memory LTP → REST

### Config (per user, stored in `auto_executor_config`)

```ts
enabled, targetSymbols, defaultSizeUsdt, defaultLeverage,
stopLossPct, tp1Pct, tp2Pct, useLlmAdvisor,
maxTotalPositions, capitalAllocationPct, useStrategyLeverage,
paperStartingBalance
```

### Control

```ts
trpc.bot.start()     // enable executor
trpc.bot.stop()      // disable executor
trpc.autoExecutor.killSwitch({ action: "trigger" })  // emergency halt
```

---

## Risk Engine

`api/services/risk-engine.ts`

Singleton `globalRiskEngine` with per-user daily `RiskSession`.

**`checkTradeAllowed(userId, size, balance, margin)`** returns `{ allowed, reason }`.

Gates:
1. **Cooldown**: if consecutive losses ≥ threshold, block for 30 min
2. **Daily drawdown**: block if realized PnL < -(drawdownLimit × startBalance)
3. **Position size cap**: single position may not exceed X% of balance
4. **Margin health**: free margin must stay above minimum threshold

Default config:
```ts
maxPositionSizePct: 0.20    // 20% of balance per trade
dailyDrawdownLimit: 0.05    // 5% daily loss limit
consecutiveLossLimit: 3     // cooldown after 3 losses
cooldownMinutes: 30
marginHealthMin: 0.10       // 10% free margin minimum
```

Sessions reset at UTC midnight. State is in-memory — does not survive server restarts.

---

## Trailing Stop Engine

`api/services/trailing-stop.ts`

Runs a 2s interval tick on all registered positions.

**Per-strategy trail percentages:**

| Strategy | Trail % |
|---|---|
| scalping_micro | 0.3% |
| scalping | 0.5% |
| bb_reversion | 0.7% |
| momentum_reversal | 0.8% |
| intraday | 1.0% |
| grid | 1.0% |
| ml_sizing | 1.5% |
| swing | 2.0% |

**Modes:**
- Standard percentage trail
- Market structure trail (swing points + ATR Chandelier)
- Fee-aware breakeven: moves SL to entry+fees after 1:1 R/R

**API:**
```ts
registerPositionForTrailing(position: TrackedPosition)
unregisterPosition(id: number)
shouldStopOut(id: number, currentPrice: number): boolean
```

---

## LLM Advisor (Entry Signals)

`api/services/llm-advisor.ts` — filters auto-executor entry signals.

### Providers
- **Ollama** (local or cloud) — `/api/generate`
- **OpenAI-compatible** — `/v1/chat/completions`

### Key rotation
Keys stored in `llm_api_keys` table, sorted by `priority` ASC. On failure:
- 429 → 5 min backoff
- 503 → 2 min backoff
- Other error → 30 s backoff
- All keys unhealthy → allow execute with `sizeMult=0.5`

### Decision output
```ts
{
  decision: "execute" | "skip" | "reduce_size",
  confidence: 0-100,
  sizeMult: 0.5 | 1.0 | 1.5,
  reasoning: string,
}
```

### Managing keys
```ts
trpc.llm.addKey({ label, provider, endpoint, apiKey, model, priority })
trpc.llm.toggleKey({ id, isActive })
trpc.llm.testKey({ id })
trpc.llm.keyStatus()
```

---

## Position Manager (AI Lifecycle)

`api/services/position-manager/` — a **separate, self-contained** system added on top of the existing stack. Zero existing files were modified; it reads existing DB tables but does not replace any existing service.

### Relationship to existing system

| Concern | Handled by |
|---|---|
| Signal generation | Confluence engine + signal-router |
| Entry execution | AutoExecutor |
| Stop-loss trailing | TrailingStopEngine |
| Risk gating | RiskEngine |
| **Post-entry AI management** | **PositionLifecycleManager** (new) |

Both the trailing stop engine and the position manager may update SL/TP. They are compatible — the trailing stop engine moves SL by fixed %, while the position manager uses AI/context-aware logic. Whichever moves the stop further in the favourable direction wins.

### Position lifecycle states

```
DISCOVERED → SYNCED → PROTECTED → MANAGED → REDUCING → EXITING → CLOSED
```

- **DISCOVERED**: first seen in DB/WS, not yet assessed
- **SYNCED**: price/PnL updated, not yet assessed
- **PROTECTED**: SL and TP confirmed present
- **MANAGED**: assessment running normally
- **REDUCING**: PARTIAL_EXIT or REDUCE_SIZE action in progress
- **EXITING**: FULL_EXIT action in progress
- **CLOSED**: position closed, removed from store

### Supported actions

```ts
enum PositionAction {
  KEEP_OPEN,           // no action
  MOVE_TO_BREAKEVEN,   // set SL to entry price (+ small buffer)
  TRAIL_SL,            // move SL closer to current price
  PARTIAL_EXIT,        // close 30–50% of position
  FULL_EXIT,           // close entire position
  REDUCE_SIZE,         // reduce position size (same as partial, different context)
  SCALE_IN,            // signal to auto-executor to add to position
  EXTEND_TP,           // move TP further away
  TIGHTEN_TP,          // move TP closer to lock in profit
}
```

### Assessment cycle (every 30s per open position)

```
1. buildMarketContext(symbol)
   ├── EMA 20/50/200, RSI(14), ATR(14) from 1m DB klines
   ├── CVD trend from MarketStateManager.analyzeCvd()
   ├── Spread, bid/ask imbalance from market metrics
   ├── Latest confluence score from signals table
   └── Funding rate, OI change from state

2. evaluateBias(ctx, position)
   ├── Score: -100 (strong bearish) to +100 (strong bullish)
   ├── Factors: EMA stack (20), RSI (15), volume (10), CVD (10),
   │             confluence alignment (15), funding (5)
   └── Flips sign for short positions (bullish market = bad for a short)

3. ensureProtection(position, ctx)
   └── If SL or TP missing: calculate and persist to DB

4. getPositionRecommendation(position, ctx, bias)
   ├── AI path: callPositionManagementLlm(prompt, isPaper)
   │   ├── isPaper=true  → local Ollama (OLLAMA_ENDPOINT)
   │   └── isPaper=false → Ollama.com cloud (3-key rotation, pm-live-1/2/3)
   └── Code fallback (7 rules, see below)

5. policyGuard(recommendation, position, portfolio)
   ├── SCALE_IN: checks margin, correlation, equity %, risk engine
   ├── FULL_EXIT: requires confidence ≥ 0.60
   ├── PARTIAL_EXIT: requires confidence ≥ 0.45
   ├── TRAIL_SL: new SL must be strictly better than current
   └── MOVE_TO_BREAKEVEN: only allowed when unrealizedPnl > 0

6. executeAction(position, recommendation, policy)
   ├── KEEP_OPEN → no-op
   ├── MOVE_TO_BREAKEVEN / TRAIL_SL / TIGHTEN_TP / EXTEND_TP → DB update
   ├── PARTIAL_EXIT / REDUCE_SIZE → exchange market order (live) + DB size update
   ├── FULL_EXIT → exchange market order (live) + DB status = closed
   └── SCALE_IN → emit event to auto-executor queue
```

### Code-based fallback rules (in priority order)

1. Strong bearish bias (score < −65) → FULL_EXIT
2. RSI > 78 on long, or RSI < 22 on short → PARTIAL_EXIT 50%
3. Price has moved 1R from entry → MOVE_TO_BREAKEVEN
4. ROE > 10% + strong trend + bullish bias → TRAIL_SL
5. High volatility + position held > 2h + ROE < 3% → PARTIAL_EXIT 30%
6. Bearish bias developing + ROE > 5% → TIGHTEN_TP
7. Confluence ≥ 65 and aligned with position direction → KEEP_OPEN
8. Default → KEEP_OPEN

### Opportunity cost evaluator (every 10 min)

Asks: "Is this the best use of my capital right now?"

Compares current position score against top gated signals from the last 5 minutes.

```
ROE > 5%  AND  best_opportunity < 88  →  KEEP
ROE > 5%  AND  best_opportunity > 88  AND  position_score < 55  →  REDUCE
ROE < -3% AND  best_opportunity > 80  →  EXIT
Held > 4h AND  |ROE| < 2%  AND  score < 55  →  REDUCE
Default  →  KEEP
```

### LLM routing (paper vs live)

```
Position.isPaper = true
  └─► Local Ollama
        OLLAMA_ENDPOINT + OLLAMA_MODEL (from env)
        No API key required

Position.isPaper = false
  └─► Ollama.com cloud — 3 keys, rotate on failure
        Priority 1: pm-live-1 key
        Priority 2: pm-live-2 key  (activated after key 1 backoff)
        Priority 3: pm-live-3 key  (last resort)
        All fail → code-based fallback

        Backoff:  429 → 5 min  |  503 → 2 min  |  other → 30 s
```

**Configuring cloud keys — Option A (DB, recommended):**

Add rows to `llm_api_keys` via the LLM key UI with these exact labels:

| label | endpoint | model | apiKey |
|---|---|---|---|
| `pm-live-1` | `https://ollama.com` | `llama3.2` | key 1 |
| `pm-live-2` | `https://ollama.com` | `llama3.2` | key 2 |
| `pm-live-3` | `https://ollama.com` | `llama3.2` | key 3 |

**Option B (env vars, fallback when no pm-live-* DB keys):**
```ini
PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com
PM_OLLAMA_CLOUD_MODEL=llama3.2
PM_OLLAMA_CLOUD_KEY_1=<key>
PM_OLLAMA_CLOUD_KEY_2=<key>
PM_OLLAMA_CLOUD_KEY_3=<key>
```

### Activating the position manager

The position manager is self-contained but not yet wired to `boot.ts` or `router.ts`. Add these when ready:

```ts
// api/boot.ts — after globalLlmAdvisor.init()
import { positionLifecycleManager } from "./services/position-manager/index";
setTimeout(() => positionLifecycleManager.start().catch(console.error), 5_000);

// api/router.ts — inside appRouter
import { positionManagerRouter } from "./routers/position-manager-router";
// positionManager: positionManagerRouter
```

```bash
# Create the 3 new DB tables
npm run db:push
```

### tRPC endpoints (`trpc.positionManager.*`)

| Endpoint | Type | Description |
|---|---|---|
| `status` | query | Live managed positions with lifecycle state + PnL |
| `recentAssessments` | query | Last 20 AI decisions (from memory) |
| `assessmentHistory` | query | DB-backed history, filterable by positionId |
| `forceAssess` | mutation | Trigger immediate assessment cycle |
| `getConfig` | query | Current config |
| `updateConfig` | mutation | Toggle AI, auto-apply, protection, intervals |
| `llmHealth` | query | Paper + live key health, backoff state |
| `assessmentStream` | subscription | Live events: assessment, action, lifecycle, error |

### In-memory PositionStore

```ts
positionStore.get(id)                  // fast O(1) lookup
positionStore.getOpen()                // all non-CLOSED/EXITING positions
positionStore.getBySymbol(binanceSym)  // all positions for a symbol
positionStore.totalUnrealizedPnl()     // sum across all open positions
positionStore.totalMarginUsed()
positionStore.sameSideCount(side)      // correlation check
```

### Event bus

```ts
import { positionManagerBus } from "./services/position-manager/event-bus";

positionManagerBus.on("position:discovered", (position) => { ... })
positionManagerBus.on("position:assessed", (record) => { ... })
positionManagerBus.on("position:action-executed", (id, action, result, detail) => { ... })
positionManagerBus.on("position:closed", (id, reason) => { ... })
positionManagerBus.on("position:lifecycle-changed", (id, from, to) => { ... })
```

---

## tRPC Routers Reference

All routers registered in `api/router.ts` under `appRouter`:

| Key | File | Responsibility |
|---|---|---|
| `ping` | router.ts | Health check |
| `auth` | auth-router.ts | Session, login, logout, me |
| `market` | market-router.ts | OHLC, order book, signals, price-action analysis |
| `trading` | trading-router.ts | Positions CRUD, portfolio, trades, PnL stream |
| `signal` | signal-router.ts | Confluence scores, analysis, regime, bot decisions |
| `bot` | bot-router.ts | AutoExecutor start/stop/strategy/regime control |
| `autoExecutor` | auto-executor-router.ts | Config, paper wallet, kill switch, metrics, equity curve |
| `llm` | llm-router.ts | LLM key management, test, decision stream |
| `logs` | logs-router.ts | system_logs query |
| `telegram` | telegram-router.ts | Telegram config + test message |
| `positionManager` | position-manager-router.ts | AI lifecycle status, config, stream *(add to router.ts)* |

### Procedure types

```ts
publicQuery    // no auth required
authedQuery    // requires janus_sid cookie → ctx.user
adminQuery     // requires authedQuery + user.role === "admin"
```

---

## Frontend Conventions

### Components

- `src/components/ui/` — shadcn/ui primitives. **Never modify these files.**
- `src/components/` — app-specific components. Add new ones here.

### Styling

```ts
import { cn } from "@/lib/utils";
// cn() = clsx + tailwind-merge
className={cn("base-class", condition && "conditional-class")}
```

Dark mode via `next-themes`. Theme variables in `src/index.css` (CSS custom properties).

### tRPC on the client

```ts
import { trpc } from "@/providers/trpc";

// Query
const { data, isLoading } = trpc.trading.portfolio.useQuery({ userId: 1 });

// Mutation
const close = trpc.trading.closePosition.useMutation({
  onSuccess: () => refetch(),
});

// Subscription (auto-uses WebSocket via splitLink)
trpc.trading.portfolioStream.useSubscription({ userId: 1 }, {
  onData: (update) => setPortfolio(update),
});
```

### Routing

React Router v7. Routes declared in `src/App.tsx`. Authenticated pages wrap in `<Layout>`.

---

## Backend Conventions

### Adding a tRPC router

1. Create `api/routers/my-router.ts`:
   ```ts
   import { createRouter, publicQuery } from "../middleware";
   export const myRouter = createRouter({ ... });
   ```
2. Import and register in `api/router.ts` under `appRouter`
3. The `AppRouter` type is automatically updated — frontend picks it up immediately

### Database access

```ts
import { getDb } from "../queries/connection";  // always via this helper
const db = getDb();
await db.select().from(table).where(eq(table.id, id));
```

Never import Drizzle directly. Avoid raw SQL except for PostgreSQL-specific constructs (`DISTINCT ON`, window functions).

### Error handling

```ts
import { TRPCError } from "@trpc/server";
throw new TRPCError({ code: "BAD_REQUEST", message: "..." });
throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
// codes: BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | INTERNAL_SERVER_ERROR
```

Use `Errors` from `@contracts/errors` for HTTP-level errors in OAuth middleware only.

### Background services pattern

Services that need to survive Vite HMR attach to `globalThis`:

```ts
const key = "__myService__";
if (!(globalThis as any)[key]) {
  (globalThis as any)[key] = new MyService();
}
export const myService = (globalThis as any)[key] as MyService;
```

---

## Risk Safeguards Summary

Layered defences — multiple must be bypassed to accidentally trade:

| Layer | Where | What it prevents |
|---|---|---|
| `PLACE_ORDERS=false` | env | Any real order reaching CoinDCX |
| `AUTO_EXECUTE=false` | env | Auto-executor from running |
| Kill switch | auto-executor + bot-router | Emergency halt of all new positions |
| Leverage cap (10×) | trading-router | Over-leveraged positions |
| SL buffer | trading-router | SL too close to liquidation price |
| Risk engine | risk-engine.ts | Over-sized trades, daily loss limit, consecutive loss cooldown |
| LLM filter | auto-executor (optional) | Low-conviction signals |
| Policy guard | position-manager | Unsafe AI actions on open positions |

---

## Symbol Format Conventions

Two formats in use — conversions must always be explicit:

| Exchange | Format | Example |
|---|---|---|
| Binance | `BASEUSDT` | `BTCUSDT`, `ETHUSDT` |
| CoinDCX | `B-BASE_USDT` | `B-BTC_USDT`, `B-ETH_USDT` |

```ts
// CoinDCX → Binance
const b = cdx.replace("B-", "").replace("_", "");  // B-ETH_USDT → ETHUSDT

// Binance → CoinDCX
const c = `B-${b.replace("USDT", "_USDT")}`;       // ETHUSDT → B-ETH_USDT
```

Canonical tracked instruments: `SUPPORTED_PAIRS` array in `api/services/binance.ts` — array of `{ binance, coindcx }` objects.

---

## Known Quirks & Gotchas

**Authentication & security**
- `publicQuery` is used on most trading routes. `userId` is caller-supplied, not session-derived. This is a known security gap — do not widen it.

**Database**
- `README.md` says MySQL. The codebase uses PostgreSQL. Ignore the README.
- `signal.latest` uses raw SQL `DISTINCT ON (symbol)` — PostgreSQL only. Result is snake_case, manually mapped to camelCase.

**CoinDCX API**
- Use `margin_currency_short_name` (not `margin_currency`) from live API responses.
- Returns `margin_type` in position objects; DB schema uses `margin_mode`. Both handled with fallback chaining in trading-router.
- HMAC payload must be compact JSON (no spaces) for signature to be valid.

**Development**
- `scratch/` directory contains throwaway scripts. Never import from it.
- Mock OAuth: when `AUTH_URL` = localhost, JWKS verification is skipped — any token works.
- Vite HMR: background services use `globalThis` as a singleton guard to prevent double-init.

**Position Manager**
- The position manager and trailing stop engine can both update SL — they are compatible. The trailing stop engine runs every 2s (fast), the position manager runs every 30s (context-aware).
- `SCALE_IN` action only emits an event; actual execution goes through the auto-executor's 8-gate pipeline.
- Opportunity cost runs every 10 min by default — adjust via `trpc.positionManager.updateConfig`.
- AI assessments are persisted to `ai_assessments` table (best-effort, non-blocking).

---

## Build & Deploy

### Build

```bash
npm run build
# Produces:
# dist/public/   ← Vite React SPA bundle
# dist/boot.js   ← Hono server bundle (esbuild, ESM, Node platform)
```

### Production startup

```bash
NODE_ENV=production node dist/boot.js
```

The production server:
1. Serves React SPA from `dist/public/` with SPA fallback
2. Mounts tRPC at `/api/trpc/*`
3. Handles OAuth callback at `/api/oauth/callback`
4. Attaches WebSocket server to the same HTTP port
5. Starts all background services (CoinDCX WS, signal analysis, LLM advisor, position manager)

### Database migrations

```bash
npm run db:generate   # generates SQL migration from schema diff
npm run db:migrate    # applies pending migrations
npm run db:push       # skips migration files, pushes schema directly (dev only)
```

For the position manager tables (in `db/position-manager-schema.ts`), they are included in `db:push` automatically because `drizzle.config.ts` scans the entire `db/` directory.
