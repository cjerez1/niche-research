const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cachePath = path.join(ROOT, 'niche-research', 'nexlev-cache', 'latest.json');
const timeoutMs = Number(process.env.LIVE_CHANNEL_TIMEOUT_MS || 8000);
const concurrency = Number(process.env.LIVE_CHANNEL_CONCURRENCY || 8);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function channelId(candidate) {
  const fromField = candidate.ytChannelId || candidate.channelId || candidate.channel_id;
  if (validChannelId(fromField)) return fromField;
  const url = candidate.url || candidate.channelUrl || '';
  const match = String(url).match(/UC[\w-]{22}/);
  return match ? match[0] : '';
}

function validChannelId(id) {
  return /^UC[\w-]{22}$/.test(String(id || ''));
}

function fetchRss(id) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`;
  return new Promise(resolve => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: { 'user-agent': 'Mozilla/5.0 niche-scanner live-channel-check' },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (body.length < 2000) body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200 && body.includes('<feed')) {
          resolve({ ok: true, status: res.statusCode, reason: 'rss-feed-ok' });
          return;
        }
        if (res.statusCode === 404 || /not found|terminated|unavailable/i.test(body)) {
          resolve({ ok: false, status: res.statusCode, reason: 'youtube-rss-not-found' });
          return;
        }
        resolve({ ok: null, status: res.statusCode, reason: `unexpected-rss-status-${res.statusCode}` });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', err => {
      resolve({ ok: null, status: 0, reason: err.message || 'request-error' });
    });
  });
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  if (!fs.existsSync(cachePath)) {
    console.error(`No NexLev cache found at ${cachePath}`);
    process.exit(1);
  }

  const raw = readJson(cachePath);
  const candidates = raw.candidates || [];
  const checkedAt = new Date().toISOString();

  const results = await mapLimit(candidates, concurrency, async candidate => {
    const id = channelId(candidate);
    if (!validChannelId(id)) {
      return { candidate, id, ok: false, status: 0, reason: 'missing-valid-channel-id' };
    }
    const result = await fetchRss(id);
    return { candidate, id, ...result };
  });

  const removed = results.filter(r => r.ok === false);
  const unknown = results.filter(r => r.ok === null);
  const kept = results.filter(r => r.ok !== false).map(r => r.candidate);

  if (removed.length > 0) {
    const stamp = checkedAt.replace(/[:.]/g, '-');
    const backupPath = cachePath.replace(/\.json$/, `.before-live-validation-${stamp}.json`);
    fs.copyFileSync(cachePath, backupPath);
    raw.candidates = kept;
    raw.count = kept.length;
    raw.liveValidation = {
      checkedAt,
      total: candidates.length,
      kept: kept.length,
      removed: removed.length,
      unknown: unknown.length,
      removedChannels: removed.map(r => ({
        id: r.id,
        title: r.candidate.title || r.candidate.channelTitle || '',
        status: r.status,
        reason: r.reason,
      })),
    };
    writeJson(cachePath, raw);
    console.log(`Live validation removed ${removed.length} dead/missing channels; kept ${kept.length}.`);
    console.log(`Backup written: ${backupPath}`);
  } else {
    raw.liveValidation = {
      checkedAt,
      total: candidates.length,
      kept: candidates.length,
      removed: 0,
      unknown: unknown.length,
    };
    writeJson(cachePath, raw);
    console.log(`Live validation passed: ${candidates.length} channels kept; ${unknown.length} unknown checks.`);
  }

  if (unknown.length > 0) {
    console.log('Unknown live checks kept for safety:');
    unknown.slice(0, 10).forEach(r => console.log(`- ${r.id || 'no-id'} ${r.reason}`));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
