# Janus Trading Bot — Complete Setup Guide

Everything you need to go from a fresh clone to a running bot in any mode: **development**, **paper trading**, **testnet**, or **live trading**.

> **Read every section that applies to your mode before running anything.** The safety sections are not optional.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [PostgreSQL Setup](#3-postgresql-setup)
4. [Environment Configuration](#4-environment-configuration)
5. [Authentication Setup](#5-authentication-setup)
6. [Database Migrations](#6-database-migrations)
7. [Build](#7-build)
8. [Running the App](#8-running-the-app)
9. [First Login & Admin Setup](#9-first-login--admin-setup)
10. [Exchange Credentials](#10-exchange-credentials)
11. [Auto-Executor Configuration](#11-auto-executor-configuration)
12. [Telegram Bot Setup](#12-telegram-bot-setup)
13. [LLM / AI Advisor Setup](#13-llm--ai-advisor-setup)
14. [Operating Modes](#14-operating-modes)
    - [Development (Hot-Reload)](#141-development-hot-reload)
    - [Paper Trading](#142-paper-trading)
    - [Testnet](#143-testnet)
    - [Live Trading](#144-live-trading)
15. [Health & Monitoring](#15-health--monitoring)
16. [Deployment Options](#16-deployment-options)
    - [PM2 (Recommended)](#161-pm2-recommended)
    - [Docker Compose](#162-docker-compose)
17. [Pre-Live Preflight Checklist](#17-pre-live-preflight-checklist)
18. [Environment Variable Reference](#18-environment-variable-reference)
19. [Architecture Overview](#19-architecture-overview)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Prerequisites

### Required

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | https://nodejs.org or `nvm install 20` |
| npm | 10+ | Bundled with Node.js |
| PostgreSQL | 14+ | See [Section 3](#3-postgresql-setup) |
| Git | Any | https://git-scm.com |

### Optional (needed for specific modes)

| Tool | When Needed | Install |
|---|---|---|
| PM2 | Production (non-Docker) | `npm install -g pm2` |
| Docker + Docker Compose | Docker deployment | https://docs.docker.com/get-docker |
| Ollama | Local LLM advisor | https://ollama.com/download |
| `psql` CLI | DB backup/restore scripts | Bundled with PostgreSQL |

### External accounts required

| Service | Required For | Notes |
|---|---|---|
| **CoinDCX account** | Any live trading | Futures API key must have Trade + Read permissions |
| **Binance account** | Market data | No API key needed — Binance public WS is used |
| **OAuth provider** | Authentication | Any OAuth2-compliant provider (or skip in dev — see [Section 5](#5-authentication-setup)) |
| **Telegram bot** | Alerts & commands | Optional but strongly recommended for production |
| **Ollama** | LLM advisor | Optional — bot works without it (signals still execute) |

---

## 2. Clone & Install

```bash
git clone https://github.com/shubhamtaywade82/janus.git
cd janus
npm install
```

Confirm you're on the right branch:

```bash
git log --oneline -3
```

---

## 3. PostgreSQL Setup

### Option A — Local PostgreSQL

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16

# Ubuntu/Debian
sudo apt install postgresql-16
sudo systemctl start postgresql

# Create the database and user
psql -U postgres -c "CREATE USER janus WITH PASSWORD 'your_strong_password';"
psql -U postgres -c "CREATE DATABASE janus_production OWNER janus;"
```

Your `DATABASE_URL` will be:
```
postgres://janus:your_strong_password@localhost:5432/janus_production
```

### Option B — Docker (quick start)

```bash
docker run -d \
  --name janus-postgres \
  -e POSTGRES_DB=janus_production \
  -e POSTGRES_USER=janus \
  -e POSTGRES_PASSWORD=your_strong_password \
  -p 5432:5432 \
  -v janus_pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

### Option C — Docker Compose (full stack)

Skip this section. The full-stack Docker Compose setup in [Section 16.2](#162-docker-compose) handles PostgreSQL automatically.

---

## 4. Environment Configuration

Copy the example file and fill it in:

```bash
cp .env.example .env
```

Open `.env` in your editor. The sections below explain every value.

### 4.1 Generate the Encryption Key (REQUIRED for production)

The encryption key protects your API credentials at rest using AES-256-GCM. Without it, credentials are stored in plaintext (acceptable for local dev only).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example output: a3f8e2c1d4b7...  (64 hex characters)
```

Paste the output as `ENCRYPTION_KEY` in `.env`.

> **Critical:** This key is the master secret for all encrypted credentials. Back it up securely and never commit it to version control. Losing it means you cannot decrypt any stored API keys.

### 4.2 Minimum Required Variables

```ini
APP_ID=your_oauth_app_id
APP_SECRET=your_jwt_signing_secret_min_32_chars
DATABASE_URL=postgres://janus:password@localhost:5432/janus_production
AUTH_URL=https://your-oauth-provider.com
AUTH_PLATFORM_URL=https://your-oauth-provider.com
ENCRYPTION_KEY=<64-hex-chars-from-above>
```

Everything else has a safe default. Full reference in [Section 18](#18-environment-variable-reference).

---

## 5. Authentication Setup

Janus uses OAuth2 for user authentication. Choose one of these approaches.

### 5.1 Local Development (No OAuth Provider Needed)

If `AUTH_URL` contains `localhost` or `127.0.0.1`, authentication is **automatically mocked**:
- No real OAuth provider needed
- Any login attempt succeeds
- The mock user's `unionId` is set to the value of `OWNER_UNION_ID`
- JWKS verification is skipped

**Dev `.env` minimum:**
```ini
AUTH_URL=http://localhost:9999       # fake URL — just needs "localhost" in it
AUTH_PLATFORM_URL=http://localhost:9999
APP_ID=dev-app-id
APP_SECRET=dev-secret-at-least-32-chars-long
OWNER_UNION_ID=dev-user-001          # your local admin user ID
```

### 5.2 Real OAuth Provider

1. Create an OAuth app at your provider
2. Set the callback URL to: `https://your-domain.com/api/oauth/callback`
3. Get your `client_id` → set as `APP_ID` and `VITE_APP_ID`
4. Get your `client_secret` → set as `APP_SECRET`
5. Set `AUTH_URL` to the provider's OAuth base URL
6. Set `AUTH_PLATFORM_URL` to the provider's open platform/user API base URL

**What the provider must expose:**
- `GET {AUTH_URL}/api/.well-known/jwks.json` — JWKS for JWT verification
- `POST {AUTH_URL}/api/oauth/token` — token exchange endpoint
- `GET {AUTH_PLATFORM_URL}/open/api/user/me` (or similar) — user profile endpoint

---

## 6. Database Migrations

Run migrations before starting the server for the first time, and after every deployment:

```bash
# Apply all pending SQL migrations
npm run db:migrate

# Additionally push position manager tables (no SQL migration file generated)
npm run db:push
```

> `db:migrate` applies the versioned SQL files in `db/migrations/`.
> `db:push` syncs the full schema directly — use in dev or for the additive position-manager tables.

**What gets created:**

Core tables (22):
`users`, `market_data`, `signals`, `positions`, `trades`, `order_book_snapshots`, `recent_ticks`, `futures_wallets`, `exchange_credentials`, `transactions`, `system_logs`, `llm_api_keys`, `auto_executor_config`, `equity_snapshots`, `trading_accounts`, `account_ledger`, `account_snapshots`, `open_interest_data`, `funding_rate_history`, `liquidation_events`

Position manager tables (3, via `db:push`):
`ai_assessments`, `position_snapshots`, `position_action_logs`

---

## 7. Build

```bash
npm run build
```

This produces:
- `dist/public/` — React SPA bundle (served as static files)
- `dist/boot.js` — Hono server bundle (Node.js ESM)

> Skip this step if you're running in development mode (`npm run dev` builds on the fly).

---

## 8. Running the App

### Development

```bash
npm run dev
```

- Vite dev server on `http://localhost:3010`
- Hot module replacement (HMR) active
- WebSocket server on `ws://localhost:3011` (separate from HTTP)
- Uses mock OAuth if `AUTH_URL` contains `localhost`

### Production (direct)

```bash
NODE_ENV=production node dist/boot.js
# or
npm start
```

### Production (PM2 — recommended)

See [Section 16.1](#161-pm2-recommended).

### Production (Docker Compose)

See [Section 16.2](#162-docker-compose).

---

## 9. First Login & Admin Setup

### Step 1 — Log In

Navigate to `http://localhost:3010`. You'll be redirected to the OAuth provider (or the mock login in dev mode). Complete the login flow.

On first login:
- A `users` row is created in the database
- Your `unionId` (from the OAuth token) is stored

### Step 2 — Set Yourself as Admin

The first user whose `unionId` matches `OWNER_UNION_ID` gets `role = "admin"`.

**If you didn't set `OWNER_UNION_ID` before first login:**

```bash
# Find your unionId after logging in
psql $DATABASE_URL -c "SELECT id, union_id, email, role FROM users;"

# Copy the union_id value, add it to .env:
OWNER_UNION_ID=<your_union_id_here>

# Update the existing user in DB
psql $DATABASE_URL -c "UPDATE users SET role='admin' WHERE union_id='<your_union_id>';"

# Restart the server to pick up the new env var
```

> Only one user can be admin. `OWNER_UNION_ID` is a bootstrap mechanism — once the admin row exists, it stays admin regardless of this variable.

---

## 10. Exchange Credentials

CoinDCX API credentials are entered via the dashboard UI and stored **encrypted** in the database. Never put them in `.env` directly.

### Step 1 — Get CoinDCX API Keys

1. Log in to CoinDCX
2. Go to **Account → API Key Management**
3. Create a key with permissions: **Read** + **Trade**
4. Copy the API Key and API Secret immediately (shown only once)

### Step 2 — Add Credentials in the Dashboard

1. Open the Janus dashboard: `http://localhost:3010`
2. Navigate to **Settings → Exchange Credentials**
3. Select exchange: `coindcx`
4. Paste your API Key and API Secret
5. Click Save

The values are encrypted with `ENCRYPTION_KEY` using AES-256-GCM before storage. Each time the bot needs to make a CoinDCX API call, it decrypts on-demand — the plaintext never persists.

### Step 3 — Verify Connection

After saving, use the "Test Connection" button (if available) or watch the logs:

```bash
pm2 logs janus-bot --lines 20 | grep -i coindcx
```

You should see balance sync events on startup.

---

## 11. Auto-Executor Configuration

The auto-executor converts confluence-gated signals into positions. All config is stored in the `auto_executor_config` database table and configurable via the UI.

### Via Dashboard

Navigate to **Bot Config** (or **Auto-Executor**) in the dashboard:

| Setting | Description | Default | Notes |
|---|---|---|---|
| `enabled` | Master on/off toggle | `false` | Also requires `AUTO_EXECUTE=true` env var |
| `targetSymbols` | Symbols to trade | `["BTCUSDT", "ETHUSDT"]` | Must be from SUPPORTED_PAIRS |
| `defaultSizeUsdt` | USD value per position | `50` | Used if `capitalAllocationPct` not set |
| `capitalAllocationPct` | % of free balance per trade | `0.10` (10%) | Overrides `defaultSizeUsdt` |
| `defaultLeverage` | Base leverage | `3` | Hard-capped at `10×` regardless |
| `useStrategyLeverage` | Use strategy-specific leverage | `true` | Overrides `defaultLeverage` per regime |
| `stopLossPct` | SL distance from entry | `0.015` (1.5%) | Applied if no ATR/swing SL available |
| `tp1Pct` | TP1 distance | `0.015` (1.5%) | Partial take-profit level 1 |
| `tp2Pct` | TP2 distance | `0.030` (3.0%) | Partial take-profit level 2 |
| `maxTotalPositions` | Max concurrent open positions | `3` | |
| `useLlmAdvisor` | Enable LLM signal filter | `true` | Requires working Ollama endpoint |
| `llmConfidenceThreshold` | Min LLM confidence to execute | `70` | 0–100 |
| `paperStartingBalance` | Virtual USDT for paper mode | `10000` | Resets on server restart |

### SUPPORTED_PAIRS

These are the symbols the bot can trade. Currently:

| Binance | CoinDCX | Name |
|---|---|---|
| `BTCUSDT` | `B-BTC_USDT` | Bitcoin |
| `ETHUSDT` | `B-ETH_USDT` | Ethereum |
| `SOLUSDT` | `B-SOL_USDT` | Solana |
| `BNBUSDT` | `B-BNB_USDT` | BNB |
| `XRPUSDT` | `B-XRP_USDT` | XRP |
| `ADAUSDT` | `B-ADA_USDT` | Cardano |
| `DOGEUSDT` | `B-DOGE_USDT` | Dogecoin |
| `AVAXUSDT` | `B-AVAX_USDT` | Avalanche |

Only add symbols from this list to `targetSymbols`.

---

## 12. Telegram Bot Setup

Telegram alerts are optional but strongly recommended for production. The bot receives commands and sends critical alerts (liquidation warnings, heartbeats, trade notifications).

### Step 1 — Create a Telegram Bot

1. Open Telegram and start a chat with `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the bot token: `1234567890:ABCdef...`

### Step 2 — Get Your Chat ID

1. Start a chat with your new bot (send any message)
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Look for `"chat": {"id": <number>}` in the response — that's your Chat ID

### Step 3 — Configure in Dashboard

Navigate to **Settings → Telegram**:
- Paste your bot token
- Paste your chat ID
- Click "Test Connection" — you should receive a test message

> Alternatively, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. The bot picks up from DB first, env vars as fallback.

### Available Commands

| Command | Effect |
|---|---|
| `/status` | Open positions, PnL, uptime, kill switch state |
| `/pause` | Trigger kill switch — blocks all new orders immediately |
| `/resume` | Reset kill switch — re-enable trading |
| `/stop` | Alias for `/pause` |
| `/closeall` | Market-close all open positions |
| `/pos BTC` | Detail for BTCUSDT position |
| `/pnl` | Daily, weekly, monthly realized PnL |
| `/help` | List all commands |

> **Security:** The bot only responds to the configured `chatId`. Unknown senders are silently ignored.

The bot also sends automatic alerts:
- **Trade opened/closed** — entry price, size, strategy
- **Liquidation warnings** — CRITICAL (≤2%) and WARNING (≤5%) proximity alerts
- **Heartbeat** — every 6 hours with uptime, positions, PnL, mode

---

## 13. LLM / AI Advisor Setup

The LLM advisor is an optional filter that evaluates entry signals before the auto-executor places orders. It also manages position lifecycle decisions. The bot runs fine without it (falls back to code-based rules).

### 13.1 Local Ollama (Paper Trading & Dev)

```bash
# Install Ollama
# macOS/Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2

# Ollama runs on http://localhost:11434 by default
```

Set in `.env`:
```ini
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### 13.2 Cloud Ollama (Live Trading — Position Manager)

For live positions, the position manager uses cloud Ollama with 3-key rotation.

**Option A — DB (Recommended)**

Add keys via Dashboard → LLM Keys with these exact labels:

| Label | Endpoint | Model | API Key |
|---|---|---|---|
| `pm-live-1` | `https://ollama.com` | `llama3.2` | Key 1 |
| `pm-live-2` | `https://ollama.com` | `llama3.2` | Key 2 |
| `pm-live-3` | `https://ollama.com` | `llama3.2` | Key 3 |

**Option B — Environment Variables**

```ini
PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com
PM_OLLAMA_CLOUD_MODEL=llama3.2
PM_OLLAMA_CLOUD_KEY_1=<key1>
PM_OLLAMA_CLOUD_KEY_2=<key2>
PM_OLLAMA_CLOUD_KEY_3=<key3>
```

### LLM Key Rotation Behavior

- Keys are tried in priority order
- On 429: 5-minute backoff
- On 503: 2-minute backoff
- Other error: 30-second backoff
- All keys exhausted: falls back to code-based rules (7-rule decision tree)

### Operating Without LLM

The bot works correctly without any LLM configured:
- Entry signals: auto-executor uses code-based logic (no LLM gate)
- Position management: code-based fallback runs (7 rules: strong bearish → exit, RSI extremes → partial exit, etc.)

---

## 14. Operating Modes

### 14.1 Development (Hot-Reload)

**What it is:** Live code editing with instant reload. Uses mock OAuth, no exchange orders.

**Environment:**
```ini
NODE_ENV=development
AUTH_URL=http://localhost:9999       # triggers mock OAuth
AUTH_PLATFORM_URL=http://localhost:9999
APP_ID=dev
APP_SECRET=dev-secret-must-be-at-least-32-characters
OWNER_UNION_ID=dev-admin
DATABASE_URL=postgres://janus:pass@localhost:5432/janus_dev
PLACE_ORDERS=false
AUTO_EXECUTE=false
# ENCRYPTION_KEY optional (credentials stored plaintext in dev)
```

**Start:**
```bash
npm run dev
# → http://localhost:3010 (HTTP + Vite HMR)
# → ws://localhost:3011  (WebSocket for tRPC subscriptions)
```

**Notes:**
- Binance market data streams are real (public WS, no key needed)
- CoinDCX WS won't connect without valid API credentials — that's fine
- All background services start (reconciler, LLM advisor, etc.)
- `globalThis` singletons prevent double-init on HMR

---

### 14.2 Paper Trading

**What it is:** Real signals, real AI decisions, but positions are DB-only. No money on the line. Identical to live trading except no exchange orders are placed.

**Environment:**
```ini
NODE_ENV=production
PAPER_TRADING=true
PLACE_ORDERS=false          # extra safety belt
AUTO_EXECUTE=true           # required for auto-executor to run
BOT_AUTO_START=false        # or true if you want it to start automatically
DATABASE_URL=postgres://...
ENCRYPTION_KEY=<64-hex>
```

**What changes in paper mode:**
- `isPaper=true` on all auto-created positions
- No call to `createFuturesOrder()` — positions are DB-only
- Paper wallet tracks virtual USDT balance (`paperStartingBalance`)
- Position manager uses local Ollama (not cloud keys)
- Telegram alerts prefixed with `🧪 PAPER MODE`
- Heartbeat shows `🧪 PAPER MODE`
- Risk engine, spread filter, staleness checks, dedup — all still active

**Recommended 48-hour protocol before going live:**
1. Start with `PAPER_TRADING=true`, `AUTO_EXECUTE=true`
2. Watch signal quality in the Signals dashboard
3. Review AI decisions in the Position Manager dashboard
4. Check Telegram alerts are arriving
5. After 48h: `npx tsx scripts/go-live.ts` to verify readiness

---

### 14.3 Testnet

**What it is:** Routes Binance market data to Binance's public testnet WS endpoints. CoinDCX has no futures testnet — paper trading covers execution testing.

> **Note:** Binance testnet data may be less liquid and less realistic than mainnet. Use paper trading (mainnet data + no real orders) for more realistic simulation.

**Environment:**
```ini
USE_TESTNET=true
PAPER_TRADING=true          # combine with paper trading for full safety
AUTO_EXECUTE=true
PLACE_ORDERS=false
```

**Effect:**
- Binance WS connects to `wss://stream.binancefuture.com` instead of `wss://fstream.binance.com`
- All other behavior identical to paper trading mode

---

### 14.4 Live Trading

**What it is:** Real signals, real exchange orders, real money.

**Pre-requisites before flipping to live:**
1. Completed 48h+ paper trading with acceptable results
2. Run preflight: `npx tsx scripts/go-live.ts` — all critical checks pass
3. Backup DB: `./scripts/backup-db.sh`
4. CoinDCX credentials set in dashboard (encrypted)
5. Sufficient USDT margin in CoinDCX futures account
6. Telegram bot configured and responding
7. PM2 or Docker running with auto-restart
8. `ENCRYPTION_KEY` set and backed up securely

**Environment:**
```ini
NODE_ENV=production
PLACE_ORDERS=true           # REQUIRED: enables real CoinDCX order placement
AUTO_EXECUTE=true           # REQUIRED: enables auto-executor
PAPER_TRADING=false         # must be false (or unset)
BOT_AUTO_START=false        # set true only after testing
DATABASE_URL=postgres://...
ENCRYPTION_KEY=<64-hex>
```

**Safety layers that remain active in live mode:**

| Layer | What it prevents |
|---|---|
| Leverage hard cap (10×) | Over-leveraged positions |
| Spread filter (>1%) | Low-liquidity entries |
| Signal staleness gate (>60s) | Executing on stale data |
| 60-second dedup window | Duplicate entries on same symbol+direction |
| Order book depth gate (>5% of book) | Moving the market on entry |
| Funding rate gate | Entering against extreme funding |
| Correlation limit | Too many same-direction positions |
| Risk engine | Daily drawdown, consecutive loss cooldown, margin health |
| LLM advisor (optional) | Low-conviction signals |
| Kill switch | Emergency halt via Telegram `/pause` or API |

**How to start live trading:**
```bash
# 1. Update .env
sed -i 's/PLACE_ORDERS=false/PLACE_ORDERS=true/' .env
sed -i 's/AUTO_EXECUTE=false/AUTO_EXECUTE=true/' .env

# 2. Reload environment
pm2 restart janus-bot --update-env

# 3. Verify in logs
pm2 logs janus-bot --lines 30 | grep "AUTO_EXECUTE\|PLACE_ORDERS"

# 4. Confirm Telegram heartbeat mode shows "💰 LIVE"
```

**How to pause live trading (emergency):**
```
/pause  (via Telegram)
```
or
```bash
pm2 stop janus-bot
```

---

## 15. Health & Monitoring

### HTTP Health Endpoint

```bash
# Basic liveness (used by Docker HEALTHCHECK and load balancers)
curl http://localhost:3010/health

# Response:
# {"status":"ok","uptime":3600,"db":"ok","ts":"2026-01-01T00:00:00.000Z"}
# {"status":"degraded","db":"error"} → DB connection issue (returns HTTP 503)
```

### Detailed Health (tRPC)

```bash
curl "http://localhost:3010/api/trpc/health.detailed" | jq .
```

Returns:
- `checks.db` — latency in ms
- `checks.signals` — last signal timestamp + age in seconds (stale if >300s)
- `checks.streams` — active Binance WS stream count + list per symbol
- `checks.killSwitch` — whether kill switch is active
- `checks.positions` — open position count + total unrealized PnL

### PM2 Monitoring

```bash
pm2 status                         # process status + CPU/memory
pm2 monit                          # live dashboard
pm2 logs janus-bot --lines 100     # tail all logs
pm2 logs janus-bot --err --lines 50  # errors only
```

### Log Files

| File | Contents |
|---|---|
| `logs/combined.log` | All stdout + stderr merged |
| `logs/out.log` | stdout only |
| `logs/error.log` | stderr only |
| `logs/deploy-*.log` | Deploy script output |
| `logs/backup.log` | Backup cron output |

### Telegram Heartbeat

The bot sends a status message every 6 hours containing:
- Uptime
- Trading mode (PAPER / LIVE / Dry-run)
- Open position count
- Unrealized PnL
- Today's realized PnL
- Kill switch state

If you don't receive a heartbeat for 12+ hours, the bot is down.

---

## 16. Deployment Options

### 16.1 PM2 (Recommended)

PM2 provides process management with auto-restart, memory guards, and log rotation.

**Install PM2:**
```bash
npm install -g pm2
```

**First-time start:**
```bash
npm run build
npm run db:migrate && npm run db:push
pm2 start ecosystem.config.js --env production
pm2 save                   # persist process list for reboots
pm2 startup                # auto-generates OS startup script (follow the printed command)
```

**Update deployment:**
```bash
./scripts/deploy.sh
# Handles: git pull → npm ci → db:migrate → build → pm2 reload → health check
```

**PM2 configuration summary** (`ecosystem.config.js`):

| Setting | Value | Effect |
|---|---|---|
| `max_memory_restart` | `512M` | Restarts if heap > 512 MB |
| `max_restarts` | `5` | Stops crash-looping after 5 failures |
| `min_uptime` | `10s` | Restart counts only if process dies within 10s |
| `exp_backoff_restart_delay` | `100ms` | Exponential backoff on repeated crashes |
| `restart_delay` | `3000ms` | Wait 3s before each restart |
| `watch` | `false` | Never watch files (use `pm2 reload` for updates) |

**Common PM2 commands:**

```bash
pm2 status                         # overview of all processes
pm2 restart janus-bot              # restart (brief downtime)
pm2 reload janus-bot               # zero-downtime reload (SIGTERM → wait → new process)
pm2 stop janus-bot                 # stop (trading halts)
pm2 delete janus-bot               # remove from PM2 list
pm2 flush                          # clear log files
pm2 logs janus-bot --lines 50      # tail logs
```

---

### 16.2 Docker Compose

Full-stack Docker deployment with PostgreSQL, auto-restart, health checks, and optional backup.

**Prerequisites:**
- Docker 24+
- Docker Compose v2

**Setup:**

```bash
# 1. Build the app
npm run build

# 2. Ensure .env is populated (docker-compose reads it)
# DATABASE_URL must use "postgres" as hostname (the service name):
# DATABASE_URL=postgres://janus:password@postgres:5432/janus_production

# 3. Start all services
docker compose up -d

# 4. Apply migrations (first time only)
docker compose exec janus npm run db:migrate
docker compose exec janus npm run db:push
```

**Service overview** (`docker-compose.yml`):

| Service | Image | Port | Notes |
|---|---|---|---|
| `janus` | Built from `Dockerfile` | `3010` | App server, depends on postgres |
| `postgres` | `postgres:16-alpine` | Internal only | Persisted to `pgdata` volume |
| `pgbackup` | `postgres:16-alpine` | — | Optional, `--profile backup` |

**Docker commands:**

```bash
docker compose ps                  # container status
docker compose logs -f janus       # tail app logs
docker compose logs -f postgres    # tail DB logs
docker compose stop janus          # graceful stop
docker compose down                # stop + remove containers (volumes preserved)
docker compose down -v             # DESTRUCTIVE: removes volumes (loses DB data)
docker compose pull                # update base images
docker compose build --no-cache    # rebuild image
```

**Run a DB backup (docker):**
```bash
docker compose --profile backup run pgbackup
# Creates: ./backups/janus_YYYYMMDD_HHMMSS.sql.gz
```

**Dockerfile notes:**
- Multi-stage build: Node 20-alpine (builder) → Node 20-alpine (runner)
- Non-root user `janus` for least-privilege execution
- `/app/logs` directory created and owned by `janus` user
- `HEALTHCHECK` pings `/health` every 30s (starts after 30s, retries 3×)
- Image exposes port 3010 only

---

## 17. Pre-Live Preflight Checklist

Run the automated preflight script before ever enabling live trading:

```bash
npx tsx scripts/go-live.ts
```

The script runs 10 checks:

| Check | Critical | What it verifies |
|---|---|---|
| Required env vars | ✅ Yes | `APP_SECRET`, `DATABASE_URL`, `AUTH_URL`, `AUTH_PLATFORM_URL`, `ENCRYPTION_KEY` all set |
| ENCRYPTION_KEY format | ✅ Yes | Must be exactly 64 hex characters (32 bytes) |
| PLACE_ORDERS safety | No | Reports current trading mode |
| Database reachable | ✅ Yes | `SELECT 1` succeeds |
| Recent DB backup | No | Backup file < 24h old in `./backups/` |
| `/health` responds | ✅ Yes | Server returns `{"status":"ok"}` |
| Telegram configured | No | Bot token valid, Telegram API responds |
| `dist/boot.js` present | ✅ Yes | Production build exists |
| Paper trading history ≥ 48h | No | At least one paper position older than 48h exists |
| No orphaned live positions | No | No open `isPaper=false` positions in DB |

If any **critical** check fails, the script exits with code 1.

**Manual checklist (before flipping `PLACE_ORDERS=true`):**

- [ ] Paper trading ran for ≥ 48 hours without errors
- [ ] Win rate and PnL look reasonable in paper mode
- [ ] Telegram bot responding to `/status`
- [ ] Heartbeat received (6h interval)
- [ ] Liquidation alerts tested
- [ ] DB backup created today
- [ ] `ENCRYPTION_KEY` backed up to a secure location (password manager)
- [ ] CoinDCX credentials verified: balance shows in dashboard
- [ ] Leverage cap set to your comfort level (default 3×, max 10×)
- [ ] `maxTotalPositions` appropriate for your capital (default 3)
- [ ] `capitalAllocationPct` set conservatively (default 10%)
- [ ] PM2 or Docker running with auto-restart confirmed
- [ ] `scripts/go-live.ts` all critical checks green

---

## 18. Environment Variable Reference

Complete list of all environment variables. Required in production are marked **REQUIRED**.

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `production` or `development` |
| `PORT` | No | `3010` | HTTP server port |
| `APP_ID` | **REQUIRED** | — | OAuth application ID |
| `APP_SECRET` | **REQUIRED** | — | JWT signing secret (min 32 chars) |
| `DATABASE_URL` | **REQUIRED** | — | PostgreSQL connection string: `postgres://user:pass@host:5432/db` |
| `ENCRYPTION_KEY` | **REQUIRED** | — | AES-256-GCM key: 64 hex chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Authentication

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_URL` | **REQUIRED** | — | OAuth server base URL. Use `http://localhost:9999` to enable mock auth in dev. |
| `AUTH_PLATFORM_URL` | **REQUIRED** | — | OAuth platform API base URL (for user profile fetch) |
| `VITE_AUTH_URL` | No | — | Browser-visible OAuth URL (set to same as `AUTH_URL` in most cases) |
| `VITE_APP_ID` | No | — | Browser-visible app ID (set to same as `APP_ID`) |
| `OWNER_UNION_ID` | No | `""` | First user to log in with this `unionId` gets `role=admin` |

### Database (Docker Compose)

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_DB` | No | `janus_production` | PostgreSQL database name |
| `POSTGRES_USER` | No | `janus` | PostgreSQL user |
| `POSTGRES_PASSWORD` | No | — | PostgreSQL password (set this!) |

### Trading Safety

| Variable | Required | Default | Description |
|---|---|---|---|
| `PLACE_ORDERS` | No | `false` | Set `true` to enable real CoinDCX order placement |
| `AUTO_EXECUTE` | No | `false` | Set `true` to enable the auto-executor signal pipeline |
| `PAPER_TRADING` | No | `false` | Set `true` for DB-only paper positions (overrides `PLACE_ORDERS`) |
| `USE_TESTNET` | No | `false` | Set `true` to route Binance market data to testnet endpoints |
| `BOT_AUTO_START` | No | `false` | Set `true` to auto-start executor on server boot |

### LLM / AI — Entry Signal Advisor

| Variable | Required | Default | Description |
|---|---|---|---|
| `OLLAMA_ENDPOINT` | No | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Alias for `OLLAMA_ENDPOINT` |
| `OLLAMA_MODEL` | No | `llama3.2` | Model name to use |
| `OLLAMA_TIMEOUT_MS` | No | `15000` | Per-request timeout in milliseconds |
| `OLLAMA_API_KEYS` | No | `""` | Comma-separated cloud API keys: `key1,key2,key3` |
| `OLLAMA_API_KEY_1` | No | `""` | Individual key slot 1 |
| `OLLAMA_API_KEY_2` | No | `""` | Individual key slot 2 |
| `OLLAMA_API_KEY_3` | No | `""` | Individual key slot 3 |

### LLM / AI — Position Manager (Live Positions)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PM_OLLAMA_CLOUD_ENDPOINT` | No | `https://ollama.com` | Cloud Ollama endpoint |
| `PM_OLLAMA_CLOUD_MODEL` | No | `llama3.2` | Cloud model name |
| `PM_OLLAMA_CLOUD_KEY_1` | No | `""` | Cloud key 1 (used if no `pm-live-1` DB key) |
| `PM_OLLAMA_CLOUD_KEY_2` | No | `""` | Cloud key 2 |
| `PM_OLLAMA_CLOUD_KEY_3` | No | `""` | Cloud key 3 |

### Observability

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |

---

## 19. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  React SPA (Vite, http://localhost:3010)                    │
│  tRPC → splitLink → HTTP (queries/mutations)                │
│                   → WebSocket (subscriptions/live data)     │
└──────────────────────────┬─────────────────────────────────┘
                           │ tRPC over HTTP/WS
┌──────────────────────────▼─────────────────────────────────┐
│  Hono Server  (api/boot.ts)                                  │
│  /api/trpc/*  /api/oauth/*  /* (SPA static files)           │
│                                                             │
│  Background services (all started on boot):                  │
│  1. Binance WS  → depth/trades/klines/liquidations          │
│  2. CoinDCX private WS → positions/balances/mark prices     │
│  3. Signal analysis loop (every 30s)                        │
│  4. Alert engine (every 5s)                                 │
│  5. LLM advisor init                                        │
│  6. Position lifecycle manager (every 30s per position)     │
│  7. Trailing stop engine (every 2s)                         │
│  8. Position reconciler (every 5 min)                       │
│  9. Liquidation monitor (every 10s)                         │
│  10. Telegram command bot (polling every 3s)                │
└──────────────────────────┬─────────────────────────────────┘
                           │ Drizzle ORM
┌──────────────────────────▼─────────────────────────────────┐
│  PostgreSQL 16                                               │
│  22 tables across 2 schema files                            │
└────────────────────────────────────────────────────────────┘
```

### Signal-to-execution flow

```
Binance WS (public market data)
        │
        ▼
MarketStateManager — ring buffers per symbol (price, trades, book, CVD)
        │
        ▼
Confluence Engine (every 30s)
   Micro (20%) + Intra (45%) + Swing (35%) = Composite 0–100
   Direction: long / short / neutral
        │ composite ≥ 75
        ▼
Auto-Executor (9-gate pipeline)
   Gate 1: symbol in target list
   Gate 1b: signal age < 60s
   Gate 1c: dedup (same symbol+direction within 60s)
   Gate 2: kill switch clear
   Gate 3: no duplicate open position
   Gate 4: total positions < max
   Gate 5: funding rate acceptable
   Gate 5b: spread < 1%
   Gate 6: correlation limit OK
   Gate 7: risk engine approved
   Gate 8: LLM advisor (optional)
   + depth check before order
        │ all gates pass
        ▼
CoinDCX createFuturesOrder (live) or DB insert (paper)
        │
        ▼
Position Manager (30s cycle)
   → Market context → Bias evaluation → AI recommendation
   → Policy guard → Execute action (SL/TP, partial close, full exit)
```

### Dev vs Production ports

| Mode | HTTP | WebSocket |
|---|---|---|
| Development | 3010 | 3011 (separate WS server) |
| Production | `PORT` (default 3010) | Attached to HTTP server on same port |

---

## 20. Troubleshooting

### Server won't start — "Missing required environment variable"

You're running in production mode without all required vars. Check:
```bash
grep -E "^(APP_ID|APP_SECRET|DATABASE_URL|AUTH_URL|AUTH_PLATFORM_URL|ENCRYPTION_KEY)=" .env
```
All 5 must have non-empty values.

---

### "Cannot connect to database"

```bash
# Test the connection string
psql $DATABASE_URL -c "SELECT 1"

# If using Docker Compose, check the service is healthy
docker compose ps postgres
docker compose logs postgres
```

Common causes:
- Wrong hostname in `DATABASE_URL` (use `postgres` as host inside Docker, `localhost` outside)
- PostgreSQL not running: `sudo systemctl start postgresql`
- Wrong password
- Database doesn't exist: `createdb janus_production`

---

### "janus_sid" cookie not set / always redirecting to login

- Verify `APP_SECRET` is at least 32 characters
- In dev, confirm `AUTH_URL` contains `localhost` (for mock OAuth to activate)
- Clear browser cookies and try again

---

### CoinDCX API calls failing ("Invalid signature")

- The HMAC payload must be compact JSON (no spaces)
- Verify the API key has **Trade** + **Read** permissions
- Check system clock is synced: `date -u` — CoinDCX rejects requests > 5s off

---

### Auto-executor not firing

1. Confirm `AUTO_EXECUTE=true` in environment (`pm2 env janus-bot | grep AUTO`)
2. Confirm `enabled=true` in auto_executor_config: `psql $DATABASE_URL -c "SELECT enabled FROM auto_executor_config;"`
3. Check kill switch: `curl http://localhost:3010/api/trpc/health.detailed | jq .result.data.checks.killSwitch`
4. Wait for a signal with composite ≥ 75 (logged as "gated signal")

---

### No signals generated

- Binance WS must be connected: check `checks.streams.active` in `/health/detailed`
- The signal analysis loop runs every 30s. After starting, wait up to 60s for first signals.
- Check logs: `pm2 logs janus-bot | grep -i "confluence\|signal"`

---

### Telegram bot not responding

- Verify token is valid: `curl https://api.telegram.org/bot<TOKEN>/getMe`
- Start a chat with the bot before sending commands (Telegram blocks messages to unknown chats)
- Confirm `chatId` in DB matches your actual Telegram chat ID
- Check logs: `pm2 logs janus-bot | grep -i telegram`

---

### LLM advisor timing out / all keys in backoff

The system automatically falls back to code-based rules with `sizeMult=0.5`. Trading continues safely.

To check key health: Dashboard → LLM Keys, or:
```bash
curl http://localhost:3010/api/trpc/llm.keyStatus | jq .
```

---

### "encrypt is not a function" or credentials look like plaintext

`ENCRYPTION_KEY` is missing or < 64 hex chars. This causes transparent plaintext fallback in dev, but is a security risk in production. Generate a proper key and restart.

---

### Out of disk space

```bash
./scripts/rotate-logs.sh           # clear old logs
./scripts/backup-db.sh             # backup + prune old backups

# Nuclear option: truncate high-volume DB tables (back up first!)
psql $DATABASE_URL -c "TRUNCATE order_book_snapshots;"
psql $DATABASE_URL -c "TRUNCATE recent_ticks;"
```

---

### PM2 process stuck in "errored" state (crash loop)

```bash
pm2 logs janus-bot --err --lines 100   # diagnose crash reason
pm2 delete janus-bot                   # clear errored process
pm2 start ecosystem.config.js --env production
pm2 save
```

---

*For emergency procedures, see [docs/RUNBOOK.md](./RUNBOOK.md)*
*For tRPC router reference, see [CLAUDE.md](../CLAUDE.md#trpc-routers-reference)*
