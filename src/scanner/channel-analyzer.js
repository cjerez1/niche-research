const { setTimeout } = require('timers/promises');

/**
 * Analyze candidate channels in three passes:
 * Pass 1: Channel metadata (batched, cheap) → hard filter on age/subs/videoCount
 * Pass 2: Upload history (per channel) → upload frequency filter
 * Pass 3: Video metrics (batched) → views/language/engagement filters
 */
async function analyzeChannels(youtube, channelIds, config) {
  const ids = Array.from(channelIds);
  let quotaUsed = 0;

  // === PASS 1: Channel metadata ===
  const channelData = new Map();
  const batches = batchArray(ids, 50);

  for (const batch of batches) {
    try {
      const response = await youtube.channels.list({
        part: 'snippet,statistics',
        id: batch.join(','),
      });
      quotaUsed += 1;

      for (const channel of (response.data.items || [])) {
        const createdAt = new Date(channel.snippet.publishedAt);
        const ageDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
        const subscriberCount = parseInt(channel.statistics.subscriberCount) || 0;
        const videoCount = parseInt(channel.statistics.videoCount) || 0;
        const hiddenSubs = channel.statistics.hiddenSubscriberCount === true;

        // Hard filters
        if (ageDays > config.filters.maxChannelAgeDays) continue;
        if (!hiddenSubs && subscriberCount > config.filters.maxSubscribers) continue;
        if (videoCount < config.filters.minTotalVideos) continue;

        channelData.set(channel.id, {
          channelId: channel.id,
          channelTitle: channel.snippet.title,
          channelUrl: `https://www.youtube.com/channel/${channel.id}`,
          description: channel.snippet.description || '',
          country: channel.snippet.country || 'unknown',
          createdAt,
          ageDays,
          subscriberCount,
          hiddenSubs,
          totalViews: parseInt(channel.statistics.viewCount) || 0,
          videoCount,
          videos: [],
          metrics: {},
          flags: {},
        });
      }

      await setTimeout(100);
    } catch (err) {
      console.error(`Error fetching channel batch: ${err.message}`);
    }
  }

  console.log(`Pass 1: ${channelData.size} channels passed age/subs/videoCount filters (from ${ids.length})`);

  // Cap candidates to avoid quota overrun
  let candidates = Array.from(channelData.values());
  if (candidates.length > config.filters.maxCandidatesForDeepAnalysis) {
    // Prioritize youngest channels with moderate subs
    candidates.sort((a, b) => a.ageDays - b.ageDays);
    candidates = candidates.slice(0, config.filters.maxCandidatesForDeepAnalysis);
    console.log(`Capped to ${config.filters.maxCandidatesForDeepAnalysis} candidates for deep analysis`);
  }

  // === PASS 2: Upload history ===
  const videoIds = [];
  const survivingCandidates = [];

  for (const candidate of candidates) {
    try {
      // Uploads playlist ID = "UU" + channelId minus leading "UC"
      const uploadsPlaylistId = 'UU' + candidate.channelId.substring(2);

      const response = await youtube.playlistItems.list({
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: 50,
      });
      quotaUsed += 1;

      const items = response.data.items || [];
      const publishDates = items.map(item => new Date(item.contentDetails.videoPublishedAt));
      const itemVideoIds = items.map(item => item.contentDetails.videoId);

      // Calculate upload frequency (videos per week in last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentUploads = publishDates.filter(d => d >= thirtyDaysAgo).length;
      const weeksActive = Math.max(1, Math.min(candidate.ageDays, 30) / 7);
      const uploadFrequency = recentUploads / weeksActive;

      if (uploadFrequency < config.filters.minUploadsPerWeek) continue;

      candidate.uploadFrequency = Math.round(uploadFrequency * 10) / 10;
      candidate.recentUploadCount = recentUploads;

      // Check for rebranded channel (first video much newer than channel creation)
      if (publishDates.length > 0) {
        const oldestVideo = new Date(Math.min(...publishDates.map(d => d.getTime())));
        const daysBetween = Math.floor((oldestVideo.getTime() - candidate.createdAt.getTime()) / 86400000);
        candidate.flags.possiblyRebranded = daysBetween > 180;
      }

      videoIds.push(...itemVideoIds);
      candidate._videoIds = itemVideoIds;
      survivingCandidates.push(candidate);

      await setTimeout(50);
    } catch (err) {
      console.error(`Error fetching uploads for ${candidate.channelTitle}: ${err.message}`);
    }
  }

  console.log(`Pass 2: ${survivingCandidates.length} channels passed upload frequency filter`);

  // === PASS 3: Video metrics ===
  const videoDataMap = new Map();
  const videoBatches = batchArray(videoIds, 50);

  for (const batch of videoBatches) {
    try {
      const response = await youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: batch.join(','),
      });
      quotaUsed += 1;

      for (const video of (response.data.items || [])) {
        videoDataMap.set(video.id, {
          videoId: video.id,
          title: video.snippet.title,
          description: video.snippet.description || '',
          tags: video.snippet.tags || [],
          publishedAt: new Date(video.snippet.publishedAt),
          views: parseInt(video.statistics.viewCount) || 0,
          likes: parseInt(video.statistics.likeCount) || 0,
          comments: parseInt(video.statistics.commentCount) || 0,
          duration: parseDuration(video.contentDetails.duration),
          language: video.snippet.defaultAudioLanguage || video.snippet.defaultLanguage || null,
        });
      }

      await setTimeout(100);
    } catch (err) {
      console.error(`Error fetching video batch: ${err.message}`);
    }
  }

  // Assemble final candidates
  const finalCandidates = [];

  for (const candidate of survivingCandidates) {
    const videos = (candidate._videoIds || [])
      .map(id => videoDataMap.get(id))
      .filter(Boolean);

    delete candidate._videoIds;

    if (videos.length === 0) continue;

    candidate.videos = videos;

    // English check
    const englishConfidence = computeEnglishConfidence(videos);
    candidate.flags.englishConfidence = englishConfidence;
    if (englishConfidence < 0.5) continue;

    // Views filter: at least N videos with threshold views
    const videosAboveThreshold = videos.filter(v => v.views >= config.filters.minViewThreshold);
    if (videosAboveThreshold.length < config.filters.minVideosWithViews) continue;

    // Compute metrics
    const viewCounts = videos.map(v => v.views);
    const avgViews = Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length);
    const sortedViews = [...viewCounts].sort((a, b) => a - b);
    const medianViews = sortedViews[Math.floor(sortedViews.length / 2)];
    const maxViews = Math.max(...viewCounts);
    const outlierThreshold = avgViews * 10;
    const outlierCount = viewCounts.filter(v => v > outlierThreshold).length;
    const viewToSubRatio = candidate.subscriberCount > 0
      ? Math.round((avgViews / candidate.subscriberCount) * 100) / 100
      : avgViews; // If subs hidden/0, just use avg views as proxy
    const growthVelocity = candidate.ageDays > 0
      ? Math.round(candidate.subscriberCount / candidate.ageDays)
      : candidate.subscriberCount;
    const avgDuration = Math.round(videos.reduce((a, v) => a + v.duration, 0) / videos.length);

    candidate.metrics = {
      averageViews: avgViews,
      medianViews,
      maxViews,
      outlierCount,
      viewToSubRatio,
      growthVelocity,
      averageDuration: avgDuration,
      videosAboveThreshold: videosAboveThreshold.length,
    };

    // Faceless heuristic
    candidate.flags.possiblyFaceless = computeFacelessScore(candidate);

    finalCandidates.push(candidate);
  }

  console.log(`Pass 3: ${finalCandidates.length} channels passed all filters (${quotaUsed} quota units used)`);

  return { candidates: finalCandidates, quotaUsed };
}

/**
 * Estimate English confidence from video metadata.
 */
function computeEnglishConfidence(videos) {
  let englishSignals = 0;
  let totalSignals = 0;

  for (const video of videos) {
    // Check explicit language tag
    if (video.language) {
      totalSignals++;
      if (video.language.startsWith('en')) englishSignals++;
      else englishSignals -= 0.5;
    }

    // Check title for Latin script dominance
    totalSignals++;
    const latinChars = (video.title.match(/[a-zA-Z]/g) || []).length;
    const totalChars = video.title.replace(/\s/g, '').length || 1;
    if (latinChars / totalChars > 0.7) englishSignals++;
  }

  return totalSignals > 0 ? Math.min(1, englishSignals / totalSignals) : 0.5;
}

/**
 * Heuristic: is this likely a faceless channel?
 */
function computeFacelessScore(candidate) {
  const facelessKeywords = [
    'documentary', 'explained', 'narrated', 'voiceover', 'animation',
    'animated', 'ai generated', 'stock footage', 'history', 'science',
    'facts', 'mystery', 'mysteries', 'exposed', 'warning', 'ancient',
    'abandoned', 'forgotten', 'hidden', 'secret', 'top', 'compilation',
  ];

  const allText = [
    candidate.description,
    ...candidate.videos.map(v => v.title),
    ...candidate.videos.map(v => v.description.substring(0, 200)),
  ].join(' ').toLowerCase();

  const matches = facelessKeywords.filter(kw => allText.includes(kw)).length;
  // If 3+ faceless keywords match, likely faceless
  return matches >= 3;
}

/**
 * Parse ISO 8601 duration (PT#H#M#S) to seconds.
 */
function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || 0) * 3600) +
         (parseInt(match[2] || 0) * 60) +
         parseInt(match[3] || 0);
}

/**
 * Split array into batches of given size.
 */
function batchArray(arr, size) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

module.exports = { analyzeChannels };
