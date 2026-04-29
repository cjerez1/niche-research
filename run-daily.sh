#!/usr/bin/env bash
# Daily niche scanner. This is the only scheduled job allowed to spend
# YouTube API quota, and it is guarded to run once per Melbourne day.

set -uo pipefail
cd "$(dirname "$0")"

TODAY="$(TZ=Australia/Melbourne date +%Y-%m-%d)"
LOG_DIR="$HOME/niche-scanner/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$TODAY.log"
exec > >(tee -a "$LOG") 2>&1

RAN_FLAG="$HOME/niche-scanner/.last-scan-day"
SENT_FLAG="$HOME/niche-scanner/.last-report-email-day"

echo "=============================================="
echo "Run requested: $(date -u) UTC (Melbourne $TODAY)"
echo "=============================================="

if [ -f "$RAN_FLAG" ]; then
  LAST="$(cat "$RAN_FLAG" 2>/dev/null || echo "")"
  if [ "$LAST" = "$TODAY" ]; then
    echo "[run-daily] already ran today ($TODAY); exiting to protect YouTube quota."
    exit 0
  fi
fi

echo "[1/3] Pulling latest code from GitHub..."
git pull origin main || true

# Mark before scanning. If the scan crashes, we still do not auto-burn another
# same-day YouTube run. Manual override is deleting this flag deliberately.
echo "$TODAY" > "$RAN_FLAG"

echo "[2/3] Running scanner + email once..."
echo "  NexLev refresh retries are handled separately by refresh-nexlev.sh."
EMAIL_SENT_FLAG="$SENT_FLAG" EMAIL_SENT_VALUE="$TODAY" node index.js --nexlev

echo "[3/3] Committing fresh data to GitHub..."
git add niche-research/ || true
if git diff --cached --quiet; then
  echo "No data changes to commit."
else
  git -c user.name="VM Niche Scanner" -c user.email="noreply@anthropic.com" commit -m "Daily scan $TODAY" || true
  git push origin main || echo "Push failed (non-fatal)"
fi

echo "=============================================="
echo "Run completed: $(date -u) UTC"
echo "=============================================="
