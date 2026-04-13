const { setTimeout } = require('timers/promises');

/**
 * Search YouTube for recently published videos matching niche queries.
 * Returns deduplicated video results and unique channel IDs.
 */
async function searchForVideos(youtube, queries, config) {
  const videosMap = new Map(); // videoId -> video data
  const channelQueries = new Map(); // channelId -> Set of queries that found it
  let quotaUsed = 0;

  const publishedAfter = new Date();
  publishedAfter.setDate(publishedAfter.getDate() - config.search.publishedAfterDays);

  for (const query of queries) {
    try {
      const response = await youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        order: config.search.order,
        maxResults: config.search.maxResultsPerQuery,
        publishedAfter: publishedAfter.toISOString(),
        videoDuration: config.search.videoDuration,
        relevanceLanguage: config.search.relevanceLanguage,
        regionCode: config.search.regionCode,
      });

      quotaUsed += 100;

      const items = response.data.items || [];
      for (const item of items) {
        const videoId = item.id.videoId;
        const channelId = item.snippet.channelId;

        if (!videosMap.has(videoId)) {
          videosMap.set(videoId, {
            videoId,
            channelId,
            title: item.snippet.title,
            publishedAt: item.snippet.publishedAt,
            query,
          });
        }

        if (!channelQueries.has(channelId)) {
          channelQueries.set(channelId, new Set());
        }
        channelQueries.get(channelId).add(query);
      }

      // Small delay to avoid rate limiting
      await setTimeout(100);
    } catch (err) {
      if (err.code === 403 || err.response?.status === 403) {
        console.error(`Quota exceeded during query "${query}". Stopping search phase.`);
        break;
      }
      console.error(`Error searching for "${query}": ${err.message}. Skipping.`);
    }
  }

  const channelIds = new Set(channelQueries.keys());

  console.log(`Search complete: ${videosMap.size} unique videos from ${channelIds.size} channels (${quotaUsed} quota units used)`);

  return {
    videos: Array.from(videosMap.values()),
    channelIds,
    channelQueries, // which queries found each channel — useful signal
    quotaUsed,
  };
}

/**
 * Select which queries to run today based on date rotation.
 * If maxQueries < total queries, rotates through the list daily.
 */
function selectQueriesForToday(allQueries, maxQueries) {
  if (maxQueries >= allQueries.length) return allQueries;

  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const start = dayOfYear % allQueries.length;
  const selected = [];

  for (let i = 0; i < maxQueries; i++) {
    selected.push(allQueries[(start + i) % allQueries.length]);
  }

  return selected;
}

module.exports = { searchForVideos, selectQueriesForToday };
