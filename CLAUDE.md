# CLAUDE.md — Janus Trading Dashboard

## Project Overview

Janus is a full-stack algorithmic trading dashboard and execution engine. It provides real-time market data visualization, order book analysis, portfolio/position tracking, multi-timeframe confluence scoring, and live trade execution on CoinDCX futures.

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

> **Note**: The `README.md` references MySQL, but the actual `drizzle.config.ts` and `db/schema.ts` use PostgreSQL (`pg` dialect). Always trust the code.

---

## Essential Commands

```bash
npm run dev          # Vite dev server (port 3010) + Hono API backend
npm run build        # Build React SPA → dist/public + bundle api/boot.ts → dist/boot.js
npm start            # Run production server (NODE_ENV=production node dist/boot.js)
npm run check        # TypeScript type-check (tsc -b, all three tsconfigs)
npm run lint         # ESLint
npm run format       # Prettier (writes in-place)
npm run test         # Vitest (run once)

# Database
npm run db:generate  # Generate Drizzle migration files
npm run db:migrate   # Run pending migrations
npm run db:push      # Push schema directly (dev shortcut, skips migration files)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React Frontend (Vite SPA)                          │
│  trpc.tsx → splitLink → HTTP (queries/mutations)    │
│                       → WebSocket (subscriptions)   │
└──────────────────────────┬──────────────────────────┘
                           │ tRPC over HTTP/WS
┌──────────────────────────▼──────────────────────────┐
│  Hono Server (api/boot.ts)                          │
│  /api/trpc/* → tRPC fetch adapter                  │
│  /api/oauth/* → OAuth callback handler             │
│  /* → static SPA files (dist/public/)              │
│                                                     │
│  Background services (started on boot):             │
│  • CoinDCX private WebSocket (positions/balances)  │
│  • Auto signal analysis loop (every 30s)            │
│  • Binance streaming WS per subscribed symbol       │
└──────────────────────────┬──────────────────────────┘
                           │ Drizzle ORM
┌──────────────────────────▼──────────────────────────┐
│  PostgreSQL Database                                │
└─────────────────────────────────────────────────────┘
```

### Dev vs Production Ports

- **Dev**: Vite on port 3010, WebSocket server on port 3011
- **Production**: Single HTTP+WS server on `PORT` env var (default 3010)

---

## Directory Structure

```
├── api/                     # Backend (Node/Hono)
│   ├── boot.ts              # Server entry: HTTP routes, WS server, background services
│   ├── router.ts            # Root tRPC router (composes all sub-routers)
│   ├── context.ts           # tRPC request context (auth resolution)
│   ├── middleware.ts        # tRPC procedure factories: publicQuery, authedQuery, adminQuery
│   ├── auth-router.ts       # Auth tRPC router
│   ├── oauth/               # OAuth flow: token exchange, session JWT, platform user API
│   ├── queries/             # Raw DB query helpers (connection.ts, users.ts)
│   ├── routers/             # Domain tRPC routers
│   │   ├── market-router.ts
│   │   ├── trading-router.ts  # Positions, trades, portfolio, CoinDCX execution
│   │   ├── signal-router.ts   # Confluence signals + auto-analysis loop
│   │   ├── logs-router.ts
│   │   └── telegram-router.ts
│   ├── services/            # Core business logic
│   │   ├── market-state.ts  # In-memory MarketStateManager + RingBuffers
│   │   ├── confluence.ts    # Scoring engine: micro/intra/swing scores
│   │   ├── streaming.ts     # Binance WebSocket manager + event bus
│   │   ├── coindcx.ts       # CoinDCX REST API client
│   │   ├── coindcx-ws.ts    # CoinDCX private WebSocket (positions/balances)
│   │   ├── binance.ts       # Binance REST API client
│   │   ├── ring-buffer.ts   # Fixed-capacity circular buffer
│   │   └── telegram.ts      # Telegram notification service
│   └── lib/                 # Utilities: env.ts, cookies.ts, http.ts
│
├── contracts/               # Shared between frontend and backend
│   ├── constants.ts         # Session config, ErrorMessages, route Paths
│   ├── types.ts             # Re-exports db schema types + errors
│   └── errors.ts            # AppError factory (badRequest, forbidden, etc.)
│
├── db/
│   ├── schema.ts            # PostgreSQL table definitions (Drizzle)
│   ├── relations.ts         # Drizzle relation definitions
│   └── migrations/          # Generated SQL migration files
│
├── src/                     # React frontend
│   ├── main.tsx             # Entry point, wraps App with TRPCProvider + BrowserRouter
│   ├── App.tsx              # Route definitions
│   ├── providers/trpc.tsx   # tRPC + React Query client setup
│   ├── components/          # App-level components (Layout, AuthLayout, modals)
│   ├── components/ui/       # shadcn/ui primitives (40+ components)
│   ├── hooks/               # Custom hooks (useAuth, use-mobile)
│   ├── pages/               # Route pages: Dashboard, Signals, Portfolio, Logs, RiskMetrics
│   ├── lib/utils.ts         # cn() helper (clsx + tailwind-merge)
│   └── const.ts             # Frontend constants
│
└── scratch/                 # Throwaway exploration scripts (not production code)
```

---

## TypeScript Path Aliases

Defined in `tsconfig.json` and `vite.config.ts`:

| Alias | Resolves to |
|---|---|
| `@/*` | `./src/*` |
| `@contracts/*` | `./contracts/*` |
| `@db/*` | `./db/*` |

Use these in both `src/` (frontend) and `api/` (backend) code.

---

## tRPC Procedure Hierarchy

Three procedure factories in `api/middleware.ts`:

```
publicQuery    — no authentication required
authedQuery    — requires valid session cookie → user in context
adminQuery     — requires authedQuery + user.role === "admin"
```

All use `superjson` as the transformer (handles `Date`, `BigInt`, etc. transparently).

> **Current state**: Most trading routes currently use `publicQuery` despite being sensitive operations. They rely on caller-supplied `userId`. This is a known design issue — do not loosen protections further without considering the security implications.

---

## Authentication Flow

1. Frontend redirects to OAuth provider with `redirect_uri` + `state` (base64 of the callback URL)
2. Provider redirects to `/api/oauth/callback?code=...&state=...`
3. Backend exchanges code for access token, verifies JWT, fetches user profile
4. User is upserted in DB; session JWT signed with `APP_SECRET` and set as `janus_sid` cookie (1-year max age)
5. Each tRPC request: `createContext` reads `janus_sid`, verifies JWT, looks up user

**Local dev mock**: When `AUTH_URL` points to localhost, the flow uses mock tokens and skips JWKS verification.

---

## Database Schema (PostgreSQL)

Key tables and their purpose:

| Table | Purpose |
|---|---|
| `users` | Auth users with optional Telegram integration |
| `market_data` | OHLC candlestick data (multi-timeframe) |
| `signals` | Confluence scores per symbol (micro/intra/swing) |
| `positions` | Futures positions (open/closed/liquidated) |
| `trades` | Trade execution history |
| `order_book_snapshots` | Periodic depth snapshots |
| `recent_ticks` | Live trade tape |
| `futures_wallets` | CoinDCX futures wallet balances |
| `exchange_credentials` | API key/secret per user per exchange |
| `transactions` | PnL ledger / audit trail |
| `system_logs` | Audit log (info/warn/error/critical/debug) |

Drizzle uses `.$inferSelect` / `.$inferInsert` for type inference. Always import types from `@db/schema`, not the Drizzle primitives directly.

---

## Symbol Format Conventions

Two symbol formats are in use — conversions must be explicit:

| Exchange | Format | Example |
|---|---|---|
| Binance | `BASEUSDT` | `BTCUSDT`, `ETHUSDT` |
| CoinDCX | `B-BASE_USDT` | `B-BTC_USDT`, `B-ETH_USDT` |

Conversion helpers used throughout the codebase:
```ts
// CoinDCX → Binance
const binanceSym = coindcxPair.replace("B-", "").replace("_", ""); // B-ETH_USDT → ETHUSDT

// Binance → CoinDCX
const coindcxPair = `B-${binanceSym.replace("USDT", "_USDT")}`; // ETHUSDT → B-ETH_USDT
```

The `SUPPORTED_PAIRS` array in `api/services/binance.ts` is the canonical list of tracked instruments, containing `{ binance, coindcx }` objects.

---

## Real-time Data Architecture

### Binance WebSocket (public market data)
- `api/services/streaming.ts` — `subscribeToSymbol(symbol)` opens a combined stream: `depth20@100ms / trade / ticker / kline_1m`
- Uses spot stream (`stream.binance.com`) — futures stream is geo-restricted
- `latestTickerCache`: `Map<binanceSymbol, { lastPrice, symbol }>` — shared singleton
- `marketEvents` EventEmitter fires: `${symbol}:depth`, `${symbol}:trade`, `${symbol}:ticker`, `${symbol}:kline`
- DB writes are throttled: depth every 2s, trades every 1s, klines every 5s

### CoinDCX Private WebSocket
- `api/services/coindcx-ws.ts` — authenticated stream for live positions and balance updates
- `userPositionsCache`: `Map<userId, positions[]>` — updated by WS events
- `userBalancesCache`: `Map<userId, balances[]>`
- `markPriceCache`: `Map<coindcxPair, markPrice>` — used to override Binance prices for PnL calc
- `tradingEvents` EventEmitter fires `portfolio-update:${userId}` events

### In-memory MarketStateManager
- `api/services/market-state.ts` — singleton `marketStateManager`
- Per-symbol `InstrumentState` with `RingBuffer` windows:
  - `ltpWindow(200)` — last 200 price ticks
  - `tradeWindow(1000)` — last 1000 trades
  - `bookWindow(50)` — last 50 order book snapshots
  - `deltaWindow(500)` — last 500 liquidity deltas
- Computes real-time metrics: spread, bid/ask depth, imbalance, sweep score, absorption score, volatility regime

---

## Confluence Scoring Engine

`api/services/confluence.ts` — multi-timeframe signal generation:

```
Composite Score = 0.20 × Micro + 0.45 × Intra + 0.35 × Swing
Gate: execute only if Composite ≥ 75
```

| Component | Weight | Inputs |
|---|---|---|
| Micro (order book) | 20% | spread %, bid/ask imbalance, trade tape delta, maker ratio |
| Intra (technical) | 45% | RSI(14), EMA(20/50) crossover, volume surge, ROC(10) |
| Swing (macro) | 35% | EMA(50/200) trend, SMA(50) regime, S/R proximity, ADX |

All scores range 0–100. Direction is `long`/`short`/`neutral`. Auto-analysis runs every 30 seconds on all `SUPPORTED_PAIRS`, results stored in the `signals` table.

---

## Risk Safeguards

`api/routers/trading-router.ts` enforces these on `createPosition`:

1. **Leverage cap**: Maximum 10x — throws `BAD_REQUEST` if exceeded
2. **Stop-loss buffer**: Liquidation price distance must be ≥ 2× stop-loss distance from entry
3. **Live order gate**: `PLACE_ORDERS=true` must be set in env — defaults to `false` to prevent accidental trades

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```ini
APP_ID=              # OAuth application ID
APP_SECRET=          # JWT signing secret (keep secret)
DATABASE_URL=        # PostgreSQL connection string
VITE_AUTH_URL=       # OAuth server URL (exposed to browser)
VITE_APP_ID=         # OAuth app ID (exposed to browser)
AUTH_URL=            # OAuth server URL (backend)
AUTH_PLATFORM_URL=   # OAuth open platform URL (backend)
OWNER_UNION_ID=      # First-login user gets "admin" role
PLACE_ORDERS=        # Set to "true" to enable live CoinDCX trade execution (default: false)
PORT=                # HTTP server port in production (default: 3010)
```

`api/lib/env.ts` throws at startup if required vars are missing in production. In development, missing vars default to empty strings (no crash).

---

## Testing

Vitest is configured in `vitest.config.ts`. Tests live alongside source in `__tests__/` subdirectories.

```bash
npm run test         # Run all tests once
```

Current test coverage: `api/services/__tests__/market-state.test.ts` covers `RingBuffer`, `calculateLiquidityDelta`, and `MarketStateManager`.

When adding tests, import from `vitest` (`describe`, `it`, `expect`, `beforeEach`), not Jest.

---

## Frontend Conventions

### UI Components
All shadcn/ui primitives live in `src/components/ui/`. Import them with the `@/` alias:
```ts
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
```

Never modify files in `src/components/ui/` — treat them as a library. Place app-specific components directly in `src/components/`.

### Styling
- Tailwind CSS v3 with shadcn theme variables (CSS custom properties in `src/index.css`)
- Use `cn()` from `src/lib/utils.ts` for conditional class merging: `cn("base", condition && "extra")`
- Dark mode is managed via `next-themes`

### tRPC on the Client
```ts
import { trpc } from "@/providers/trpc";

// Query
const { data } = trpc.trading.portfolio.useQuery({ userId: 1 });

// Mutation
const mutation = trpc.trading.createPosition.useMutation();

// Subscription (uses WebSocket automatically via splitLink)
trpc.trading.portfolioStream.useSubscription({ userId: 1 }, {
  onData: (data) => { /* ... */ },
});
```

### Routing
React Router v7 with routes declared in `src/App.tsx`. Pages wrap in `<Layout>` for authenticated views.

---

## Backend Conventions

### Adding a new tRPC router
1. Create `api/routers/my-router.ts`, export `myRouter = createRouter({ ... })`
2. Import and register in `api/router.ts` under `appRouter`
3. Use `publicQuery`, `authedQuery`, or `adminQuery` as the base procedure

### Database queries
Always get the DB connection via `getDb()` from `api/queries/connection.ts` — never import the Drizzle client directly. Use Drizzle's query builder; avoid raw SQL except for `DISTINCT ON` and other PostgreSQL-specific constructs.

### Error handling in routers
Throw `TRPCError` for expected failures:
```ts
throw new TRPCError({ code: "BAD_REQUEST", message: "..." });
throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
```

Use `Errors` from `@contracts/errors` for HTTP-level errors in OAuth/middleware code.

---

## Build Output

```
dist/
├── public/      # Vite React SPA bundle (served as static files)
└── boot.js      # Bundled Hono server (esbuild, ESM, Node platform)
```

The production server (`boot.js`) serves static files from `dist/public/` with SPA fallback to `index.html` for all non-API routes.

---

## Known Quirks & Gotchas

- **`publicQuery` on sensitive routes**: The trading router uses `publicQuery` (no auth check) on operations like `createPosition`. The `userId` is passed as input, not derived from the session. This is a known gap — do not rely on it as a security boundary.
- **README says MySQL**: The codebase uses PostgreSQL. The README is outdated.
- **`DISTINCT ON` in signal-router**: `signal.latest` uses raw SQL `DISTINCT ON (symbol)` — a PostgreSQL-specific feature. The raw result uses snake_case columns and is manually mapped to camelCase.
- **Mock OAuth in dev**: When `AUTH_URL` resolves to localhost, the server auto-mocks OAuth tokens. You can log in without a real OAuth provider.
- **`scratch/` directory**: Contains throwaway test scripts. Do not reference or import from this directory in production code.
- **CoinDCX margin currency fields**: Use `margin_currency_short_name` (not `margin_currency`) from live API responses — field name differs from documentation.
- **`margin_type` vs `margin_mode`**: CoinDCX returns `margin_type` (not `margin_mode`) in position objects. The DB schema uses `margin_mode`. Both are handled in the router with fallback chaining.
