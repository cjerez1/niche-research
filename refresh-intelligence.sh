#!/usr/bin/env bash
# Refresh all paid intelligence sources without spending YouTube API quota.
# Order matters: NexLev builds the breakout-channel inventory, then Claude uses
# that inventory plus VidIQ MCP to validate/rank the opportunities.

set -uo pipefail
cd "$(dirname "$0")"

LOG_DIR="$HOME/niche-scanner/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-intelligence-$(date -u +%Y-%m-%d).log"
exec >> "$LOG" 2>&1

TODAY="$(TZ=Australia/Melbourne date +%Y-%m-%d)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "----------------------------------------------"
echo "[refresh-intelligence] tick at $NOW UTC (Melbourne $TODAY)"

echo "[1/2] Refreshing NexLev breakout cache..."
./refresh-nexlev.sh || echo "[refresh-intelligence] NexLev refresh did not complete; Claude/VidIQ will use the latest available NexLev cache."

echo "[2/2] Refreshing Claude + VidIQ intelligence cache..."
TODAY="$TODAY" NOW="$NOW" node scripts/refresh-vidiq-claude.js

echo "[refresh-intelligence] done"
