# Janus: Algorithmic Trading Dashboard & Autonomous Execution Engine

> **Not the same as [`ecosystem/bots/janus/`](../ecosystem/bots/janus/)** — that folder is a minimal Python reference bot for the Ferment paper/live exchange runtime. **This repo** is the standalone CoinDCX futures dashboard and autonomous execution engine.

Janus is a full-stack algorithmic trading dashboard and autonomous execution engine for **CoinDCX futures**. It streams live market data from Binance (public) and CoinDCX (private), scores every tracked symbol every 30 seconds using a multi-timeframe confluence engine, automatically opens positions when a signal gates (score ≥ 75), and manages open positions through their full lifecycle using an AI-driven position manager.

Built on React 19 · Hono · tRPC · PostgreSQL · Drizzle ORM.

---

## Architecture Overview

```mermaid
graph TD
    subgraph FE["Frontend (React 19 + Vite 7)"]
        Pages["Dashboard / Signals / Portfolio\nAI Analysis / Brain / Risk / Logs"]
        TRPCClient["tRPC Client\n(splitLink: HTTP + WebSocket)"]
        Pages --> TRPCClient
    end

    subgraph BE["Backend (Hono 4 + Node.js)"]
        HTTP["HTTP :3010"]
        WS["WebSocket :3011 dev / :3010 prod"]
        Routers["14 tRPC Routers"]
        HTTP --> Routers
        WS --> Routers
    end

    subgraph SVC["Background Services (started on boot)"]
        BinanceWS["Binance WS\ndepth / trades / klines / OI / funding"]
        CoinDCXWS["CoinDCX Private WS\npositions / balances / mark prices"]
        SignalLoop["Confluence Signal Loop — 30s"]
        TrailingStop["Trailing Stop Engine — 2s"]
        PositionMgr["Position Lifecycle Manager — 30s"]
        AlertEngine["Alert Engine — 5s"]
        Reconciler["Position Reconciler — 5min"]
        LiqMonitor["Liquidation Monitor — 10s"]
        Brain["AI Brain Scheduler"]
    end

    subgraph EXT["External Integrations"]
        BinanceAPI["Binance REST + WS"]
        CoinDCXAPI["CoinDCX REST + Socket.io v2"]
        OllamaLocal["Ollama Local\npaper trading LLM"]
        OllamaCloud["Ollama Cloud\nlive LLM, 3-key rotation"]
        TelegramSvc["Telegram\nalerts + command bot"]
    end

    subgraph DB["PostgreSQL — Drizzle ORM"]
        CoreTables["users, positions, trades\nmarket_data, signals"]
        RiskTables["auto_executor_config\nexchange_credentials, trading_accounts"]
        AITables["ai_assessments, llm_api_keys\nposition_snapshots, brain_episodes"]
        AlertTables["user_alert_rules\nalert_delivery_failures, system_alert_logs"]
    end

    TRPCClient -->|"HTTP — queries / mutations"| HTTP
    TRPCClient -->|"WebSocket — subscriptions"| WS
    Routers --> SVC
    Routers --> DB
    BinanceWS --> BinanceAPI
    CoinDCXWS --> CoinDCXAPI
    PositionMgr --> OllamaLocal
    PositionMgr --> OllamaCloud
    AlertEngine --> TelegramSvc
    SignalLoop --> DB
    PositionMgr --> DB
```

### Signal-to-Close Data Flow

```
Binance WS (public)  +  CoinDCX WS (private)
              │
              ▼
  MarketStateManager — per-symbol ring buffers
  (LTP × 200, trades × 1000, book × 50, CVD × 1000, OI × 500, liquidations × 1000)
  Computed: spread, imbalance, volatility regime, sweep score
              │
              ▼
  Confluence Engine (every 30s)
  micro (20%) + intra (45%) + swing (35%) = composite score
  composite ≥ 75 → isGated = true → INSERT signals
              │
              ▼
  AutoExecutor — 8-gate pipeline
  [enabled] [kill switch] [dedup] [position cap]
  [funding rate] [correlation] [risk engine] [LLM advisor]
              │ approved
              ▼
  CoinDCX REST createFuturesOrder → INSERT positions
              │
     ┌────────┴─────────┐
     ▼                  ▼
  TrailingStopEngine    PositionLifecycleManager
  (every 2s)            (every 30s per open position)
  trail % per strategy  ├─ MarketContextBuilder (EMA/RSI/ATR/CVD/confluence)
  market-structure SL   ├─ BiasEvaluator (−100 bearish → +100 bullish)
  fee-aware breakeven   ├─ ProtectionManager (auto SL/TP)
                        ├─ AI Advisor (Ollama local/cloud → code fallback)
                        ├─ PolicyGuard (confidence gates, margin checks)
                        ├─ ExecutionManager (SL move, partial/full exit, scale-in)
                        └─ OpportunityCostEvaluator (every 10min: KEEP/REDUCE/EXIT)
```

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React | 19.2 |
| Build tool | Vite | 7.2 |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) | 3.4 |
| Charts | TradingView Lightweight Charts + Recharts | 5.2 / 2.15 |
| Forms | React Hook Form | 7.70 |
| Backend | Hono | 4.8 |
| API layer | tRPC | 11.8 |
| ORM | Drizzle ORM | 0.45 |
| Database | PostgreSQL (postgres driver) | — |
| Validation | Zod | 4.3 |
| Auth | jose (JWT) | 6.1 |
| WebSocket | ws | 8.21 |
| CoinDCX stream | Socket.io Client | 2.4 |
| LLM | Ollama (local + cloud) / OpenAI-compatible | — |
| Testing | Vitest | 4.0 |
| Linting | ESLint | 9.39 |
| Formatting | Prettier | 3.7 |

---

## Directory Structure

```text
├── api/
│   ├── boot.ts                        # Server entry — HTTP, WS, all background services
│   ├── router.ts                      # Root tRPC router (13 sub-routers)
│   ├── context.ts                     # tRPC request context (session/user resolution)
│   ├── middleware.ts                  # publicQuery / authedQuery / adminQuery factories
│   ├── auth-router.ts                 # Auth tRPC endpoints
│   │
│   ├── oauth/auth.ts                  # OAuth2 token exchange, JWT session, user upsert
│   ├── queries/connection.ts          # getDb() — single Drizzle client instance
│   │
│   ├── lib/
│   │   ├── env.ts                     # Typed env vars (throws in prod if missing)
│   │   ├── cookies.ts                 # Cookie read/write helpers
│   │   ├── http.ts                    # Lightweight fetch wrapper
│   │   ├── crypto.ts                  # AES-256-GCM field-level encryption (ENCRYPTION_KEY)
│   │   └── vite.ts                    # Static file serving helper for Vite dev server
│   │
│   ├── routers/
│   │   ├── market-router.ts           # OHLC, order book, price-action analysis
│   │   ├── trading-router.ts          # Positions, trades, portfolio, PnL stream
│   │   ├── signal-router.ts           # Confluence scores, regime detection, auto-analysis loop
│   │   ├── bot-router.ts              # Auto-executor start/stop/strategy control
│   │   ├── auto-executor-router.ts    # Config, kill switch, metrics, equity curve
│   │   ├── llm-router.ts              # LLM key management, test, decision stream
│   │   ├── position-manager-router.ts # AI lifecycle status, config, assessment stream
│   │   ├── alerts-router.ts           # User alert rules + delivery
│   │   ├── logs-router.ts             # system_logs query
│   │   ├── telegram-router.ts         # Telegram bot config + test message
│   │   ├── export-router.ts           # CSV/JSON data export
│   │   ├── health-router.ts           # System health + feed status
│   │   ├── brain-router.ts            # AI Brain Hono router (HTTP /api/brain)
│   │   └── brain-trpc-router.ts       # AI Brain tRPC router (trpc.brain.*)
│   │
│   ├── brain/                         # Autonomous AI Brain (LLM decision loop, shadow-mode)
│   │   ├── brain-orchestrator.ts      # BrainOrchestrator — main decide loop (shadowMode default)
│   │   ├── brain-memory.ts            # Qdrant vector store — episode embeddings (getEmbedding)
│   │   ├── brain-reflection.ts        # Post-trade reflection — learns from episode + realized PnL
│   │   ├── brain-evolution.ts         # Backtests + evolves stored strategies
│   │   ├── brain-governor.ts          # Approves/sizes brain decisions (risk gate)
│   │   ├── brain-scheduler.ts         # Background scheduler (15-min tick: reflect/evolve)
│   │   ├── tool-registry.ts           # MarketSnapshot + tools exposed to the LLM
│   │   ├── paper-adapter.ts           # ExecutionAdapter — paper execution for brain
│   │   └── schemas.ts                 # brainDecisionSchema (zod) + BrainDecision type
│   │
│   └── services/
│       ├── market-state.ts            # MarketStateManager + RingBuffer per symbol
│       ├── confluence.ts              # Scoring: micro / intra / swing → composite
│       ├── streaming.ts               # Binance WS manager + marketEvents EventEmitter
│       ├── coindcx.ts                 # CoinDCX REST client (HMAC-SHA256 auth)
│       ├── coindcx-ws.ts              # CoinDCX private WS (positions/balances/marks)
│       ├── binance.ts                 # Binance REST client + SUPPORTED_PAIRS
│       ├── auto-executor.ts           # 8-gate signal pipeline → position creation
│       ├── risk-engine.ts             # Per-user daily risk session + trade gate
│       ├── trailing-stop.ts           # 2s trailing stop tick engine
│       ├── price-action.ts            # Swings, order blocks, FVGs, structure, liquidity
│       ├── strategy-config.ts         # STRATEGY_CONFIGS per regime
│       ├── llm-advisor.ts             # Multi-provider LLM client (entry signal filter)
│       ├── alert-engine.ts            # Headless alert evaluation + delivery
│       ├── liquidation-monitor.ts     # Alert at 5%, auto-reduce at 2% proximity
│       ├── position-reconciler.ts     # DB vs exchange reconciliation every 5min
│       ├── telegram.ts                # Telegram notification service
│       ├── telegram-bot.ts            # Polling command bot (/status /pause /resume)
│       ├── ring-buffer.ts             # Fixed-capacity circular buffer
│       ├── correlation-guard.ts       # Prevents building correlated positions
│       ├── execution-providers.ts     # Order execution backend abstraction
│       ├── knn-supertrend.ts          # KNN-based supertrend algorithm
│       ├── liquidity-engine.ts        # Advanced liquidity analysis (sweep, absorption)
│       ├── llm-events.ts              # EventEmitter for LLM state changes
│       ├── ollama.ts                  # Ollama HTTP client wrapper
│       ├── paper-wallet.ts            # Paper trading balance tracking
│       ├── performance-tracker.ts     # Trade performance metrics (win rate, Sharpe, etc.)
│       ├── regime-detector.ts         # Market regime classification
│       ├── strategies.ts              # Strategy implementation library per regime
│       ├── trading-account.ts         # Unified trading account abstraction (live + paper)
│       │
│       └── position-manager/          # AI position lifecycle (self-contained)
│           ├── index.ts               # Singleton export + wiring
│           ├── types.ts               # PositionAction enum, ManagedPosition, config
│           ├── event-bus.ts           # Typed EventEmitter (positionManagerBus)
│           ├── position-store.ts      # In-memory hot state (O(1) lookup)
│           ├── market-context.ts      # MarketContextBuilder (EMA/RSI/ATR/CVD)
│           ├── bias-evaluator.ts      # STRONG_BULLISH → STRONG_BEARISH scorer
│           ├── sl-calculator.ts       # SL: ATR → Swing → mid-price → percentage
│           ├── tp-calculator.ts       # TP1/TP2/TP3 using R-multiples + EMA anchors
│           ├── protection-manager.ts  # Auto-place SL/TP on unprotected positions
│           ├── ai-advisor.ts          # AI call + 7-rule code fallback
│           ├── llm-client.ts          # Paper → local Ollama; Live → cloud 3-key rotation
│           ├── policy-guard.ts        # Validates AI actions against risk rules
│           ├── opportunity-cost.ts    # Every 10min: KEEP / REDUCE / EXIT verdict
│           ├── execution-manager.ts   # Maps action → exchange call / DB update
│           └── position-lifecycle.ts  # Main orchestrator (sync + assess + act loops)
│
├── contracts/
│   ├── constants.ts                   # Session config, ErrorMessages, Paths
│   ├── types.ts                       # Re-exports db schema types + errors
│   └── errors.ts                      # AppError factory
│
├── db/
│   ├── schema.ts                      # All PostgreSQL table definitions (Drizzle)
│   ├── position-manager-schema.ts     # Position manager tables (additive)
│   ├── relations.ts                   # Drizzle relation definitions
│   └── migrations/                    # Generated SQL migration files
│
├── src/                               # React frontend
│   ├── main.tsx                       # Entry: TRPCProvider + BrowserRouter
│   ├── App.tsx                        # Route definitions
│   ├── providers/trpc.tsx             # tRPC + React Query client (splitLink)
│   ├── components/                    # App-level components (Layout, AuthLayout)
│   ├── components/ui/                 # shadcn/ui primitives — do not modify
│   ├── hooks/                         # useAuth, use-mobile
│   ├── pages/                         # Dashboard, Signals, Portfolio, AiAnalysis,
│   │                                  # BrainDashboard, RiskMetrics, Logs, Login, Home, NotFound
│   └── lib/utils.ts                   # cn() helper (clsx + tailwind-merge)
│
└── scratch/                           # Throwaway scripts — never import in production
```

---

## Background Services

All services start on boot inside `api/boot.ts`. Graceful shutdown (SIGTERM/SIGINT) triggers the kill switch, stops all services, and allows 500 ms for in-flight DB writes.

| Service | Interval | Purpose |
|---|---|---|
| Binance WS | Real-time | Public depth, trades, klines, OI, funding, liquidations per symbol |
| CoinDCX Private WS | Real-time | Positions, balances, mark prices via Socket.io v2 |
| Confluence Signal Loop | 30 s | Score all SUPPORTED_PAIRS; store in `signals` table |
| Trailing Stop Engine | 2 s | Trail SL by strategy %, market-structure, fee-aware breakeven |
| Position Lifecycle Manager | 30 s | AI assessment + action execution on every open position |
| Alert Engine | 5 s | Evaluate user-defined rules + system events; deliver via Telegram/webhook |
| Position Reconciler | 5 min | Compare DB vs exchange; correct mismatches, mark orphans |
| Liquidation Monitor | 10 s | Alert at 5% proximity; auto-reduce 50% at 2% (live only) |
| AI Brain Scheduler | On boot | Vector store init, periodic reflection + strategy evolution |

---

## tRPC Routers

| Router | Key Procedures | Purpose |
|---|---|---|
| `auth` | `me`, `logout` | Session management, OAuth login |
| `market` | `klines`, `orderbook`, `trades`, `priceAction`, `fundingRate` | OHLC, order flow, liquidity analysis |
| `trading` | `portfolio`, `positions`, `closePosition`, `updateStopLoss`, `portfolioStream` | Position CRUD, PnL, live portfolio stream |
| `signal` | `latest`, `analysis`, `regime`, `recentGated`, `analysisStream` | Confluence scores, regime, live signal stream |
| `bot` | `status`, `start`, `stop`, `updateConfig`, `setRegime` | Auto-executor control plane |
| `autoExecutor` | `config`, `killSwitch`, `equityCurve`, `metrics` | Config, emergency halt, equity tracking |
| `llm` | `keyStatus`, `addKey`, `toggleKey`, `testKey`, `decisionStream` | LLM key management + decision stream |
| `positionManager` | `status`, `recentAssessments`, `forceAssess`, `assessmentStream` | AI lifecycle, config, assessment stream |
| `alerts` | `rules`, `addRule`, `deleteRule`, `alertStream` | User-defined alert rules + delivery |
| `logs` | `systemLogs` | Audit trail, filterable by component/level/date |
| `telegram` | `config`, `testMessage` | Telegram bot setup + test |
| `exports` | `exportPositions`, `exportTrades`, `exportLogs` | CSV/JSON data export |
| `health` | `status`, `dbCheck`, `feedHealth` | System health + feed status |
| `brain` | `episodes`, `reflections`, `decisionStream` | AI Brain episodes, reflections, decision stream |

---

## Database Schema

All tables defined in `db/schema.ts` (core) and `db/position-manager-schema.ts` (additive).

| Group | Tables |
|---|---|
| **Auth** | `users`, `exchange_credentials` |
| **Market data** | `market_data`, `signals`, `order_book_snapshots`, `recent_ticks`, `open_interest_data`, `funding_rate_history`, `liquidation_events` |
| **Trading** | `positions`, `trades`, `transactions`, `futures_wallets` |
| **Accounts** | `trading_accounts`, `account_ledger`, `account_snapshots`, `equity_snapshots` |
| **Paper trading** | `paper_accounts`, `paper_positions`, `paper_trades`, `paper_equity_snapshots` |
| **Automation** | `auto_executor_config` |
| **AI / LLM** | `llm_api_keys`, `ai_assessments`, `position_snapshots`, `position_action_logs` |
| **Alerts** | `user_alert_rules`, `user_alert_logs`, `system_alert_logs`, `alert_delivery_failures` |
| **Brain** | `brain_episodes`, `brain_strategies`, `brain_reflections`, `brain_candidate_rules`, `brain_actions`, `brain_tools` |
| **Audit** | `system_logs` |

---

## Setup & Installation

### Prerequisites

- Node.js v20+
- npm
- PostgreSQL
- Ollama (optional — for local LLM inference)

### Install

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```ini
# ── Core ───────────────────────────────────────────────────────────
APP_ID=<oauth-app-id>
APP_SECRET=<jwt-signing-secret>
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/janus
PORT=3010

# ── OAuth2 ─────────────────────────────────────────────────────────
VITE_AUTH_URL=https://auth.example.com     # browser-visible
VITE_APP_ID=<oauth-app-id>                 # browser-visible
AUTH_URL=https://auth.example.com          # backend only
AUTH_PLATFORM_URL=https://open.example.com # backend only
OWNER_UNION_ID=<admin-union-id>            # first login becomes admin

# ── Trading Safety (default off) ───────────────────────────────────
PLACE_ORDERS=false      # set to "true" to send real orders to CoinDCX
AUTO_EXECUTE=false      # set to "true" to enable the auto-executor
BOT_AUTO_START=false    # set to "true" to auto-start executor on boot
PAPER_TRADING=false     # set to "true" to force all positions as paper (no exchange orders)
USE_TESTNET=false       # set to "true" to route Binance data to testnet endpoints

# ── Security ──────────────────────────────────────────────────────
ENCRYPTION_KEY=         # 32-byte hex key for AES-256-GCM API credential encryption (required in prod)

# ── LLM — Entry Signal Advisor ─────────────────────────────────────
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_API_KEYS=key1,key2    # comma-separated cloud Ollama keys

# ── LLM — Position Manager (live mode) ────────────────────────────
PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com
PM_OLLAMA_CLOUD_MODEL=llama3.2
PM_OLLAMA_CLOUD_KEY_1=<key>
PM_OLLAMA_CLOUD_KEY_2=<key>
PM_OLLAMA_CLOUD_KEY_3=<key>
# Alternative: add rows to llm_api_keys table with labels pm-live-1/2/3
```

### Database Setup

```bash
npm run db:push       # push schema directly (dev — no migration file)
# or:
npm run db:generate   # generate migration files from schema diff
npm run db:migrate    # apply pending migrations
```

---

## Development

```bash
npm run dev     # Vite dev server + Hono backend — http://localhost:3010
npm run check   # TypeScript type-check (all three tsconfigs)
npm run lint    # ESLint
npm run test    # Vitest (run once)
npm run format  # Prettier (writes in-place)
```

Dev ports: Vite + HTTP on **3010**, WebSocket on **3011**.

---

## Production Deployment

```bash
npm run build   # → dist/public/ (React SPA) + dist/boot.js (Hono server)
npm start       # NODE_ENV=production node dist/boot.js
```

The production server serves the SPA, mounts tRPC at `/api/trpc/*`, handles OAuth at `/api/oauth/callback`, attaches WebSocket on the same port, and starts all background services.

---

## Risk Safeguards

Layered defences — multiple must be bypassed to accidentally place a live order.

| Layer | Control | Location |
|---|---|---|
| L1 | `PLACE_ORDERS=false` (default) | ENV |
| L2 | `AUTO_EXECUTE=false` (default) | ENV |
| L3 | Kill switch — emergency halt endpoint | `auto-executor-router` |
| L4 | Leverage hard cap (10×) | `trading-router` |
| L5 | SL must be ≥ liquidation price + 2% buffer | `sl-calculator` |
| L6 | Risk engine — 5% daily drawdown, 3-loss cooldown (30 min), 20% position cap, 10% margin minimum | `risk-engine` |
| L7 | LLM entry filter — low-confidence signals rejected | `llm-advisor` |
| L8 | Policy guard — AI actions validated against portfolio rules | `position-manager/policy-guard` |
| L9 | Liquidation monitor — alert at 5%, auto-reduce 50% at 2% | `liquidation-monitor` |
| L10 | Position reconciler — detect stale / orphaned positions | `position-reconciler` |
