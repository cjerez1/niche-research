const fs = require('fs');
const path = require('path');

const home = process.env.HOME || process.env.USERPROFILE;
const root = path.join(home, 'niche-scanner');
const credentialsPath = path.join(home, '.codex', '.credentials.json');
const today = process.env.TODAY || new Date().toISOString().slice(0, 10);
const now = process.env.NOW || new Date().toISOString();

const cachePath = path.join(root, 'niche-research', 'nexlev-cache', 'latest.json');
const poppingDir = path.join(root, 'niche-research', 'popping-channels');
const poppingPath = path.join(poppingDir, `${today}.json`);

function n(value) {
  if (value && typeof value === 'object') return n(value.total ?? value.base);
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function named(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(named).filter(Boolean).slice(0, 3).join(', ');
  if (typeof value === 'object') return value.name || value.title || value.label || '';
  return String(value);
}

function validChannelId(id) {
  return /^UC[\w-]{22}$/.test(String(id || ''));
}

function daysBetween(a, b) {
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 9999;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function videos(c) {
  return (c.lastUploadedVideos || c.recentVideos || c.videos || [])
    .map(v => {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    })
    .filter(Boolean);
}

function topVideo(c) {
  const top = videos(c)
    .slice()
    .sort((a, b) => n(b.video_view_count ?? b.views) - n(a.video_view_count ?? a.views))[0];
  if (!top) return null;
  return {
    title: top.video_title || top.title || '',
    views: n(top.video_view_count ?? top.views),
    url: top.video_id ? `https://www.youtube.com/watch?v=${top.video_id}` : (top.url || ''),
    uploadDate: top.video_upload_date || top.publishedAt || '',
  };
}

function score(c) {
  const s = c.stats || {};
  const avg = n(s.avgViewsPerVideo);
  const outlier = n(c.outlierScore);
  const vals = videos(c).map(v => n(v.video_view_count ?? v.views)).filter(Boolean);
  const consistency = vals.length < 2 ? 0.5 : Math.min(...vals) / Math.max(1, avg);
  return (Math.log10(avg + 1) * 40) + (outlier * 25) + (consistency * 35);
}

function parseToolResult(result) {
  const text = result?.content?.find(item => item.type === 'text')?.text;
  if (!text) return result;
  return JSON.parse(text);
}

function extractChannels(data) {
  return data.channels || data.candidates || data.results || [];
}

function loadNexlevCredentials() {
  const all = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const key = Object.keys(all).find(k => k.startsWith('nexlev|'));
  if (!key) throw new Error(`No NexLev OAuth credentials found in ${credentialsPath}`);
  return all[key];
}

async function makeMcpClient() {
  const creds = loadNexlevCredentials();
  const origin = new URL(creds.server_url).origin;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (let clientAttempt = 0; clientAttempt < 8; clientAttempt++) {
    let id = 1;
    const pending = new Map();
    const ac = new AbortController();
    const res = await fetch(creds.server_url, {
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${creds.access_token}`,
      },
      signal: ac.signal,
    });

    if (!res.ok) throw new Error(`MCP SSE HTTP ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readEvent() {
      while (true) {
        const idx = buffer.indexOf('\n\n');
        if (idx >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = { event: 'message', data: '' };
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) event.event = line.slice(6).trim();
            if (line.startsWith('data:')) event.data += line.slice(5).trim();
          }
          return event;
        }
        const { done, value } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    }

    const first = await readEvent();
    const postUrl = new URL(first.data, origin).href;

    async function post(message) {
      let last = '';
      for (let attempt = 0; attempt < 100; attempt++) {
        const r = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${creds.access_token}`,
          },
          body: JSON.stringify(message),
        });
        const body = await r.text();
        if (r.status < 300) return;
        last = `${r.status} ${body}`;
        if (r.status === 404 && /Unknown session/.test(body)) {
          await sleep(50);
          continue;
        }
        throw new Error(last);
      }
      throw new Error(last);
    }

    function call(method, params) {
      const callId = id++;
      const promise = new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
      post({ jsonrpc: '2.0', id: callId, method, params }).catch(err => {
        pending.get(callId)?.reject(err);
        pending.delete(callId);
      });
      return promise;
    }

    (async () => {
      while (true) {
        const event = await readEvent();
        if (!event) break;
        if (event.event !== 'message') continue;
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const item = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) item.reject(new Error(JSON.stringify(message.error)));
          else item.resolve(message.result);
        }
      }
    })();

    try {
      await call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'niche-scanner-direct-refresh', version: '1.0' },
      });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      return {
        callTool: (name, args) => call('tools/call', { name, arguments: args }),
        close: () => ac.abort(),
      };
    } catch (err) {
      ac.abort();
      if (clientAttempt === 7) throw err;
      await sleep(250);
    }
  }
}

function buildPopping(candidates) {
  const matched = candidates
    .filter(c => {
      const s = c.stats || {};
      const id = c.ytChannelId || c.channelId;
      return validChannelId(id)
        && n(s.subscribers) >= 0 && n(s.subscribers) <= 15000
        && n(s.totalVideos) >= 3 && n(s.totalVideos) <= 4
        && n(s.totalViews) >= 100000
        && n(s.avgVideoLength) >= 480
        && daysBetween(s.lastVideoDate, now) <= 21;
    })
    .sort((a, b) => score(b) - score(a))
    .slice(0, 10);

  return matched.map((c, i) => {
    const s = c.stats || {};
    const id = c.ytChannelId || c.channelId;
    const tv = topVideo(c);
    return {
      rank: i + 1,
      title: c.title || '',
      url: `https://www.youtube.com/channel/${id}`,
      niche: named(c.category || c.categories || c.tags || c.format) || 'general',
      uploads: n(s.totalVideos),
      subscribers: n(s.subscribers),
      totalViews: n(s.totalViews),
      avgViewPerVideo: Math.round(n(s.avgViewsPerVideo)),
      avgVideoLengthSec: Math.round(n(s.avgVideoLength)),
      outlierScore: n(c.outlierScore),
      monthlyRevenueUSD: n(s.monthlyRevenue),
      rpm: n(s.rpm),
      daysSinceStart: daysBetween(s.firstVideoDate, now),
      topVideo: tv,
      whyWorking: [
        `${Math.round(n(s.avgViewsPerVideo)).toLocaleString('en-US')} avg views/video`,
        `${n(s.totalVideos)} uploads`,
        tv ? `top video ${Math.round(tv.views).toLocaleString('en-US')} views` : '',
      ].filter(Boolean).join('; '),
    };
  });
}

async function main() {
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const client = await makeMcpClient();
  try {
    const mainRaw = parseToolResult(await client.callTool('search_niche_finder_channels', {
      query: '*',
      isFaceless: true,
      minSubscribers: 500,
      maxSubscribers: 30000,
      minMonthlyViews: 50000,
      minFirstVideoUploadDate: oneYearAgo,
      limit: 100,
    }));

    const candidates = extractChannels(mainRaw);
    if (candidates.length < 1) throw new Error('NexLev returned zero candidates');

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      date: today,
      timestamp: now,
      source: 'nexlev-direct-mcp',
      candidates,
      count: candidates.length,
    }, null, 2), 'utf8');

    const popping = buildPopping(candidates);
    fs.mkdirSync(poppingDir, { recursive: true });
    fs.writeFileSync(poppingPath, JSON.stringify({
      date: today,
      criteria: 'Longform >=8min, 3-4 uploads, 100K+ views, last upload within 3 weeks, 0-15K subscribers. Built from direct NexLev MCP cache.',
      rankedChannels: popping,
      patternSummary: popping.length > 0
        ? ['Built directly from NexLev MCP OAuth data; no Claude/Codex inference and no YouTube API used.']
        : ['No direct NexLev channels matched the Popping Off gate today.'],
    }, null, 2), 'utf8');

    console.log(`DIRECT_NEXLEV_REFRESH_DONE candidates=${candidates.length} popping=${popping.length}`);
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
