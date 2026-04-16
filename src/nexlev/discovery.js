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

  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
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
  const channelId = extractChannelId(nx.url || '');

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
    channelUrl: nx.url?.startsWith('http') ? nx.url : `https://${nx.url}`,
    subscriberCount: nx.subscribers,
    hiddenSubs: false,
    ageDays: nx.daysSinceStart,
    videoCount: nx.numOfUploads,
    uploadFrequency: nx.uploadsPerWeek || (nx.avgMonthlyUploadFrequency ? (nx.avgMonthlyUploadFrequency / 4.33).toFixed(1) : null),
    videos: videos,
    description: '',
    metrics: {
      averageViews: nx.avgViewPerVideo,
      medianViews: nx.medianViewPerVideo,
      maxViews: Math.max(...videos.map(v => v.views || 0), 0),
      viewToSubRatio: nx.subscribers > 0 ? +(nx.avgViewPerVideo / nx.subscribers).toFixed(2) : 0,
      growthVelocity: nx.subscribers && nx.daysSinceStart ? Math.round(nx.subscribers / nx.daysSinceStart) : 0,
      outlierCount: 0, // Computed below
      averageDuration: nx.avgVideoLength || 0,
    },
    flags: {
      possiblyFaceless: nx.isFaceless === true,
      possiblyRebranded: false,
      englishConfidence: 1.0, // NexLev pre-filters for English
    },
    // NexLev-specific enrichment data
    nexlev: {
      id: nx.id,
      rpm: nx.rpm,
      avgMonthlyRevenue: nx.avgMonthlyRevenue,
      totalRevenue: nx.totalRevenueGenerated,
      avgMonthlyViews: nx.avgMonthlyViews,
      totalViews: nx.totalViews,
      isMonetized: nx.isMonetized,
      outlierScore: nx.outlierScore,
      quality: nx.quality,
      categories: nx.categories || [],
      format: nx.format,
      isFaceless: nx.isFaceless,
      facelessConfidence: nx.facelessConfidence || null,
      hasShorts: nx.hasShorts,
      daysSinceLastUpload: nx.daysSinceLastUpload,
      recentVideos: nx.lastUploadedVideos || nx.recentVideos,
      url: nx.url?.startsWith('http') ? nx.url : `https://${nx.url}`,
      subscribers: nx.subscribers,
      avgViewPerVideo: nx.avgViewPerVideo,
      daysSinceStart: nx.daysSinceStart,
      uploadsPerWeek: nx.uploadsPerWeek || (nx.avgMonthlyUploadFrequency ? +(nx.avgMonthlyUploadFrequency / 4.33).toFixed(1) : null),
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
