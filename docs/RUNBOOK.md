# Janus Trading Bot — Operational Runbook

Emergency procedures, troubleshooting, and operational reference for on-call operators.

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Emergency Procedures](#emergency-procedures)
3. [Startup & Shutdown](#startup--shutdown)
4. [Health Checks](#health-checks)
5. [Deploying Updates](#deploying-updates)
6. [Database Operations](#database-operations)
7. [Telegram Bot Commands](#telegram-bot-commands)
8. [Common Incidents](#common-incidents)
9. [Service Architecture Quick View](#service-architecture-quick-view)
10. [Escalation Path](#escalation-path)

---

## Quick Reference

| Action | Command |
|---|---|
| Check status | `pm2 status` or `GET /health` |
| View live logs | `pm2 logs janus-bot --lines 100` |
| Emergency stop (all trading) | `/pause` in Telegram or `pm2 stop janus-bot` |
| Close all positions | `/closeall` in Telegram |
| Restart bot | `pm2 restart janus-bot` or `./scripts/deploy.sh` |
| DB backup | `./scripts/backup-db.sh` |
| Rotate logs | `./scripts/rotate-logs.sh` |
| Preflight check | `npx tsx scripts/go-live.ts` |
| Tail error log | `tail -f logs/error.log` |

---

## Emergency Procedures

### 🔴 STOP ALL TRADING IMMEDIATELY

**Option A — Telegram (fastest, no SSH needed)**

```
/pause
```

This triggers the global kill switch. New positions will be blocked. Existing positions are NOT closed.

**Option B — SSH**

```bash
pm2 stop janus-bot
```

**Option C — Docker**

```bash
docker compose stop janus
```

---

### 🔴 CLOSE ALL OPEN POSITIONS

```
/closeall
```

This emits a `closeAll` event. The auto-executor will attempt to market-close all open live positions.

**Manual fallback** (if bot is unresponsive):
1. Log into CoinDCX directly
2. Navigate to Futures → Positions
3. Close each position manually at market price

---

### 🔴 DATABASE CORRUPTION / LOSS

1. Stop the bot: `pm2 stop janus-bot`
2. Identify the most recent backup: `ls -la backups/`
3. Restore:
   ```bash
   # Drop and recreate (DESTRUCTIVE — verify backup first)
   psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   
   # Restore from backup
   zcat backups/janus_YYYYMMDD_HHMMSS.sql.gz | psql $DATABASE_URL
   ```
4. Re-run migrations: `npm run db:migrate`
5. Restart: `pm2 start ecosystem.config.js --env production`

---

### 🔴 SERVER OUT OF DISK SPACE

```bash
# Check disk usage
df -h

# Clear old logs immediately
./scripts/rotate-logs.sh

# Clear old backups (keep last 3)
ls -t backups/janus_*.sql.gz | tail -n +4 | xargs rm -f

# Check what's consuming space
du -sh /opt/janus/* | sort -hr | head -20
```

---

### 🔴 BOT CRASH LOOP (PM2 reports "errored")

```bash
# View last 200 lines of error log
pm2 logs janus-bot --err --lines 200

# Check if it's a DB connection issue
curl http://localhost:3010/health

# Check environment variables loaded correctly
pm2 env janus-bot | grep -E "NODE_ENV|DATABASE|PLACE_ORDERS"

# If config issue: fix .env, then
pm2 restart janus-bot --update-env
```

If crash loop persists (PM2 stops after 5 failures):
```bash
pm2 delete janus-bot
pm2 start ecosystem.config.js --env production
pm2 save
```

---

## Startup & Shutdown

### Starting (PM2 — recommended)

```bash
# First-time setup
npm run build
npm run db:migrate
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # configure PM2 to auto-start on OS reboot

# Subsequent starts
pm2 start janus-bot
```

### Starting (Docker Compose)

```bash
docker compose up -d
docker compose logs -f janus  # watch logs
```

### Graceful shutdown

```bash
# PM2 — sends SIGTERM, waits for services to stop
pm2 stop janus-bot

# Docker
docker compose stop janus

# Direct (if running as process)
kill -TERM $(pgrep -f "node dist/boot.js")
```

The shutdown handler (in `api/boot.ts`) will:
1. Trigger the kill switch (halts new orders)
2. Stop alert engine, reconciler, Telegram bot, liquidation monitor, position manager
3. Wait 500ms for in-flight DB writes
4. Exit cleanly

---

## Health Checks

### HTTP endpoint

```bash
curl http://localhost:3010/health
# {"status":"ok","uptime":3600,"db":"ok","ts":"2026-01-01T00:00:00.000Z"}

curl http://localhost:3010/health
# {"status":"degraded","db":"error"} → DB connection problem
```

### Detailed check (tRPC)

```bash
# Via the health router
curl http://localhost:3010/api/trpc/health.detailed
```

Returns: DB latency, last signal age, WebSocket stream status, kill switch state, open position count.

### Telegram heartbeat

The bot sends a heartbeat every 6 hours automatically. If you haven't seen one in 12+ hours, the bot is down.

---

## Deploying Updates

### Standard deploy

```bash
./scripts/deploy.sh
```

This: pulls latest git, installs dependencies, runs DB migrations, builds, reloads PM2, waits for health check.

### Rollback

```bash
# Find the last good commit
git log --oneline -10

# Checkout that commit
git checkout <commit-hash>

# Rebuild and restart
npm run build && pm2 restart janus-bot
```

### Zero-downtime reload

PM2's `reload` (used by `deploy.sh`) sends SIGTERM to the old process after the new one is ready. If reload fails, it falls back to restart. During the 500ms shutdown window, no new requests are accepted.

---

## Database Operations

### Backup

```bash
./scripts/backup-db.sh
# Creates: backups/janus_YYYYMMDD_HHMMSS.sql.gz
```

### List backups

```bash
ls -lah backups/janus_*.sql.gz
```

### Restore specific backup

```bash
BACKUP_FILE=backups/janus_20260101_020000.sql.gz

# Stop the bot first
pm2 stop janus-bot

# Restore (replaces existing data)
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
zcat "$BACKUP_FILE" | psql $DATABASE_URL

# Re-apply any migrations added after the backup
npm run db:migrate

# Restart
pm2 start ecosystem.config.js --env production
```

### Run migrations manually

```bash
npm run db:migrate
```

### Emergency schema push (dev only)

```bash
# DANGEROUS in production — skips migration history
npm run db:push
```

### Useful queries

```sql
-- Open live positions
SELECT id, symbol, side, size, entry_price, unrealized_pnl, created_at
FROM positions WHERE status = 'open' AND is_paper = false;

-- Today's realized PnL
SELECT sum(realized_pnl::numeric) as total_pnl
FROM positions
WHERE status = 'closed' AND closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC');

-- Last 10 signals
SELECT symbol, direction, composite_score, is_gated, created_at
FROM signals ORDER BY created_at DESC LIMIT 10;

-- Recent system logs (errors only)
SELECT level, message, created_at FROM system_logs
WHERE level IN ('error','critical')
ORDER BY created_at DESC LIMIT 50;
```

---

## Telegram Bot Commands

| Command | Effect |
|---|---|
| `/status` | Open positions, unrealized PnL, today's PnL, kill switch state |
| `/pause` or `/stop` | Trigger global kill switch — blocks new orders |
| `/resume` | Reset kill switch — resumes trading |
| `/closeall` | Market-close all open positions |
| `/pos BTC` | Detail for BTCUSDT position |
| `/pnl` | Daily, weekly, monthly realized PnL summary |
| `/help` | List all commands |

> **Security**: The bot only responds to the configured `chatId`. Unknown senders are silently ignored.

---

## Common Incidents

### Signal analysis stopped (no signals in > 5 min)

**Symptoms**: `/status` shows no recent activity; Binance WS quiet.

**Steps**:
1. Check if streams are active: `curl http://localhost:3010/api/trpc/health.detailed`
2. Check logs: `pm2 logs janus-bot --lines 100 | grep streaming`
3. The WS watchdog auto-reconnects streams silent for > 60s. If it hasn't fired:
   ```bash
   pm2 restart janus-bot
   ```

---

### CoinDCX API returning 429

**Symptoms**: `[coindcx] 429` in logs; positions not syncing.

The client auto-retries with exponential backoff (2s, 4s, 8s). If it persists:
1. Check if CoinDCX is down: https://status.coindcx.com
2. Reduce order frequency: lower `AUTO_EXECUTE` signal frequency in config
3. Check if another process is using the same API key

---

### LLM advisor timing out

**Symptoms**: `[llm-advisor] key ... backoff` in logs; signals executing without LLM confirmation.

The system falls back to `execute` with `sizeMult=0.5` when all keys are exhausted. This is safe.

1. Check key health: `trpc.llm.keyStatus()`
2. If using cloud Ollama, verify keys at https://ollama.com
3. Switch to local Ollama: set `OLLAMA_ENDPOINT=http://localhost:11434`

---

### PostgreSQL disk full

```bash
# Check table sizes
psql $DATABASE_URL -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
  FROM pg_class WHERE relkind = 'r'
  ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;"

# Truncate high-volume tables (after backing up)
psql $DATABASE_URL -c "TRUNCATE order_book_snapshots;"
psql $DATABASE_URL -c "TRUNCATE recent_ticks;"
psql $DATABASE_URL -c "DELETE FROM market_data WHERE timestamp < now() - interval '30 days';"
```

---

### Memory leak (PM2 restarts due to >512MB)

```bash
# Check memory trend
pm2 monit

# Get heap snapshot (requires --inspect flag in ecosystem.config.js)
# Add to ecosystem: node_args: "--expose-gc --inspect=9229"
# Then: node --inspect dist/boot.js and use Chrome DevTools

# Quick mitigation: reduce in-memory buffer sizes in market-state.ts
# or reduce the number of tracked symbols in SUPPORTED_PAIRS
```

---

## Service Architecture Quick View

```
                         ┌──────────────────────┐
Binance WS (public) ────►│  streaming.ts        │──► MarketStateManager
CoinDCX WS (private) ───►│  coindcx-ws.ts       │──► userPositionsCache
                         └──────────────────────┘
                                    │
                         ┌──────────▼─────────────┐
                         │  confluence.ts (30s)   │──► signals table
                         └──────────┬─────────────┘
                                    │ score ≥ 75
                         ┌──────────▼─────────────┐
                         │  auto-executor.ts      │──► CoinDCX REST
                         │  (9-gate pipeline)     │──► positions table
                         └──────────┬─────────────┘
                                    │
                         ┌──────────▼─────────────┐
                         │  position-manager      │──► AI advisor
                         │  trailing-stop         │──► SL/TP updates
                         └────────────────────────┘

Background timers:
  alertEngine.start(5s)         — evaluate user alert rules
  positionReconciler.start(5m)  — sync DB vs exchange
  liquidationMonitor(10s)       — proximity alerts
  heartbeat (6h)                — Telegram keepalive
```

---

## Escalation Path

1. **Telegram `/pause`** — stops new orders in < 1s (no SSH needed)
2. **SSH `pm2 stop janus-bot`** — hard stop (< 5s)
3. **Manual CoinDCX close** — log into exchange and close positions directly
4. **Server emergency** — `docker compose down` or shut down the VM

For data loss incidents: restore from `backups/` and contact your hosting provider for point-in-time recovery options.

---

*Keep this file up to date when procedures change. Last reviewed: 2026-06-05*
