#!/usr/bin/env bash
# deploy.sh — Zero-downtime production deployment for Janus
#
# Usage:
#   ./scripts/deploy.sh              # deploy current branch
#   ./scripts/deploy.sh --skip-build # re-use existing dist/ (e.g. after failed PM2 start)
#
# Prerequisites:
#   - Node.js 20+, npm, PM2 (pm2 start/stop/restart)
#   - .env file present at project root
#   - DATABASE_URL set in environment or .env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

LOG_FILE="./logs/deploy-$(date +%Y%m%d_%H%M%S).log"
mkdir -p logs

# Tee all output to log file
exec > >(tee -a "$LOG_FILE") 2>&1

info()    { echo "[$(date '+%H:%M:%S')] [INFO]  $*"; }
success() { echo "[$(date '+%H:%M:%S')] [OK]    $*"; }
warn()    { echo "[$(date '+%H:%M:%S')] [WARN]  $*"; }
error()   { echo "[$(date '+%H:%M:%S')] [ERROR] $*"; }
die()     { error "$*"; exit 1; }

SKIP_BUILD=false
for arg in "$@"; do
  [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true
done

info "=== Janus Deploy $(date '+%Y-%m-%d %H:%M:%S') ==="
info "Project: $PROJECT_ROOT"
info "Skip build: $SKIP_BUILD"

# ── 1. Sanity checks ────────────────────────────────────────────────────
[[ -f ".env" ]] || die ".env not found — copy .env.example and fill in values"
command -v node &>/dev/null || die "Node.js not found"
command -v npm  &>/dev/null || die "npm not found"
command -v pm2  &>/dev/null || die "PM2 not found — install with: npm i -g pm2"

# ── 2. Pull latest code ─────────────────────────────────────────────────
info "Pulling latest code..."
git fetch origin
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git pull origin "$CURRENT_BRANCH"
success "Branch: $CURRENT_BRANCH @ $(git rev-parse --short HEAD)"

# ── 3. Install dependencies ─────────────────────────────────────────────
info "Installing dependencies..."
npm ci --omit=dev --ignore-scripts
success "Dependencies installed"

# ── 4. Apply DB migrations ──────────────────────────────────────────────
info "Applying database migrations..."
npm run db:migrate
success "Migrations applied"

# ── 5. Build ────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
  info "Building..."
  npm run build
  success "Build complete"
else
  warn "Skipping build (--skip-build flag set)"
  [[ -f "dist/boot.js" ]] || die "dist/boot.js not found and --skip-build was set"
fi

# ── 6. Reload PM2 (zero-downtime where possible) ────────────────────────
info "Reloading PM2 process..."
if pm2 list | grep -q "janus-bot"; then
  pm2 reload ecosystem.config.js --update-env
  success "PM2 process reloaded"
else
  info "PM2 process not running — starting fresh"
  pm2 start ecosystem.config.js --env production
  pm2 save
  success "PM2 process started and saved"
fi

# ── 7. Health check ──────────────────────────────────────────────────────
info "Waiting for health check..."
MAX_WAIT=60
INTERVAL=3
ELAPSED=0
PORT="${PORT:-3010}"

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if curl -sf "http://localhost:${PORT}/health" | grep -q '"status":"ok"'; then
    success "Health check passed (${ELAPSED}s)"
    break
  fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
  error "Health check failed after ${MAX_WAIT}s — check logs/error.log"
  pm2 logs janus-bot --lines 50 --nostream
  exit 1
fi

success "=== Deploy complete ==="
info "Log saved to: $LOG_FILE"
