const { setTimeout } = require('timers/promises');
const { normalizeNexlevCandidate } = require('../nexlev/discovery');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'into', 'onto', 'over',
  'under', 'after', 'before', 'during', 'about', 'this', 'that', 'these', 'those',
  'what', 'why', 'how', 'when', 'where', 'who', 'your', 'their', 'them', 'they',
  'you', 'are', 'was', 'were', 'will', 'would', 'could', 'should', 'have', 'has',
  'had', 'just', 'than', 'then', 'more', 'most', 'only', 'real', 'life', 'video',
  'documentary', 'explained', 'story', 'stories', 'channel', 'full'
]);

const PACKAGING_WORDS = [
  'why', 'how', 'what', 'truth', 'secret', 'secrets', 'hidden', 'dangerous', 'danger',
  'shocking', 'crazy', 'brutal', 'warning', 'cannot', 'failed', 'collapse', 'destroyed',
  'inside', 'most', 'actually', 'real', 'history', 'vs', 'battle'
];

async function findPoppingOffChannels(youtube, queries, config, options = {}) {
  const settings = config.poppingOff || {};
  const merged = new Map();
  let quotaUsed = 0;
  let nexlevIncluded = false;
  let youtubeIncluded = false;

  if (Array.isArray(options.nexlevRawCandidates) && options.nexlevRawCandidates.length > 0) {
    const nexlevCandidates = options.nexlevRawCandidates
      .map(normalizeNexlevCandidate)
      .filter(candidate => candidate.channelId && passesPoppingOffFilter(candidate, settings))
      .map(candidate => enrichPoppingOffCandidate(candidate, settings, ['NexLev']));

    for (const candidate of nexlevCandidates) {
      merged.set(candidate.channelId, candidate);
    }

    if (nexlevCandidates.length > 0) {
      nexlevIncluded = true;
    }
  }

  if (youtube) {
    const ytDiscovery = await discoverFromYouTube(youtube, queries, settings);
    quotaUsed += ytDiscovery.quotaUsed;
    youtubeIncluded = ytDiscovery.channels.length > 0;

    for (const candidate of ytDiscovery.channels) {
      if (merged.has(candidate.channelId)) {
        merged.set(candidate.channelId, mergePoppingOffCandidate(merged.get(candidate.channelId), candidate));
      } else {
        merged.set(candidate.channelId, candidate);
      }
    }
  }

  const channels = Array.from(merged.values())
    .filter(candidate => passesPoppingOffFilter(candidate, settings))
    .sort(sortByPopularity)
    .slice(0, settings.maxResults || 10)
    .map((candidate, index) => ({
      ...candidate,
      popularityRank: index + 1,
      popularityLabel: buildPopularityLabel(candidate),
    }));

  return {
    channels,
    quotaUsed,
    sources: {
      nexlevIncluded,
      youtubeIncluded,
    },
  };
}

async function discoverFromYouTube(youtube, queries, settings) {
  const channelIds = new Set();
  let quotaUsed = 0;
  const publishedAfter = new Date(Date.now() - (settings.searchWindowDays || 30) * 86400000).toISOString();

  for (const query of queries) {
    try {
      const response = await youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        order: 'viewCount',
        maxResults: settings.maxResultsPerQuery || 25,
        publishedAfter,
        relevanceLanguage: 'en',
        regionCode: 'US',
      });
      quotaUsed += 100;

      for (const item of response.data.items || []) {
        if (item.snippet?.channelId) {
          channelIds.add(item.snippet.channelId);
        }
      }

      await setTimeout(100);
    } catch (err) {
      if (err.code === 403 || err.response?.status === 403) {
        console.error('Quota exceeded during popping-off discovery');
        break;
      }
      console.error(`Popping-off search failed for "${query}": ${err.message}`);
    }
  }

  const candidates = await hydrateYouTubeChannels(youtube, Array.from(channelIds), settings);
  quotaUsed += candidates.quotaUsed;

  return {
    channels: candidates.channels,
    quotaUsed,
  };
}

async function hydrateYouTubeChannels(youtube, channelIds, settings) {
  const channels = [];
  const channelMeta = new Map();
  let quotaUsed = 0;

  for (const batch of batchArray(channelIds, 50)) {
    try {
      const response = await youtube.channels.list({
        part: 'snippet,statistics',
        id: batch.join(','),
      });
      quotaUsed += 1;

      for (const channel of response.data.items || []) {
        const subscriberCount = parseInt(channel.statistics.subscriberCount) || 0;
        const videoCount = parseInt(channel.statistics.videoCount) || 0;

        if (videoCount < (settings.minUploads || 3) || videoCount > (settings.maxUploads || 4)) {
          continue;
        }

        channelMeta.set(channel.id, {
          channelId: channel.id,
          channelTitle: channel.snippet.title,
          channelUrl: `https://www.youtube.com/channel/${channel.id}`,
          subscriberCount,
          hiddenSubs: channel.statistics.hiddenSubscriberCount === true,
          description: channel.snippet.description || '',
          videoCount,
          createdAt: new Date(channel.snippet.publishedAt),
        });
      }

      await setTimeout(50);
    } catch (err) {
      console.error(`Popping-off channel batch failed: ${err.message}`);
    }
  }

  for (const candidate of channelMeta.values()) {
    try {
      const uploadsPlaylistId = 'UU' + candidate.channelId.substring(2);
      const response = await youtube.playlistItems.list({
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: settings.maxUploads || 4,
      });
      quotaUsed += 1;

      const videoIds = (response.data.items || []).map(item => item.contentDetails.videoId).filter(Boolean);
      if (videoIds.length < (settings.minUploads || 3) || videoIds.length > (settings.maxUploads || 4)) {
        continue;
      }

      const videosResponse = await youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoIds.join(','),
      });
      quotaUsed += 1;

      const videos = (videosResponse.data.items || []).map(video => ({
        videoId: video.id,
        title: video.snippet.title,
        publishedAt: new Date(video.snippet.publishedAt),
        views: parseInt(video.statistics.viewCount) || 0,
        duration: parseDuration(video.contentDetails.duration),
      }));

      const normalized = {
        ...candidate,
        ageDays: computeContentAgeDays(videos),
        uploadFrequency: computeUploadsPerWeek(videos),
        videos,
        metrics: buildVideoMetrics(videos, candidate.subscriberCount),
        flags: {
          possiblyFaceless: computeFacelessFlag(candidate, videos),
        },
      };

      if (!passesPoppingOffFilter(normalized, settings)) {
        continue;
      }

      channels.push(enrichPoppingOffCandidate(normalized, settings, ['YouTube API']));
      await setTimeout(50);
    } catch (err) {
      console.error(`Popping-off hydration failed for ${candidate.channelTitle}: ${err.message}`);
    }
  }

  return { channels, quotaUsed };
}

function passesPoppingOffFilter(candidate, settings) {
  const videos = candidate.videos || [];
  const uploadCount = candidate.videoCount || videos.length;
  if (uploadCount < (settings.minUploads || 3) || uploadCount > (settings.maxUploads || 4)) {
    return false;
  }

  if (!videos.length) {
    return false;
  }

  const minLongformSeconds = settings.minLongformSeconds || 8 * 60;
  const longformVideos = videos.filter(video => (video.duration || 0) >= minLongformSeconds).length;
  const longformRatio = longformVideos / videos.length;
  if (longformRatio < (settings.minLongformRatio || 0.75)) {
    return false;
  }

  const totalViews = videos.reduce((sum, video) => sum + (video.views || 0), 0);
  if (totalViews < (settings.minTotalViews || 100000)) {
    return false;
  }

  const ageDays = candidate.ageDays ?? computeContentAgeDays(videos);
  if (ageDays > (settings.maxAgeDays || 90)) {
    return false;
  }

  return true;
}

function enrichPoppingOffCandidate(candidate, settings, sourceParts) {
  const videos = [...(candidate.videos || [])].sort((a, b) => (b.views || 0) - (a.views || 0));
  const totalViews = videos.reduce((sum, video) => sum + (video.views || 0), 0);
  const averageViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
  const averageDuration = videos.length > 0
    ? Math.round(videos.reduce((sum, video) => sum + (video.duration || 0), 0) / videos.length)
    : 0;
  const topVideo = videos[0] || null;
  const topicCluster = extractTopicCluster(videos.map(video => video.title));
  const whyItWorks = buildWhyItWorks(candidate, {
    totalViews,
    averageViews,
    averageDuration,
    topVideo,
    topicCluster,
    settings,
  });

  return {
    channelId: candidate.channelId,
    channelTitle: candidate.channelTitle,
    channelUrl: candidate.channelUrl,
    subscriberCount: candidate.subscriberCount || 0,
    ageDays: candidate.ageDays ?? computeContentAgeDays(videos),
    uploadCount: candidate.videoCount || videos.length,
    totalViews,
    averageViews,
    averageDuration,
    uploadFrequency: candidate.uploadFrequency || computeUploadsPerWeek(videos),
    viewToSubRatio: candidate.subscriberCount > 0 ? +(averageViews / candidate.subscriberCount).toFixed(2) : null,
    source: sourceParts.join(' + '),
    whyItWorks,
    topicCluster,
    topVideo,
    videos,
    nexlev: candidate.nexlev || null,
    flags: candidate.flags || {},
  };
}

function mergePoppingOffCandidate(existing, incoming) {
  const mergedVideos = dedupeVideos([...(existing.videos || []), ...(incoming.videos || [])]);
  const sourceParts = new Set([existing.source, incoming.source].filter(Boolean));
  const merged = {
    ...existing,
    ...incoming,
    videos: mergedVideos,
    source: Array.from(sourceParts).join(' + '),
    nexlev: incoming.nexlev || existing.nexlev || null,
  };

  return enrichPoppingOffCandidate(merged, {}, merged.source.split(' + '));
}

function sortByPopularity(a, b) {
  return (b.totalViews - a.totalViews) ||
    (b.averageViews - a.averageViews) ||
    ((b.topVideo?.views || 0) - (a.topVideo?.views || 0));
}

function buildWhyItWorks(candidate, details) {
  const reasons = [];
  const packagingRate = computePackagingRate(details.topicCluster.tokens, candidate.videos || []);

  if (details.topicCluster.label !== 'Mixed angle') {
    reasons.push(`Clear series angle around ${details.topicCluster.label} instead of random uploads.`);
  }

  if (packagingRate >= 0.5) {
    reasons.push('Titles lean hard into conflict, curiosity, and high-stakes phrasing.');
  }

  if (details.topVideo && details.topVideo.views >= details.averageViews * 1.8) {
    reasons.push(`One breakout video (${formatNumber(details.topVideo.views)} views) is lifting the whole channel while the follow-ups still hold.`);
  } else {
    reasons.push('The views are spread across multiple uploads, which points to a repeatable format rather than a one-off spike.');
  }

  if (details.averageDuration >= (details.settings.minLongformSeconds || 480)) {
    reasons.push(`Runtime is properly longform at ${formatDuration(details.averageDuration)} on average, giving watch-time room.`);
  }

  if (candidate.subscriberCount > 0 && details.averageViews >= candidate.subscriberCount * 5) {
    reasons.push('View velocity is far ahead of the subscriber base, which usually means browse is doing the heavy lifting.');
  }

  if (candidate.uploadFrequency >= 2) {
    reasons.push('Upload pace is fast enough to compound momentum while the topic is hot.');
  }

  return reasons.slice(0, 3);
}

function computePackagingRate(topicTokens, videos) {
  let hits = 0;
  for (const video of videos) {
    const title = (video.title || '').toLowerCase();
    const hasPackagingWord = PACKAGING_WORDS.some(word => title.includes(word));
    const hasTopicToken = topicTokens.some(token => title.includes(token));
    if (hasPackagingWord || hasTopicToken) {
      hits++;
    }
  }
  return videos.length > 0 ? hits / videos.length : 0;
}

function extractTopicCluster(titles) {
  const counts = new Map();

  for (const title of titles) {
    const words = tokenize(title);
    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  const ranked = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([word]) => word);

  return {
    tokens: ranked,
    label: ranked.length > 0 ? ranked.join(' / ') : 'Mixed angle',
  };
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word));
}

function buildVideoMetrics(videos, subscriberCount) {
  const totalViews = videos.reduce((sum, video) => sum + (video.views || 0), 0);
  const averageViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
  const sorted = [...videos].sort((a, b) => (a.views || 0) - (b.views || 0));
  const medianViews = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)].views : 0;
  const maxViews = sorted.length > 0 ? sorted[sorted.length - 1].views : 0;
  const averageDuration = videos.length > 0
    ? Math.round(videos.reduce((sum, video) => sum + (video.duration || 0), 0) / videos.length)
    : 0;

  return {
    averageViews,
    medianViews,
    maxViews,
    averageDuration,
    outlierCount: videos.filter(video => (video.views || 0) >= averageViews * 2).length,
    viewToSubRatio: subscriberCount > 0 ? +(averageViews / subscriberCount).toFixed(2) : 0,
    growthVelocity: 0,
  };
}

function computeContentAgeDays(videos) {
  if (!videos.length) {
    return 999;
  }
  const oldest = Math.min(...videos.map(video => new Date(video.publishedAt).getTime()));
  return Math.max(0, Math.floor((Date.now() - oldest) / 86400000));
}

function computeUploadsPerWeek(videos) {
  if (!videos.length) {
    return 0;
  }
  const ageDays = Math.max(1, computeContentAgeDays(videos));
  return +((videos.length / Math.max(1, ageDays / 7))).toFixed(1);
}

function computeFacelessFlag(candidate, videos) {
  const combined = `${candidate.description || ''} ${videos.map(video => video.title || '').join(' ')}`.toLowerCase();
  return [
    'documentary', 'explained', 'history', 'warning', 'facts', 'analysis', 'archive', 'report',
  ].some(keyword => combined.includes(keyword));
}

function dedupeVideos(videos) {
  const seen = new Map();
  for (const video of videos) {
    if (!video?.videoId) {
      continue;
    }
    const existing = seen.get(video.videoId);
    if (!existing || (video.views || 0) > (existing.views || 0)) {
      seen.set(video.videoId, video);
    }
  }
  return Array.from(seen.values());
}

function buildPopularityLabel(candidate) {
  return `${formatNumber(candidate.totalViews)} total views across ${candidate.uploadCount} uploads`;
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || 0, 10) * 3600) +
    (parseInt(match[2] || 0, 10) * 60) +
    parseInt(match[3] || 0, 10);
}

function batchArray(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function formatNumber(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

module.exports = { findPoppingOffChannels };
