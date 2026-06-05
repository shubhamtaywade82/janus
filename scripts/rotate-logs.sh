#!/usr/bin/env bash
# rotate-logs.sh — Prune old log files and compress recent ones
#
# Usage:
#   ./scripts/rotate-logs.sh             # default: keep 14 days, logs in ./logs/
#   LOG_DIR=/var/log/janus ./scripts/rotate-logs.sh
#   RETENTION_DAYS=30 ./scripts/rotate-logs.sh
#
# Cron example (3 AM daily):
#   0 3 * * * /opt/janus/scripts/rotate-logs.sh >> /opt/janus/logs/rotate.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/logs}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPRESS_DAYS="${COMPRESS_DAYS:-2}"  # compress logs older than N days

info() { echo "[$(date '+%H:%M:%S')] [INFO]  $*"; }
die()  { echo "[$(date '+%H:%M:%S')] [ERROR] $*" >&2; exit 1; }

[[ -d "$LOG_DIR" ]] || die "Log directory not found: $LOG_DIR"

info "=== Janus Log Rotation $(date '+%Y-%m-%d %H:%M:%S') ==="
info "Log directory: $LOG_DIR"
info "Retention: ${RETENTION_DAYS} days | Compress after: ${COMPRESS_DAYS} days"

# ── Compress uncompressed logs older than COMPRESS_DAYS ────────────────
info "Compressing old logs..."
COMPRESSED=0
while IFS= read -r -d '' f; do
  gzip -9 "$f"
  info "Compressed: $(basename "$f")"
  COMPRESSED=$((COMPRESSED + 1))
done < <(find "$LOG_DIR" -name "*.log" \
  -not -name "combined.log" \
  -not -name "out.log" \
  -not -name "error.log" \
  -mtime "+${COMPRESS_DAYS}" \
  -print0 2>/dev/null)
info "Compressed ${COMPRESSED} file(s)"

# ── Delete logs beyond retention window ─────────────────────────────────
info "Pruning logs older than ${RETENTION_DAYS} days..."
DELETED=0
DELETED_SIZE=0
while IFS= read -r -d '' f; do
  SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
  DELETED_SIZE=$((DELETED_SIZE + SIZE))
  rm "$f"
  info "Deleted: $(basename "$f")"
  DELETED=$((DELETED + 1))
done < <(find "$LOG_DIR" \
  \( -name "*.log" -o -name "*.log.gz" \) \
  -not -name "combined.log" \
  -not -name "out.log" \
  -not -name "error.log" \
  -mtime "+${RETENTION_DAYS}" \
  -print0 2>/dev/null)

DELETED_MB=$(echo "scale=2; $DELETED_SIZE / 1048576" | bc 2>/dev/null || echo "?")
info "Deleted ${DELETED} file(s) (${DELETED_MB} MB freed)"

# ── Truncate active PM2 logs if they exceed 100 MB ──────────────────────
for ACTIVE_LOG in combined.log out.log error.log; do
  LOG_PATH="$LOG_DIR/$ACTIVE_LOG"
  if [[ -f "$LOG_PATH" ]]; then
    SIZE=$(stat -c%s "$LOG_PATH" 2>/dev/null || echo 0)
    if [[ $SIZE -gt $((100 * 1024 * 1024)) ]]; then
      BACKUP="${LOG_PATH%.log}-$(date +%Y%m%d_%H%M%S).log.gz"
      gzip -c "$LOG_PATH" > "$BACKUP"
      truncate -s 0 "$LOG_PATH"
      info "Rotated active log: $ACTIVE_LOG → $(basename "$BACKUP")"
    fi
  fi
done

# ── Summary ─────────────────────────────────────────────────────────────
TOTAL_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1 || echo "?")
LOG_COUNT=$(find "$LOG_DIR" \( -name "*.log" -o -name "*.log.gz" \) | wc -l | tr -d ' ')
info "Log directory size: ${TOTAL_SIZE} (${LOG_COUNT} files)"
info "=== Log rotation complete ==="
