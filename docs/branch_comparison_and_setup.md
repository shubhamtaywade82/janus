# Janus Trading Bot — Branch Comparison & Setup Guide

This guide details the differences between the current branch (`claude/exciting-mccarthy-UzQPR`) and the target branch (`smc-market-analysis`), followed by instructions on configuring Janus for different operating modes.

---

## 1. Branch Comparison: `claude/exciting-mccarthy-UzQPR` vs `smc-market-analysis`

The current branch introduces production readiness, orchestration, automation, security layers, and detailed monitoring tools. Below is a breakdown of the key file modifications and new features:

### Core Modifications Summary

| Category | File Paths | Key Additions / Changes |
| :--- | :--- | :--- |
| **Docker & Process Management** | [Dockerfile](file:///home/nemesis/project/trading-workspace/janus/Dockerfile) <br> [docker-compose.yml](file:///home/nemesis/project/trading-workspace/janus/docker-compose.yml) <br> [ecosystem.config.cjs](file:///home/nemesis/project/trading-workspace/janus/ecosystem.config.cjs) | Adds containerization support for local PostgreSQL and app processes, and PM2 process management with memory limits. |
| **Preflight & Script Utils** | [scripts/go-live.ts](file:///home/nemesis/project/trading-workspace/janus/scripts/go-live.ts) <br> [scripts/deploy.sh](file:///home/nemesis/project/trading-workspace/janus/scripts/deploy.sh) <br> [scripts/backup-db.sh](file:///home/nemesis/project/trading-workspace/janus/scripts/backup-db.sh) <br> [scripts/rotate-logs.sh](file:///home/nemesis/project/trading-workspace/janus/scripts/rotate-logs.sh) <br> [scripts/seed-test-alerts.ts](file:///home/nemesis/project/trading-workspace/janus/scripts/seed-test-alerts.ts) | Introduces a 10-point health and security preflight verification check, automatic database backup pipelines, shell deployment runners, log-rotation policies, and signal mock seeders. |
| **Services & Engines** | [api/services/alert-engine.ts](file:///home/nemesis/project/trading-workspace/janus/api/services/alert-engine.ts) <br> [api/services/liquidation-monitor.ts](file:///home/nemesis/project/trading-workspace/janus/api/services/liquidation-monitor.ts) <br> [api/services/position-reconciler.ts](file:///home/nemesis/project/trading-workspace/janus/api/services/position-reconciler.ts) <br> [api/services/telegram-bot.ts](file:///home/nemesis/project/trading-workspace/janus/api/services/telegram-bot.ts) <br> [api/services/auto-executor.ts](file:///home/nemesis/project/trading-workspace/janus/api/services/auto-executor.ts) | Implements an Alert Engine, a dedicated Liquidation Monitor, an automated DB-to-Exchange Position Reconciler, a command/alert Telegram bot, and upgrades the automated Signal Executor. |
| **Database & Migrations** | [db/schema.ts](file:///home/nemesis/project/trading-workspace/janus/db/schema.ts) <br> [db/migrations/0009_alert_engine_tables.sql](file:///home/nemesis/project/trading-workspace/janus/db/migrations/0009_alert_engine_tables.sql) <br> [db/migrations/0010_signal_outcome_liquidation_monitor.sql](file:///home/nemesis/project/trading-workspace/janus/db/migrations/0010_signal_outcome_liquidation_monitor.sql) | Expands schema with tables for alert configurations, signal outcomes, liquidation monitoring events, and DB-backed position snapshots. |
| **API & Routing** | [api/router.ts](file:///home/nemesis/project/trading-workspace/janus/api/router.ts) <br> [api/routers/alerts-router.ts](file:///home/nemesis/project/trading-workspace/janus/api/routers/alerts-router.ts) <br> [api/routers/export-router.ts](file:///home/nemesis/project/trading-workspace/janus/api/routers/export-router.ts) <br> [api/routers/health-router.ts](file:///home/nemesis/project/trading-workspace/janus/api/routers/health-router.ts) | Adds specialized sub-routers for managing system health stats, exporting database analytics, and managing custom alerts. |
| **Security/Encryption** | [api/lib/crypto.ts](file:///home/nemesis/project/trading-workspace/janus/api/lib/crypto.ts) | Implements AES-256-GCM secure encryption and decryption at rest for exchange credentials. |
| **Frontend UIs** | [src/pages/Dashboard.tsx](file:///home/nemesis/project/trading-workspace/janus/src/pages/Dashboard.tsx) <br> [src/pages/Signals.tsx](file:///home/nemesis/project/trading-workspace/janus/src/pages/Signals.tsx) <br> [src/components/AlertsModal.tsx](file:///home/nemesis/project/trading-workspace/janus/src/components/AlertsModal.tsx) | Updates dashboards with visual position summaries, system metrics, and control panels for active alerts. |

---

## 2. Setting Up Janus Operating Modes

To configure Janus, duplicate `.env.example` to `.env` and apply one of the following configurations depending on your required mode.

### 2.1 Mode: Development (Mocked Auth, Fake Orders)
>
> [!NOTE]
> Setting `AUTH_URL` to local automatically mocks the OAuth provider so you can log in instantly with any username.

**`.env` Configuration:**

```ini
NODE_ENV=development
PORT=3010

# Mock OAuth Setup
APP_ID=dev-app-id
APP_SECRET=dev-secret-at-least-32-chars-long
AUTH_URL=http://localhost:9999
AUTH_PLATFORM_URL=http://localhost:9999
OWNER_UNION_ID=dev-admin-user

# Database Connection (update to match local credentials)
DATABASE_URL=postgres://janus:password@localhost:5432/janus_development

# Safety Gearing
PLACE_ORDERS=false
AUTO_EXECUTE=false
PAPER_TRADING=false

# Local LLM Support
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

---

### 2.2 Mode: Paper Trading (Real Signals, virtual PnL, no risk)
>
> [!IMPORTANT]
> The database tracks paper trades (`isPaper=true`). Ensure the server is started and migrations are run.

**`.env` Configuration:**

```ini
NODE_ENV=production
PORT=3010

# OAuth / Credentials
APP_ID=your_oauth_app_id
APP_SECRET=your_jwt_signing_secret_min_32_chars
AUTH_URL=https://your-auth-provider.com
AUTH_PLATFORM_URL=https://your-auth-provider.com
OWNER_UNION_ID=your_owner_union_id
ENCRYPTION_KEY=your_64_hex_encryption_key

DATABASE_URL=postgres://janus:password@localhost:5432/janus_production

# Paper Trading Enablement
PAPER_TRADING=true
AUTO_EXECUTE=true
PLACE_ORDERS=false  # Double check that order execution remains blocked on external exchange

# Telegram (Recommended to verify alert pipeline)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Local LLM Advisor
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

---

### 2.3 Mode: Testnet (Binance Testnet Data + Paper execution)
>
> [!NOTE]
> Binance WS feeds will route to `wss://stream.binancefuture.com` instead of the live mainnet endpoints.

**`.env` Configuration:**

```ini
NODE_ENV=production
PORT=3010

# Standard Production Vars
APP_ID=your_oauth_app_id
APP_SECRET=your_jwt_signing_secret_min_32_chars
AUTH_URL=https://your-auth-provider.com
AUTH_PLATFORM_URL=https://your-auth-provider.com
OWNER_UNION_ID=your_owner_union_id
ENCRYPTION_KEY=your_64_hex_encryption_key
DATABASE_URL=postgres://janus:password@localhost:5432/janus_production

# Routing market feeds to Testnet
USE_TESTNET=true
PAPER_TRADING=true
AUTO_EXECUTE=true
PLACE_ORDERS=false
```

---

### 2.4 Mode: Live Trading (Real Orders, Real Money)
>
> [!CAUTION]
> Both `PLACE_ORDERS=true` and `AUTO_EXECUTE=true` are required to route real API orders to CoinDCX.
> Ensure you have performed the **48-Hour Paper Trading Protocol** before using this mode.

**`.env` Configuration:**

```ini
NODE_ENV=production
PORT=3010

# Security (ENCRYPTION_KEY must be a securely backed up 64 hex characters value)
ENCRYPTION_KEY=your_secure_backed_up_64_hex_key

# Standard Production Vars
APP_ID=your_oauth_app_id
APP_SECRET=your_jwt_signing_secret_min_32_chars
AUTH_URL=https://your-auth-provider.com
AUTH_PLATFORM_URL=https://your-auth-provider.com
OWNER_UNION_ID=your_owner_union_id
DATABASE_URL=postgres://janus:password@localhost:5432/janus_production

# Live Routing Enabled
PLACE_ORDERS=true
AUTO_EXECUTE=true
PAPER_TRADING=false
USE_TESTNET=false

# Telegram Integration (Highly Recommended for Heartbeats & Pause Command)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Cloud-based LLM API Key Rotation Config (Or configure pm-live-* keys in llm_api_keys DB table)
PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com
PM_OLLAMA_CLOUD_MODEL=llama3.2
PM_OLLAMA_CLOUD_KEY_1=key_one
PM_OLLAMA_CLOUD_KEY_2=key_two
PM_OLLAMA_CLOUD_KEY_3=key_three
```

## 3. Using `.env.secret` for Sensitive Credentials

Janus is configured to load a `.env.secret` file (if present) after loading `.env`. This allows you to split your configurations:

* Keep public / non-sensitive variables in `.env` (such as `NODE_ENV`, `PORT`, `LOG_LEVEL`, and `PLACE_ORDERS`).
* Keep sensitive credentials in `.env.secret` (such as `APP_SECRET`, `DATABASE_URL`, `ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, and API keys).

To use this, simply create a `.env.secret` file in your project root:

```ini
# .env.secret
APP_SECRET=your_jwt_signing_secret_min_32_chars
DATABASE_URL=postgres://janus:password@localhost:5432/janus_production
ENCRYPTION_KEY=your_64_hex_encryption_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

---

## 4. Initial Boot & Preflight Checklist

Once your `.env` and `.env.secret` are configured for the target mode:

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Generate the `ENCRYPTION_KEY`** (if in Paper, Testnet, or Live):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Run database migrations**:

   ```bash
   npm run db:migrate
   npm run db:push
   ```

4. **Build the bundle**:

   ```bash
   npm run build
   ```

5. **Start the application**:
   * For local development: `npm run dev`
   * For production-like environments (using PM2): `pm2 start ecosystem.config.cjs --env production`

6. **Validate with preflight script**:

   ```bash
   npx tsx scripts/go-live.ts
   ```

   *(Add the `--allow-fail` flag if running initial configurations to list warnings without exiting immediately)*

---

## 5. PM2 Process Management Shortcuts (via npm scripts)

We have added npm script mappings in `package.json` to manage your local PM2 daemon. Using `npm run` **automatically resolves the local PM2 package binary** and does not require global PM2 installation or manual terminal aliases.

### 5.1 Easiest Management Script Reference

| Action | NPM Shortcut Script | Raw PM2 Command Equivalent |
| :--- | :--- | :--- |
| **Start Bot (Prod/Paper)** | `npm run bot:start` | `pm2 start ecosystem.config.cjs --env production` |
| **Stop Bot Process** | `npm run bot:stop` | `pm2 stop janus-bot` |
| **Restart Bot Process** | `npm run bot:restart` | `pm2 restart janus-bot` |
| **View Live Log Streams** | `npm run bot:logs` | `pm2 logs janus-bot` |
| **Stop All PM2 Apps** | `npm run bot:stop-all` | `pm2 stop all` |
| **Kill PM2 Daemon** | `npm run bot:kill` | `pm2 kill` |

---

## 6. PM2 Process Management Commands (Direct CLI)

If you have set up your shell alias (`alias pm2="./node_modules/.bin/pm2"`), you can run these CLI commands directly:

| Action | Command | Description |
| :--- | :--- | :--- |
| **Check Status** | `pm2 status` | Lists all active PM2 processes with their CPU/Memory usage. |
| **Stop Bot** | `pm2 stop janus-bot` | Safely halts the trading engine process (stops executions). |
| **Start/Resume** | `pm2 start janus-bot` | Resumes execution of a stopped process. |
| **Restart Bot** | `pm2 restart janus-bot` | Performs a quick process restart. |
| **Reload Configs** | `pm2 reload janus-bot` | Performs a zero-downtime reload (SIGTERM -> graceful replacement). |
| **Inspect Logs** | `pm2 logs janus-bot` | Streams live output logs (stdout/stderr) to your terminal. |
| **Errors Only** | `pm2 logs janus-bot --err` | Filters log streams to display errors only. |
| **Delete Process** | `pm2 delete janus-bot` | Removes the bot process from the PM2 registry. |
| **Clean Logs** | `pm2 flush` | Clears all stored PM2 log files. |
| **Shut down PM2** | `pm2 kill` | Stops all processes and kills the background PM2 daemon completely. |


