#!/usr/bin/env bash
# Deep NexLev + Claude/VidIQ run for Claudio's channel warmup brain.
# Cron can call this daily; the script gates itself to one successful run every
# DEEP_INTERVAL_DAYS, starting on DEEP_START_DATE in Melbourne time.

set -uo pipefail
cd "$(dirname "$0")"

TODAY="$(TZ=Australia/Melbourne date +%Y-%m-%d)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_DATE="${DEEP_START_DATE:-2026-05-03}"
INTERVAL_DAYS="${DEEP_INTERVAL_DAYS:-3}"
LOG_DIR="$HOME/niche-scanner/logs"
LOG="$LOG_DIR/deep-intelligence-$TODAY.log"
LAST_SUCCESS="$HOME/niche-scanner/.last-deep-intelligence-day"
EMAIL_FLAG="$HOME/niche-scanner/.last-deep-report-email-day"

mkdir -p "$LOG_DIR"
exec >> "$LOG" 2>&1

echo "----------------------------------------------"
echo "[deep-intelligence] tick at $NOW UTC (Melbourne $TODAY)"

days_since_start="$(python3 - "$START_DATE" "$TODAY" <<'PY'
from datetime import date
import sys
start = date.fromisoformat(sys.argv[1])
today = date.fromisoformat(sys.argv[2])
print((today - start).days)
PY
)"

if [ "$days_since_start" -lt 0 ]; then
  echo "[deep-intelligence] starts on $START_DATE; no-op."
  exit 0
fi

if [ $((days_since_start % INTERVAL_DAYS)) -ne 0 ]; then
  echo "[deep-intelligence] not a scheduled deep day; day offset=$days_since_start interval=$INTERVAL_DAYS."
  exit 0
fi

if [ -f "$LAST_SUCCESS" ] && [ "$(cat "$LAST_SUCCESS" 2>/dev/null || echo "")" = "$TODAY" ]; then
  echo "[deep-intelligence] already completed today; no-op."
  exit 0
fi

echo "[deep-intelligence] pulling latest GitHub code..."
git pull --ff-only origin main

echo "[deep-intelligence] refreshing NexLev + Claude/VidIQ..."
FORCE_REFRESH=1 VIDIQ_REFRESH_METHOD=cli /usr/bin/env bash ./refresh-nexlev.sh

echo "[deep-intelligence] validating fresh caches..."
node scripts/validate-intelligence-cache.js

echo "[deep-intelligence] running scanner/report with existing logic..."
SKIP_BENDS=1 EMAIL_SENT_FLAG="$EMAIL_FLAG" EMAIL_SENT_VALUE="$TODAY" node index.js --nexlev-only --vidiq

echo "$TODAY" > "$LAST_SUCCESS"
echo "[deep-intelligence] completed successfully for $TODAY"
