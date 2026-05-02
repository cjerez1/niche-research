require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');

const root = process.env.SCANNER_ROOT || path.join(process.env.HOME || process.env.USERPROFILE, 'niche-scanner');
const today = process.env.TODAY || new Date().toISOString().slice(0, 10);
const now = process.env.NOW || new Date().toISOString();
const cachePath = path.join(root, 'niche-research', 'vidiq-cache', 'latest.json');
const nexlevCachePath = path.join(root, 'niche-research', 'nexlev-cache', 'latest.json');
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const vidiqKey = process.env.VIDIQ_API_KEY;
const vidiqMcpUrl = process.env.VIDIQ_MCP_URL || 'https://mcp.vidiq.com/mcp';
const model = process.env.VIDIQ_CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-4-20250514';

if (!anthropicKey) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

if (!vidiqKey) {
  console.error('VIDIQ_API_KEY is not set.');
  process.exit(1);
}

function prompt() {
  const nexlevContext = loadNexlevContext();
  return `You are Claudio's niche-scanner brain.

Use BOTH data sources:
1. NexLev cache below as the breakout-channel inventory.
2. VidIQ MCP tools as the YouTube intelligence layer for trends, outliers, keyword demand, competitor pressure, and validation.

Do not use YouTube Data API.

Commercial goal:
- Find breakout channels/topics before competitors.
- Favor channels under 60 days of content age, under 30,000 subscribers, consistent long-form views, outlier videos, high Browse/packaging potential, and simple faceless production.
- Prioritize niches Claudio can exploit: Australian health/consumer, senior health, food safety, home maintenance, earth science/disasters, space documentary, hidden history, abandoned/lost places, practical finance for older viewers.

Use VidIQ for as many of these as available:
- breakout channels
- trending videos
- outlier scores
- keyword research
- channel stats
- competitor/trend analysis

Return only raw JSON, no markdown and no commentary, with this exact shape:
{
  "date": "${today}",
  "timestamp": "${now}",
  "source": "claude-vidiq-mcp",
  "summary": ["operator-level finding 1", "operator-level finding 2"],
  "candidates": [
    {
      "channelId": "UC...",
      "channelTitle": "Channel name",
      "channelUrl": "https://www.youtube.com/channel/UC...",
      "niche": "short niche label",
      "whyItMatters": "commercial reason this is worth Claudio's attention",
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
  "keywords": [
    {
      "keyword": "topic keyword",
      "niche": "niche label",
      "why": "why this keyword matters",
      "vidiqSignals": {
        "searchVolume": 0,
        "competition": 0,
        "overallScore": 0
      }
    }
  ]
}

Hard rules:
- Include only candidates with a real YouTube channel ID beginning with UC.
- Do not invent channels, URLs, stats, dates, or VidIQ metrics. Use null/0/unknown if VidIQ does not provide a field.
- Prefer 30 high-quality candidates over a large weak list.
- Score is Claudio commercial priority, not generic creator advice.

${nexlevContext}
`;
}

function loadNexlevContext() {
  if (!fs.existsSync(nexlevCachePath)) {
    return 'NEXLEV_CACHE: unavailable. Use VidIQ MCP to find fresh candidates from scratch.';
  }

  const raw = JSON.parse(fs.readFileSync(nexlevCachePath, 'utf8').replace(/^\uFEFF/, ''));
  const rows = (raw.candidates || []).slice(0, Number(process.env.VIDIQ_NEXLEV_CONTEXT_LIMIT || 60));
  const compact = rows.map(c => {
    const stats = c.stats || {};
    const id = c.ytChannelId || c.channelId || c.channel_id || extractChannelId(c.url || c.channelUrl || '');
    const videos = (c.lastUploadedVideos || c.recentVideos || c.videos || []).slice(0, 5).map(v => {
      const item = typeof v === 'string' ? safeJson(v) : v;
      return {
        title: item?.video_title || item?.title || '',
        views: item?.video_view_count || item?.views || 0,
        publishedAt: item?.video_upload_date || item?.publishedAt || '',
      };
    });
    return {
      channelId: id,
      title: c.title || c.channelTitle || '',
      url: c.url || c.channelUrl || (id ? `https://www.youtube.com/channel/${id}` : ''),
      subscribers: c.subscribers || c.subscriberCount || stats.subscribers || 0,
      averageViews: c.avgViewPerVideo || c.averageViews || stats.avgViewsPerVideo || 0,
      monthlyViews: c.avgMonthlyViews || stats.monthlyViews || 0,
      monthlyRevenue: c.avgMonthlyRevenue || stats.monthlyRevenue || 0,
      rpm: c.rpm || stats.rpm || 0,
      outlierScore: c.outlierScore || 0,
      isFaceless: c.isFaceless,
      categories: c.categories || c.category || c.tags || [],
      videos,
    };
  }).filter(c => /^UC[\w-]{22}$/.test(String(c.channelId || '')));

  return `NEXLEV_CACHE_DATE: ${raw.date || raw.timestamp || 'unknown'}
NEXLEV_CANDIDATES_JSON:
${JSON.stringify(compact, null, 2)}`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function extractChannelId(value) {
  const match = String(value || '').match(/UC[\w-]{22}/);
  return match ? match[0] : '';
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Claude returned empty text.');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`Could not parse Claude JSON: ${trimmed.slice(0, 300)}`);
  }
}

async function main() {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-11-20',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(process.env.VIDIQ_CLAUDE_MAX_TOKENS || 12000),
      temperature: 0.2,
      mcp_servers: [{
        type: 'url',
        url: vidiqMcpUrl,
        name: 'vidiq',
        authorization_token: vidiqKey,
      }],
      tools: [{
        type: 'mcp_toolset',
        mcp_server_name: 'vidiq',
        default_config: { enabled: true, defer_loading: false },
      }],
      messages: [{ role: 'user', content: prompt() }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Claude VidIQ refresh HTTP ${response.status}: ${body.slice(0, 1000)}`);
  }

  const raw = JSON.parse(body);
  const text = raw.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
  const parsed = extractJson(text);
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  if (candidates.length < 1) throw new Error('Claude/VidIQ returned zero candidates.');

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({
    ...parsed,
    date: parsed.date || today,
    timestamp: parsed.timestamp || now,
    source: 'claude-vidiq-mcp',
    mcpUrl: vidiqMcpUrl,
    model,
    count: candidates.length,
    usage: raw.usage || null,
  }, null, 2), 'utf8');

  console.log(`CLAUDE_VIDIQ_REFRESH_DONE candidates=${candidates.length} cache=${cachePath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
