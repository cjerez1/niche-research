const fs = require('fs');
const path = require('path');

function loadVidiqCache(cacheDir) {
  const cachePath = path.join(cacheDir, 'latest.json');
  if (!fs.existsSync(cachePath)) {
    console.log('No VidIQ cache found. Run VidIQ discovery first.');
    return null;
  }

  let content = fs.readFileSync(cachePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const raw = JSON.parse(content);
  if (raw.rolloverFrom || raw.rolledOverFrom) {
    console.log(`VidIQ cache is a rollover from ${raw.rolloverFrom || raw.rolledOverFrom} - not fresh. Skipping VidIQ.`);
    return null;
  }

  const stamp = raw.timestamp || raw.date;
  const cacheAge = stamp ? (Date.now() - new Date(stamp).getTime()) / 3600000 : 999;
  if (!Number.isFinite(cacheAge) || cacheAge > 48) {
    console.log(`VidIQ cache is ${Math.round(cacheAge)}h old - stale. Skipping VidIQ.`);
    return null;
  }

  const rows = extractRows(raw);
  console.log(`VidIQ cache loaded: ${rows.length} raw rows from ${raw.date || raw.timestamp || 'unknown date'}`);
  return { ...raw, rows };
}

function normalizeVidiqCandidate(row) {
  const channel = row.channel || row.channelInfo || row.creator || {};
  const stats = row.stats || row.channelStats || row.metrics || {};
  const id = firstString(
    row.channelId,
    row.ytChannelId,
    row.channel_id,
    channel.id,
    channel.channelId,
    extractChannelId(row.channelUrl || row.url || channel.url || row.videoUrl || row.watchUrl)
  );
  if (!validChannelId(id)) return null;

  const channelTitle = firstString(
    row.channelTitle,
    row.title,
    row.name,
    channel.title,
    channel.name,
    row.author,
    row.videoOwnerChannelTitle
  );
  const channelUrl = normalizeChannelUrl(firstString(row.channelUrl, channel.url), id);
  const videos = normalizeVideos(row);
  const subscribers = firstNumber(row.subscriberCount, row.subscribers, channel.subscribers, stats.subscribers);
  const avgViews = firstNumber(row.averageViews, row.avgViews, stats.averageViews, stats.avgViews, average(videos.map(v => v.views)));
  const totalVideos = firstNumber(row.videoCount, row.totalVideos, channel.videoCount, stats.videoCount, stats.totalVideos, videos.length);
  const firstVideoDate = firstString(row.firstVideoDate, row.firstUploadDate, stats.firstVideoDate, oldestDate(videos));
  const ageDays = firstNumber(row.ageDays, row.daysSinceStart, daysSince(firstVideoDate));
  const avgDuration = firstNumber(row.averageDuration, row.avgVideoLength, stats.averageDuration, stats.avgVideoLength, average(videos.map(v => v.duration).filter(Boolean)));
  const signals = row.vidiqSignals || row.signals || {};
  const tags = normalizeTags(row.tags || row.keywords || signals.keywords || row.categories || row.category || row.niche);

  return {
    channelId: id,
    channelTitle: channelTitle || id,
    channelUrl,
    subscriberCount: subscribers,
    hiddenSubs: subscribers <= 0,
    ageDays,
    videoCount: totalVideos,
    uploadFrequency: firstNumber(row.uploadsPerWeek, stats.uploadsPerWeek),
    videos,
    description: firstString(row.description, channel.description, row.channelDescription),
    metrics: {
      averageViews: avgViews,
      medianViews: firstNumber(row.medianViews, stats.medianViews),
      maxViews: Math.max(...videos.map(v => v.views || 0), firstNumber(row.maxViews, stats.maxViews)),
      viewToSubRatio: subscribers > 0 ? +(avgViews / subscribers).toFixed(2) : 0,
      growthVelocity: subscribers && ageDays ? Math.round(subscribers / ageDays) : 0,
      outlierCount: firstNumber(row.outlierCount, signals.outlierCount, stats.outlierCount),
      averageDuration: avgDuration || 0,
    },
    flags: {
      possiblyFaceless: /faceless|documentary|ai voice|voiceover|narrat/i.test([row.format, row.niche, row.description, tags.join(' ')].join(' ')),
      possiblyRebranded: false,
      englishConfidence: 1.0,
    },
    vidiq: {
      sourceTool: row._vidiqTool || '',
      keyword: firstString(row.keyword, row.query, row.searchTerm),
      score: firstNumber(row.score, row.vidiqScore, row.keywordScore, row.overallScore, row.claudeVerdict?.score),
      outlierScore: firstNumber(row.outlierScore, signals.outlierScore),
      viewsPerHour: firstNumber(row.viewsPerHour, row.vph, row.velocity, signals.viewsPerHour),
      competition: firstNumber(row.competition, row.competitionScore, signals.competition),
      searchVolume: firstNumber(row.searchVolume, row.volume, signals.searchVolume),
      trend: firstString(signals.trend, row.trend),
      whyItMatters: firstString(row.whyItMatters),
      claudeVerdict: row.claudeVerdict || null,
      tags,
      raw: row,
    },
    _source: 'vidiq',
  };
}

function mergeCandidates(...candidateLists) {
  const merged = new Map();
  for (const list of candidateLists) {
    for (const candidate of list || []) {
      if (!candidate?.channelId) continue;
      const existing = merged.get(candidate.channelId);
      if (!existing) {
        merged.set(candidate.channelId, candidate);
        continue;
      }
      merged.set(candidate.channelId, mergeCandidate(existing, candidate));
    }
  }
  return Array.from(merged.values());
}

function mergeCandidate(existing, incoming) {
  const merged = {
    ...incoming,
    ...existing,
    nexlev: existing.nexlev || incoming.nexlev,
    vidiq: existing.vidiq || incoming.vidiq,
    _source: [existing._source, incoming._source].filter(Boolean).join('+'),
  };
  if ((incoming.videos || []).length > (existing.videos || []).length) merged.videos = incoming.videos;
  if (!merged.description && incoming.description) merged.description = incoming.description;
  return merged;
}

function extractRows(raw) {
  const buckets = [
    raw.candidates,
    raw.channels,
    raw.results,
    raw.items,
    raw.rows,
    raw.data,
    ...(raw.toolResults || []).map(r => r.rows || r.results || r.channels || r.items || r.data),
  ];
  return buckets.flatMap(flattenRows).filter(v => v && typeof v === 'object');
}

function flattenRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenRows);
  if (typeof value === 'object') {
    if (Array.isArray(value.channels)) return value.channels.flatMap(flattenRows);
    if (Array.isArray(value.results)) return value.results.flatMap(flattenRows);
    if (Array.isArray(value.items)) return value.items.flatMap(flattenRows);
    if (Array.isArray(value.videos)) return value.videos.flatMap(flattenRows);
    return [value];
  }
  return [];
}

function normalizeVideos(row) {
  const rawVideos = row.videos || row.recentVideos || row.topVideos || row.lastUploadedVideos || (row.videoId || row.video_id ? [row] : []);
  return flattenRows(rawVideos).map(v => ({
    videoId: firstString(v.videoId, v.video_id, extractVideoId(v.videoUrl || v.url || v.watchUrl)),
    title: firstString(v.title, v.videoTitle, v.video_title),
    views: firstNumber(v.views, v.viewCount, v.video_view_count),
    comments: firstNumber(v.comments, v.commentCount),
    duration: firstNumber(v.duration, v.durationSec, parseDuration(v.lengthText || v.length_text || v.durationText)),
    publishedAt: firstString(v.publishedAt, v.uploadDate, v.video_upload_date, v.date),
    outlierScore: firstNumber(v.outlierScore),
    viewsPerHour: firstNumber(v.viewsPerHour, v.vph),
  })).filter(v => v.title || v.videoId || v.views);
}

function validChannelId(id) {
  return /^UC[\w-]{22}$/.test(String(id || ''));
}

function extractChannelId(value) {
  const match = String(value || '').match(/UC[\w-]{22}/);
  return match ? match[0] : '';
}

function extractVideoId(value) {
  const match = String(value || '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/);
  return match ? (match[1] || match[2]) : '';
}

function normalizeChannelUrl(url, channelId) {
  if (url) return String(url).startsWith('http') ? String(url) : `https://${url}`;
  return channelId ? `https://www.youtube.com/channel/${channelId}` : '';
}

function firstString(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function average(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function normalizeTags(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[,|]/);
  return arr.map(v => typeof v === 'object' ? (v.name || v.title || v.label || '') : String(v).trim()).filter(Boolean);
}

function oldestDate(videos) {
  const times = videos.map(v => Date.parse(v.publishedAt)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : '';
}

function daysSince(dateStr) {
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 86400000));
}

function parseDuration(text) {
  if (!text) return 0;
  const parts = String(text).split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
}

module.exports = {
  loadVidiqCache,
  normalizeVidiqCandidate,
  mergeCandidates,
};
