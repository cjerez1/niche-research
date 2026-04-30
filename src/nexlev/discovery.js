const fs = require('fs');
const path = require('path');

/**
 * Read NexLev discovery cache and normalize into scanner-compatible candidates.
 * The cache is written by Claude Code MCP calls before the scanner runs.
 */
function loadNexlevCache(cacheDir) {
  const cachePath = path.join(cacheDir, 'latest.json');
  if (!fs.existsSync(cachePath)) {
    console.log('No NexLev cache found. Run NexLev discovery first.');
    return null;
  }

  // Strip UTF-8 BOM if present (happens when files are written by PowerShell on Windows)
  let content = fs.readFileSync(cachePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const raw = JSON.parse(content);
  if (raw.rolloverFrom || raw.rolledOverFrom) {
    console.log(`NexLev cache is a rollover from ${raw.rolloverFrom || raw.rolledOverFrom} — not fresh. Will use YouTube API only.`);
    return null;
  }
  const cacheAge = (Date.now() - new Date(raw.date).getTime()) / (1000 * 60 * 60);

  if (cacheAge > 24) {
    console.log(`NexLev cache is ${Math.round(cacheAge)}h old — stale. Will use YouTube API only.`);
    return null;
  }

  console.log(`NexLev cache loaded: ${raw.candidates.length} candidates from ${raw.date}`);
  return raw;
}

/**
 * Convert NexLev candidate format to scanner-compatible format.
 */
function normalizeNexlevCandidate(nx) {
  const stats = nx.stats || {};
  const channelId = nx.ytChannelId || nx.channelId || nx.channel_id || extractChannelId(nx.url || nx.channelUrl || '');
  const channelUrl = normalizeChannelUrl(nx.url || nx.channelUrl, channelId);
  const subscribers = firstNumber(nx.subscribers, nx.subscriberCount, nx.chTotalSubscriberCount, stats.subscribers);
  const avgViews = firstNumber(nx.avgViewPerVideo, nx.avgViewsPerVideo, nx.averageViews, stats.avgViewsPerVideo);
  const medianViews = firstNumber(nx.medianViewPerVideo, nx.medianViewsPerVideo, stats.medianViewsPerVideo);
  const monthlyViews = firstNumber(nx.avgMonthlyViews, nx.monthlyViews, stats.monthlyViews);
  const monthlyRevenue = firstNumber(nx.avgMonthlyRevenue, nx.monthlyRevenue, stats.monthlyRevenue);
  const totalViews = firstNumber(nx.totalViews, nx.totalViewCount, stats.totalViews);
  const totalVideos = firstNumber(nx.numOfUploads, nx.totalVideos, nx.videoCount, stats.totalVideos);
  const avgVideoLength = firstNumber(nx.avgVideoLength, nx.avgVideoLengthSec, stats.avgVideoLength);
  const uploadsPerWeek = firstNumber(nx.uploadsPerWeek, stats.uploadsPerWeek,
    nx.avgMonthlyUploadFrequency ? +(nx.avgMonthlyUploadFrequency / 4.33).toFixed(1) : null);
  const firstVideoDate = nx.firstVideoDate || stats.firstVideoDate || nx.channelCreationDate;
  const ageDays = firstNumber(nx.daysSinceStart, nx.ageDays, daysSince(firstVideoDate));
  const rpm = normalizeRpm(nx.rpm || stats.rpm);
  const isMonetized = nx.isMonetized ?? nx.isMonetizationEnabled;

  // Convert NexLev's recentVideos to scanner video format
  const videos = (nx.recentVideos || nx.lastUploadedVideos || []).map(v => {
    // Handle both string (JSON) and object formats
    const vid = typeof v === 'string' ? JSON.parse(v) : v;
    return {
      videoId: vid.video_id,
      title: vid.video_title,
      views: vid.video_view_count,
      duration: parseDuration(vid.length_text),
      publishedAt: vid.video_upload_date,
    };
  });

  return {
    channelId: channelId,
    channelTitle: nx.title,
    channelUrl,
    subscriberCount: subscribers,
    hiddenSubs: false,
    ageDays,
    videoCount: totalVideos,
    uploadFrequency: uploadsPerWeek,
    videos: videos,
    description: nx.description || '',
    metrics: {
      averageViews: avgViews,
      medianViews,
      maxViews: Math.max(...videos.map(v => v.views || 0), 0),
      viewToSubRatio: subscribers > 0 ? +(avgViews / subscribers).toFixed(2) : 0,
      growthVelocity: subscribers && ageDays ? Math.round(subscribers / ageDays) : 0,
      outlierCount: 0, // Computed below
      averageDuration: avgVideoLength || 0,
    },
    flags: {
      possiblyFaceless: nx.isFaceless === true,
      possiblyRebranded: false,
      englishConfidence: 1.0, // NexLev pre-filters for English
    },
    // NexLev-specific enrichment data
    nexlev: {
      id: nx.id,
      rpm,
      avgMonthlyRevenue: monthlyRevenue,
      totalRevenue: nx.totalRevenueGenerated,
      avgMonthlyViews: monthlyViews,
      totalViews,
      isMonetized,
      outlierScore: nx.outlierScore,
      quality: nx.quality,
      categories: normalizeCategories(nx.categories || nx.category || nx.tags),
      format: normalizeNamedValue(nx.format),
      isFaceless: nx.isFaceless,
      facelessConfidence: nx.facelessConfidence || null,
      hasShorts: nx.hasShorts,
      daysSinceLastUpload: nx.daysSinceLastUpload,
      recentVideos: nx.lastUploadedVideos || nx.recentVideos,
      url: channelUrl,
      subscribers,
      avgViewPerVideo: avgViews,
      daysSinceStart: ageDays,
      uploadsPerWeek,
    },
    _source: 'nexlev',
  };
}

/**
 * Merge NexLev candidates with YouTube API candidates.
 * NexLev data takes priority when the same channel appears in both.
 */
function mergeWithYouTubeResults(nexlevCandidates, ytCandidates) {
  const merged = new Map();

  // Add NexLev candidates first (higher priority)
  for (const c of nexlevCandidates) {
    if (c.channelId) {
      merged.set(c.channelId, c);
    }
  }

  // Add YouTube candidates, enriching if NexLev already has them
  for (const c of ytCandidates) {
    if (merged.has(c.channelId)) {
      // Enrich existing NexLev candidate with YouTube API data
      const existing = merged.get(c.channelId);
      // Keep NexLev data but add any YouTube-only fields
      if (c.videos?.length > (existing.videos?.length || 0)) {
        existing.videos = c.videos;
      }
      if (!existing.description && c.description) {
        existing.description = c.description;
      }
    } else {
      merged.set(c.channelId, { ...c, _source: 'youtube-api' });
    }
  }

  return Array.from(merged.values());
}

/**
 * Save NexLev discovery results to cache.
 * Called by the Claude Code orchestration layer.
 */
function saveNexlevCache(candidates, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, 'latest.json');
  const data = {
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    candidates: candidates,
    count: candidates.length,
  };
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`NexLev cache saved: ${candidates.length} candidates to ${cachePath}`);
}

function extractChannelId(url) {
  if (!url) return null;
  const match = url.match(/UC[\w-]{22}/);
  return match ? match[0] : null;
}

function normalizeChannelUrl(url, channelId) {
  if (url) return url.startsWith('http') ? url : `https://${url}`;
  return channelId ? `https://www.youtube.com/channel/${channelId}` : '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeRpm(value) {
  if (value && typeof value === 'object') return firstNumber(value.total, value.base);
  return firstNumber(value);
}

function normalizeNamedValue(value) {
  if (!value) return '';
  if (typeof value === 'object') return value.name || value.title || value.label || '';
  return String(value);
}

function normalizeCategories(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(normalizeNamedValue).filter(Boolean);
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 86400000));
}

function parseDuration(lengthText) {
  if (!lengthText) return 0;
  const parts = lengthText.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

module.exports = {
  loadNexlevCache,
  normalizeNexlevCandidate,
  mergeWithYouTubeResults,
  saveNexlevCache,
};
