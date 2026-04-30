#!/usr/bin/env bash
# Send one cache-only NexLev report after today's cache refresh succeeds.
# This never uses YouTube API; it runs index.js in --nexlev-only mode.

set -uo pipefail
cd "$(dirname "$0")"

TODAY="$(TZ=Australia/Melbourne date +%Y-%m-%d)"
LOG_DIR="$HOME/niche-scanner/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/cache-email-$TODAY.log"
exec >> "$LOG" 2>&1

CACHE="$HOME/niche-scanner/niche-research/nexlev-cache/latest.json"
SENT_FLAG="$HOME/niche-scanner/.last-report-email-day"

echo "----------------------------------------------"
echo "[cache-email] tick at $(date -u +%Y-%m-%dT%H:%M:%SZ) UTC (Melbourne $TODAY)"

cache_date() {
  python3 - "$CACHE" <<'PY'
import json, sys
try:
    raw = open(sys.argv[1], "rb").read().decode("utf-8-sig")
    print(json.loads(raw).get("date", ""))
except Exception:
    print("")
PY
}

cache_count() {
  python3 - "$CACHE" <<'PY'
import json, sys
try:
    raw = open(sys.argv[1], "rb").read().decode("utf-8-sig")
    data = json.loads(raw)
    candidates = data.get("candidates") or []
    print(data.get("count") or len(candidates))
except Exception:
    print(0)
PY
}

cache_rollover() {
  python3 - "$CACHE" <<'PY'
import json, sys
try:
    raw = open(sys.argv[1], "rb").read().decode("utf-8-sig")
    data = json.loads(raw)
    print("1" if data.get("rolloverFrom") or data.get("rolledOverFrom") else "0")
except Exception:
    print("0")
PY
}

if [ -f "$SENT_FLAG" ] && [ "$(cat "$SENT_FLAG" 2>/dev/null || echo "")" = "$TODAY" ]; then
  echo "[cache-email] already sent a report email today; no-op."
  exit 0
fi

if [ "$(cache_date)" != "$TODAY" ]; then
  echo "[cache-email] today's NexLev cache is not ready yet; no-op."
  exit 0
fi

if [ "$(cache_rollover)" = "1" ]; then
  echo "[cache-email] today's NexLev cache is a rollover, not fresh NexLev data; refusing to email."
  exit 0
fi

COUNT="$(cache_count)"
if [ "$COUNT" -lt 1 ]; then
  echo "[cache-email] today's NexLev cache has no candidates; refusing to email."
  exit 1
fi

echo "[cache-email] validating cached channels are still live before email."
node scripts/filter-dead-cache-channels.js
COUNT="$(cache_count)"
if [ "$COUNT" -lt 1 ]; then
  echo "[cache-email] live validation removed all candidates; refusing to email."
  exit 1
fi

echo "[cache-email] today's cache is ready ($COUNT candidates); sending cache-only report."
EMAIL_SENT_FLAG="$SENT_FLAG" EMAIL_SENT_VALUE="$TODAY" node index.js --nexlev-only
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  echo "[cache-email] cache-only report run completed for $TODAY."
else
  echo "[cache-email] failed with status $STATUS."
fi
exit "$STATUS"
