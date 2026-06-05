#!/usr/bin/env bash
# backup-db.sh — Create a timestamped PostgreSQL backup and prune old ones
#
# Usage:
#   ./scripts/backup-db.sh                   # backup to ./backups/
#   ./scripts/backup-db.sh /path/to/backups  # backup to custom directory
#   RETENTION_DAYS=14 ./scripts/backup-db.sh # keep 14 days instead of 7
#
# Cron example (2 AM daily):
#   0 2 * * * /opt/janus/scripts/backup-db.sh >> /opt/janus/logs/backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BACKUP_DIR="${1:-$PROJECT_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="janus_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

info()  { echo "[$(date '+%H:%M:%S')] [INFO]  $*"; }
die()   { echo "[$(date '+%H:%M:%S')] [ERROR] $*" >&2; exit 1; }

# Load .env if DATABASE_URL not already set
if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

[[ -z "${DATABASE_URL:-}" ]] && die "DATABASE_URL not set — add it to .env or export it"

# Parse DATABASE_URL: postgres://user:pass@host:port/dbname
DB_USER=$(echo "$DATABASE_URL" | sed -E 's|postgres://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

info "=== Janus DB Backup $(date '+%Y-%m-%d %H:%M:%S') ==="
info "Database: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
info "Output: ${BACKUP_DIR}/${FILENAME}"

# Create backup
PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  --no-password \
  --format=plain \
  --no-acl \
  --no-owner \
  "$DB_NAME" \
  | gzip -9 \
  > "${BACKUP_DIR}/${FILENAME}"

BACKUP_SIZE=$(du -sh "${BACKUP_DIR}/${FILENAME}" | cut -f1)
info "Backup created: ${FILENAME} (${BACKUP_SIZE})"

# Prune old backups
info "Pruning backups older than ${RETENTION_DAYS} days..."
PRUNED=$(find "$BACKUP_DIR" -name "janus_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print)
if [[ -n "$PRUNED" ]]; then
  echo "$PRUNED" | while read -r f; do
    rm "$f"
    info "Deleted: $(basename "$f")"
  done
else
  info "No old backups to prune"
fi

# Show backup inventory
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "janus_*.sql.gz" | wc -l | tr -d ' ')
info "Backup inventory: ${BACKUP_COUNT} files in ${BACKUP_DIR}"
info "=== Backup complete ==="
