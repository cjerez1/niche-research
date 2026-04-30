#!/usr/bin/env bash
# Refresh NexLev-only artifacts. Safe to run repeatedly from cron.
# This script must never run node index.js because that can spend YouTube API quota.

set -uo pipefail
cd "$(dirname "$0")"

LOG_DIR="$HOME/niche-scanner/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-nexlev-$(date -u +%Y-%m-%d).log"
exec >> "$LOG" 2>&1

TODAY="$(TZ=Australia/Melbourne date +%Y-%m-%d)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CACHE="$HOME/niche-scanner/niche-research/nexlev-cache/latest.json"
FORCE_REFRESH="${FORCE_REFRESH:-0}"
CACHE_MTIME_BEFORE=0
if [ -f "$CACHE" ]; then
  CACHE_MTIME_BEFORE="$(stat -c %Y "$CACHE" 2>/dev/null || echo 0)"
fi

echo "----------------------------------------------"
echo "[refresh-nexlev] tick at $NOW UTC (Melbourne $TODAY)"

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

cache_is_rollover() {
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

if [ -f "$CACHE" ]; then
  CACHE_DATE="$(cache_date)"
  if [ "$CACHE_DATE" = "$TODAY" ] && [ "$FORCE_REFRESH" != "1" ]; then
    echo "[refresh-nexlev] cache is already dated $TODAY; no-op."
    exit 0
  fi
  if [ "$CACHE_DATE" = "$TODAY" ]; then
    echo "[refresh-nexlev] cache is already dated $TODAY, but FORCE_REFRESH=1; refreshing anyway."
  else
  echo "[refresh-nexlev] cache date is '$CACHE_DATE'; refreshing for '$TODAY'."
  fi
else
  echo "[refresh-nexlev] no cache file; refreshing."
fi

refresh_prompt() {
  cat <<PROMPT
You are refreshing Claudio's NexLev cache at $NOW UTC.

Use the available NexLev MCP/app tools. Do not use YouTube API. Do not run shell parsing.

Step 1 - main cache:
Find up to 100 long-form/faceless YouTube channels matching:
- faceless true
- 500 to 30000 subscribers
- at least 50000 monthly views
- first upload or channel start within the last 365 days
- monetization is useful metadata but must NOT be a filter

Prefer the NexLev niche finder/vector search if available; use query '*' with numeric filters. Save the raw candidate array exactly as returned, preserving recent/last uploaded videos, views, RPM, revenue, faceless status, upload dates and URLs.

Write /home/ubuntu/niche-scanner/niche-research/nexlev-cache/latest.json as valid UTF-8 JSON with this shape:
{\"date\":\"$TODAY\",\"timestamp\":\"$NOW\",\"source\":\"nexlev-mcp\",\"candidates\":[...],\"count\":123}

Step 2 - popping longform:
Find long-form channels with 3-4 uploads, at least 100000 total views, last upload within 21 days, average video length at least 8 minutes, and 0 to 15000 subscribers.

Pick the top 10 by a blend of average views, outlier score, and consistency. Write /home/ubuntu/niche-scanner/niche-research/popping-channels/$TODAY.json with:
{\"date\":\"$TODAY\",\"criteria\":\"Longform >=8min, 3-4 uploads, 100K+ views, last upload within 3 weeks.\",\"rankedChannels\":[...10 objects...],\"patternSummary\":[...]}

Each ranked channel object must come from a raw NexLev result with a valid YouTube channel ID beginning with UC. Do not invent, infer, or construct example channels. Exclude anything without a verified raw channel ID. Each object should include rank, title, url, niche, uploads, subscribers, totalViews, avgViewPerVideo, avgVideoLengthSec, outlierScore, monthlyRevenueUSD, rpm, daysSinceStart, topVideo, and whyWorking.

Finish by replying only with REFRESH_DONE.
PROMPT
}

verify_fresh_cache() {
  POST_DATE=""
  if [ -f "$CACHE" ]; then
    POST_DATE="$(cache_date)"
  fi
  if [ "$(cache_is_rollover)" = "1" ]; then
    echo "[refresh-nexlev] cache was rolled over from an older day; refusing to treat it as fresh."
    return 1
  fi

  if [ "$FORCE_REFRESH" = "1" ]; then
    POST_MTIME="$(stat -c %Y "$CACHE" 2>/dev/null || echo 0)"
    if [ "$POST_DATE" = "$TODAY" ] && [ "$POST_MTIME" -gt "$CACHE_MTIME_BEFORE" ]; then
      echo "[refresh-nexlev] SUCCESS - cache forcibly refreshed for $TODAY."
      exit 0
    fi
    echo "[refresh-nexlev] forced refresh did not rewrite cache; found date '$POST_DATE'."
    return 1
  fi

  if [ "$POST_DATE" = "$TODAY" ]; then
    echo "[refresh-nexlev] SUCCESS - cache now dated $TODAY."
    exit 0
  fi

  echo "[refresh-nexlev] cache not fresh after attempt; found date '$POST_DATE'."
  return 1
}

run_codex_refresh() {
  local out="/tmp/nexlev-codex-refresh.log"
  echo "[refresh-nexlev] trying Codex/NexLev first..."
  if command -v codex >/dev/null 2>&1; then
    timeout 900 codex exec -C "$HOME/niche-scanner" --dangerously-bypass-approvals-and-sandbox "$(refresh_prompt)" </dev/null >"$out" 2>&1
  elif command -v Codex >/dev/null 2>&1; then
    timeout 900 Codex exec -C "$HOME/niche-scanner" --dangerously-bypass-approvals-and-sandbox "$(refresh_prompt)" </dev/null >"$out" 2>&1
  else
    echo "[refresh-nexlev] Codex CLI is not installed."
    return 1
  fi
  tail -80 "$out"
  if grep -qiE "JsonRpcMessage|Transport channel closed|NexLev.*not available|TOOL_FAIL|MCP server unavailable|connection closed" "$out"; then
    echo "[refresh-nexlev] Codex/NexLev transport failed; falling back to Claude."
    return 1
  fi
  verify_fresh_cache
  return $?
}

run_claude_refresh() {
  local out="/tmp/nexlev-claude-refresh.log"
  echo "[refresh-nexlev] trying Claude fallback..."
  if ! command -v claude >/dev/null 2>&1; then
    echo "[refresh-nexlev] Claude fallback unavailable: claude CLI not found."
    return 1
  fi

  timeout 900 claude -p --dangerously-skip-permissions "$(refresh_prompt)" </dev/null >"$out" 2>&1
  tail -80 "$out"

  if grep -qiE "limit|rate|reset" "$out"; then
    echo "[refresh-nexlev] Claude fallback is rate-limited; will retry on next cron tick."
    exit 0
  fi

  verify_fresh_cache
  return $?
}

run_codex_refresh || run_claude_refresh

POST_DATE=""
if [ -f "$CACHE" ]; then
  POST_DATE="$(cache_date)"
fi

if [ "$POST_DATE" = "$TODAY" ]; then
  if [ "$(cache_is_rollover)" = "1" ]; then
    echo "[refresh-nexlev] cache is dated $TODAY but is a rollover; not fresh."
    exit 1
  fi
  echo "[refresh-nexlev] SUCCESS - cache now dated $TODAY."
  exit 0
fi

echo "[refresh-nexlev] no fresh cache after attempt; found date '$POST_DATE'."
exit 1
