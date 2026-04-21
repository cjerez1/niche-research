const fs = require('fs');
const path = require('path');
const { setTimeout } = require('timers/promises');

/**
 * Scan the competitive landscape for a candidate's niche.
 * Searches YouTube for channels in the same niche, gets their stats,
 * and assesses saturation level.
 */
async function scanCompetition(youtube, candidate, config) {
  const cacheDir = config.competition.cacheDir;
  const nicheSlug = buildNicheSlug(candidate);

  // Check cache first (7-day TTL)
  const cached = loadCachedCompetition(nicheSlug, cacheDir, config.competition.cacheTTLDays);
  if (cached) {
    console.log(`  Competition cache hit for "${nicheSlug}"`);
    return { ...cached, quotaUsed: 0, fromCache: true };
  }

  // Generate niche-specific search queries
  const queries = generateNicheQueries(candidate);
  let quotaUsed = 0;

  // Per SOP: filter to last 30 days so "direct hits" count is meaningful.
  const windowDays = config.competition.directHitWindowDays || 30;
  const publishedAfter = new Date(Date.now() - windowDays * 86400000).toISOString();

  // Search for competitors — collect both channels AND videos (for direct-hit count)
  const competitorChannelIds = new Set();
  const channelVideoCount = new Map(); // track how many videos per channel appear
  const directHitVideoIds = new Set(); // unique videos on this angle in the window
  const directHitVideos = []; // {videoId, title, channelId, channelTitle, publishedAt}

  for (const query of queries.slice(0, config.competition.queriesPerNiche)) {
    try {
      const response = await youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        order: 'viewCount',
        maxResults: 50,
        videoDuration: 'medium',
        relevanceLanguage: 'en',
        publishedAfter,
      });
      quotaUsed += 100;

      for (const item of (response.data.items || [])) {
        const chId = item.snippet.channelId;
        const vidId = item.id?.videoId;
        competitorChannelIds.add(chId);
        channelVideoCount.set(chId, (channelVideoCount.get(chId) || 0) + 1);
        if (vidId && !directHitVideoIds.has(vidId)) {
          directHitVideoIds.add(vidId);
          directHitVideos.push({
            videoId: vidId,
            title: item.snippet.title,
            channelId: chId,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
          });
        }
      }

      await setTimeout(100);
    } catch (err) {
      if (err.code === 403 || err.response?.status === 403) {
        console.error('  Quota exceeded during competition scan');
        break;
      }
      console.error(`  Competition search error: ${err.message}`);
    }
  }

  // Remove the candidate's own videos from direct hits
  const directHitsFiltered = directHitVideos.filter(v => v.channelId !== candidate.channelId);

  // Fetch view counts for the top few direct hits to benchmark demand (SOP step 3)
  const topHitIds = directHitsFiltered.slice(0, 10).map(v => v.videoId);
  const videoViewsMap = new Map();
  if (topHitIds.length > 0) {
    try {
      const vidResp = await youtube.videos.list({
        part: 'statistics',
        id: topHitIds.join(','),
      });
      quotaUsed += 1;
      for (const v of (vidResp.data.items || [])) {
        videoViewsMap.set(v.id, parseInt(v.statistics.viewCount) || 0);
      }
    } catch (err) {
      console.error(`  Error fetching direct-hit video stats: ${err.message}`);
    }
  }
  for (const v of directHitsFiltered) {
    v.views = videoViewsMap.get(v.videoId) || 0;
  }
  directHitsFiltered.sort((a, b) => (b.views || 0) - (a.views || 0));

  const directHits = directHitsFiltered.length;
  const topVideo = directHitsFiltered[0] || null;
  const topVideoViews = topVideo ? topVideo.views : 0;

  // Remove the candidate's own channel
  competitorChannelIds.delete(candidate.channelId);

  if (competitorChannelIds.size === 0) {
    const result = {
      totalCompetitors: 0,
      saturationLevel: 'Wide Open',
      directHits: 0,
      directHitLevel: 'Clear',
      topVideoViews: 0,
      topVideo: null,
      verdict: 'GO',
      verdictReason: 'No direct hits in last 30 days — first mover advantage',
      tiers: { over100k: 0, '10k_100k': 0, '1k_10k': 0, under1k: 0 },
      topCompetitors: [],
      directHitVideos: [],
      avgAge: 0,
      windowDays,
      nicheSlug,
      quotaUsed,
      fromCache: false,
    };
    saveCachedCompetition(result, nicheSlug, cacheDir);
    return result;
  }

  // Batch-fetch channel stats
  const channels = [];
  const ids = Array.from(competitorChannelIds);
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) {
    batches.push(ids.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const response = await youtube.channels.list({
        part: 'snippet,statistics',
        id: batch.join(','),
      });
      quotaUsed += 1;

      for (const ch of (response.data.items || [])) {
        const subs = parseInt(ch.statistics.subscriberCount) || 0;
        const views = parseInt(ch.statistics.viewCount) || 0;
        const videoCount = parseInt(ch.statistics.videoCount) || 0;
        const createdAt = new Date(ch.snippet.publishedAt);
        const ageDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);

        channels.push({
          channelId: ch.id,
          title: ch.snippet.title,
          subscribers: subs,
          totalViews: views,
          videoCount,
          ageDays,
          videosInSearch: channelVideoCount.get(ch.id) || 0,
        });
      }

      await setTimeout(50);
    } catch (err) {
      console.error(`  Error fetching competitor stats: ${err.message}`);
    }
  }

  // Calculate tier distribution
  const tiers = {
    over100k: channels.filter(c => c.subscribers >= 100000).length,
    '10k_100k': channels.filter(c => c.subscribers >= 10000 && c.subscribers < 100000).length,
    '1k_10k': channels.filter(c => c.subscribers >= 1000 && c.subscribers < 10000).length,
    under1k: channels.filter(c => c.subscribers < 1000).length,
  };

  // Saturation level
  const total = channels.length;
  let saturationLevel;
  if (total > 200) saturationLevel = 'Saturated';
  else if (total > 50) saturationLevel = 'Crowded';
  else if (total > 15) saturationLevel = 'Moderate';
  else saturationLevel = 'Emerging';

  // Top competitors by subscriber count
  const topCompetitors = channels
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, 5)
    .map(c => ({
      title: c.title,
      subscribers: c.subscribers,
      totalViews: c.totalViews,
      videoCount: c.videoCount,
      ageDays: c.ageDays,
    }));

  // Average competitor age
  const avgAge = channels.length > 0
    ? Math.round(channels.reduce((sum, c) => sum + c.ageDays, 0) / channels.length)
    : 0;

  // SOP direct-hit saturation tier
  let directHitLevel;
  if (directHits === 0) directHitLevel = 'Clear';
  else if (directHits <= 2) directHitLevel = 'Low';
  else if (directHits <= 5) directHitLevel = 'Medium';
  else directHitLevel = 'High';

  // SOP verdict matrix
  const verdictInfo = computeVerdict(directHitLevel, topVideoViews);

  const result = {
    totalCompetitors: total,
    saturationLevel,
    directHits,
    directHitLevel,
    topVideoViews,
    topVideo: topVideo ? {
      title: topVideo.title,
      channelTitle: topVideo.channelTitle,
      views: topVideo.views,
      publishedAt: topVideo.publishedAt,
      videoId: topVideo.videoId,
    } : null,
    verdict: verdictInfo.verdict,
    verdictReason: verdictInfo.reason,
    tiers,
    topCompetitors,
    directHitVideos: directHitsFiltered.slice(0, 5).map(v => ({
      title: v.title,
      channelTitle: v.channelTitle,
      views: v.views || 0,
      publishedAt: v.publishedAt,
      videoId: v.videoId,
    })),
    avgAge,
    windowDays,
    nicheSlug,
    quotaUsed,
    fromCache: false,
  };

  saveCachedCompetition(result, nicheSlug, cacheDir);
  return result;
}

/**
 * SOP verdict matrix — combines direct-hit saturation with top-competitor view demand.
 */
function computeVerdict(directHitLevel, topVideoViews) {
  if (directHitLevel === 'Clear') {
    return { verdict: 'GO', reason: 'No direct hits in last 30 days — first mover advantage' };
  }
  if (directHitLevel === 'Low') {
    if (topVideoViews >= 10000) return { verdict: 'GO', reason: 'Validated demand, low competition' };
    return { verdict: 'CAUTION', reason: 'Low competition but also low demand' };
  }
  if (directHitLevel === 'Medium') {
    if (topVideoViews >= 50000) return { verdict: 'BEND', reason: 'Demand proven — differentiate the angle' };
    return { verdict: 'CAUTION', reason: 'Moderate crowding without strong proof of demand' };
  }
  // High
  return { verdict: 'SKIP', reason: 'Too crowded — bend harder or move on' };
}

/**
 * Generate search queries specific to a candidate's niche.
 */
function generateNicheQueries(candidate) {
  const titles = candidate.videos.map(v => v.title.toLowerCase());

  // Extract meaningful 2-3 word phrases from top video titles
  const topVideos = [...candidate.videos]
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  // Build queries from channel context
  const queries = [];
  const channelWords = candidate.channelTitle.toLowerCase().replace(/[^a-z\s]/g, '').trim();

  // Query 1: Channel title + "documentary" or "explained"
  queries.push(`${channelWords} documentary`);

  // Query 2-3: Extract key subjects from top video titles
  for (const video of topVideos.slice(0, 2)) {
    const cleanTitle = video.title
      .replace(/[^a-zA-Z\s]/g, '')
      .replace(/\b(the|a|an|is|are|was|were|that|this|what|how|why|who|and|but|or|not|just|about|revealed|exposed|hidden|secret|truth)\b/gi, '')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 4)
      .join(' ');

    if (cleanTitle.length > 5) {
      queries.push(cleanTitle);
    }
  }

  // Query 4: Broader niche term
  const nicheTerms = extractNicheTerms(titles);
  if (nicheTerms) {
    queries.push(nicheTerms);
  }

  return queries.filter(q => q.length > 3);
}

/**
 * Extract broad niche terms from video titles.
 */
function extractNicheTerms(titles) {
  const allText = titles.join(' ').toLowerCase();
  const nichePatterns = [
    { keywords: ['dna', 'genetic', 'ancestry', 'genome'], term: 'DNA ancestry history' },
    { keywords: ['space', 'planet', 'galaxy', 'universe'], term: 'space documentary' },
    { keywords: ['ocean', 'deep sea', 'marine', 'underwater'], term: 'ocean documentary' },
    { keywords: ['ancient', 'civilization', 'empire', 'ruins'], term: 'ancient civilization documentary' },
    { keywords: ['food', 'health', 'nutrition', 'diet'], term: 'food health exposed' },
    { keywords: ['disaster', 'earthquake', 'volcano', 'storm'], term: 'natural disaster documentary' },
    { keywords: ['abandoned', 'forgotten', 'lost', 'vanished'], term: 'abandoned places documentary' },
    { keywords: ['home', 'house', 'repair', 'fix', 'diy'], term: 'home improvement hacks' },
    { keywords: ['crime', 'murder', 'case', 'investigation'], term: 'investigation documentary' },
    { keywords: ['war', 'military', 'battle', 'soldier'], term: 'military history documentary' },
  ];

  for (const pattern of nichePatterns) {
    const matches = pattern.keywords.filter(kw => allText.includes(kw)).length;
    if (matches >= 2) return pattern.term;
  }

  return null;
}

/**
 * Build a slug for cache file naming.
 */
function buildNicheSlug(candidate) {
  return candidate.channelTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Load cached competition data if fresh enough.
 */
function loadCachedCompetition(nicheSlug, cacheDir, ttlDays) {
  const filePath = path.join(cacheDir, `${nicheSlug}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const cachedDate = new Date(data.cachedAt);
    const ageMs = Date.now() - cachedDate.getTime();
    const ageDays = ageMs / 86400000;

    if (ageDays > ttlDays) return null;
    // Invalidate pre-SOP cache entries (missing verdict/directHits fields)
    if (typeof data.directHits !== 'number' || !data.verdict) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save competition data to cache.
 */
function saveCachedCompetition(data, nicheSlug, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `${nicheSlug}.json`);
  const toSave = { ...data, cachedAt: new Date().toISOString() };
  delete toSave.quotaUsed;
  delete toSave.fromCache;
  fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf-8');
}

module.exports = { scanCompetition };
