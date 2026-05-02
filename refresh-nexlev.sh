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

refresh_claude_vidiq() {
  echo "[refresh-nexlev] refreshing Claude + VidIQ intelligence cache..."
  if [ "${VIDIQ_REFRESH_METHOD:-}" = "cli" ]; then
    run_claude_vidiq_refresh || echo "[refresh-nexlev] Claude/VidIQ refresh failed (non-fatal); scanner will use latest available VidIQ cache."
    return 0
  fi

  TODAY="$TODAY" NOW="$NOW" node scripts/refresh-vidiq-claude.js && return 0

  echo "[refresh-nexlev] Anthropic API Claude/VidIQ refresh failed; trying Claude CLI fallback..."
  run_claude_vidiq_refresh || echo "[refresh-nexlev] Claude/VidIQ refresh failed (non-fatal); scanner will use latest available VidIQ cache."
}

vidiq_refresh_prompt() {
  cat <<PROMPT
You are Claudio's niche-scanner brain at $NOW UTC.

Use BOTH:
1. Read /home/ubuntu/niche-scanner/niche-research/nexlev-cache/latest.json as the breakout-channel inventory.
2. Use the available VidIQ MCP/custom connector tools as the YouTube intelligence layer.

Do not use YouTube Data API. Do not invent channels or stats.

Find and validate the best faceless YouTube opportunities for Claudio:
- under 60 days content age where possible
- under 30000 subscribers where possible
- consistent long-form views, outliers, high Browse/packaging potential
- simple faceless production
- priority niches: Australian health/consumer, senior health, food safety, home maintenance, earth science/disasters, space documentary, hidden history, abandoned/lost places, practical finance for older viewers

Write valid UTF-8 JSON to /home/ubuntu/niche-scanner/niche-research/vidiq-cache/latest.json with this exact shape:
{
  "date": "$TODAY",
  "timestamp": "$NOW",
  "source": "claude-cli-vidiq-mcp",
  "summary": ["operator finding"],
  "candidates": [
    {
      "channelId": "UC...",
      "channelTitle": "Channel name",
      "channelUrl": "https://www.youtube.com/channel/UC...",
      "niche": "short niche label",
      "whyItMatters": "commercial reason",
      "vidiqSignals": {
        "outlierScore": 0,
        "viewsPerHour": 0,
        "searchVolume": 0,
        "competition": 0,
        "trend": "rising|stable|unknown",
        "keywords": ["keyword"]
      },
      "stats": {
        "subscribers": 0,
        "averageViews": 0,
        "medianViews": 0,
        "totalVideos": 0,
        "uploadsPerWeek": 0,
        "avgVideoLengthSec": 0,
        "firstVideoDate": "YYYY-MM-DD"
      },
      "videos": [
        {
          "videoId": "youtube video id",
          "title": "video title",
          "views": 0,
          "publishedAt": "YYYY-MM-DD",
          "duration": 0,
          "outlierScore": 0,
          "viewsPerHour": 0
        }
      ],
      "claudeVerdict": {
        "score": 0,
        "verdict": "GO|CAUTION|BEND|SKIP",
        "reason": "short reason",
        "nicheBend": "stronger angle Claudio should test"
      }
    }
  ],
  "keywords": []
}

Hard rules:
- Include only candidates with a real YouTube channel ID beginning with UC.
- Prefer 30 high-quality candidates over a weak large list.
- Finish by replying only with REFRESH_DONE.
PROMPT
}

run_claude_vidiq_refresh() {
  local out="/tmp/vidiq-claude-refresh.log"
  if ! command -v claude >/dev/null 2>&1; then
    echo "[refresh-nexlev] Claude CLI fallback unavailable: claude CLI not found."
    return 1
  fi

  timeout 900 claude -p --dangerously-skip-permissions "$(vidiq_refresh_prompt)" </dev/null >"$out" 2>&1
  tail -80 "$out"

  if grep -qiE "limit|rate|reset|credit|balance" "$out"; then
    echo "[refresh-nexlev] Claude CLI fallback is rate/credit-limited; will retry on next cron tick."
    return 1
  fi

  python3 - "$HOME/niche-scanner/niche-research/vidiq-cache/latest.json" "$TODAY" <<'PY'
import json, sys
path, today = sys.argv[1], sys.argv[2]
raw = open(path, "rb").read().decode("utf-8-sig")
data = json.loads(raw)
count = len(data.get("candidates") or data.get("rows") or [])
if data.get("date") != today or count < 1:
    raise SystemExit(1)
print(f"[refresh-nexlev] Claude CLI VidIQ cache ready: {count} candidates")
PY
}

if [ -f "$CACHE" ]; then
  CACHE_DATE="$(cache_date)"
  CACHE_ROLLOVER="$(cache_is_rollover)"
  if [ "$CACHE_DATE" = "$TODAY" ] && [ "$CACHE_ROLLOVER" != "1" ] && [ "$FORCE_REFRESH" != "1" ]; then
    echo "[refresh-nexlev] cache is already dated $TODAY; no-op."
    refresh_claude_vidiq
    exit 0
  fi
  if [ "$CACHE_DATE" = "$TODAY" ] && [ "$CACHE_ROLLOVER" = "1" ]; then
    echo "[refresh-nexlev] cache is dated $TODAY but is a rollover; refreshing again."
  elif [ "$CACHE_DATE" = "$TODAY" ]; then
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
      refresh_claude_vidiq
      exit 0
    fi
    echo "[refresh-nexlev] forced refresh did not rewrite cache; found date '$POST_DATE'."
    return 1
  fi

  if [ "$POST_DATE" = "$TODAY" ]; then
    echo "[refresh-nexlev] SUCCESS - cache now dated $TODAY."
    refresh_claude_vidiq
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

run_direct_mcp_refresh() {
  echo "[refresh-nexlev] trying direct NexLev MCP OAuth refresh..."
  TODAY="$TODAY" NOW="$NOW" node scripts/refresh-nexlev-direct.js
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

run_direct_mcp_refresh || run_codex_refresh || run_claude_refresh

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
  refresh_claude_vidiq
  exit 0
fi

echo "[refresh-nexlev] no fresh cache after attempt; found date '$POST_DATE'."
exit 1
