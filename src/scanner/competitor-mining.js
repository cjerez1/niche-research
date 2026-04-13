const { setTimeout } = require('timers/promises');

/**
 * Mine YouTube for small/new channels appearing alongside known competitors.
 * Returns additional channel IDs to merge into the main scan, plus boost signals.
 */
async function mineCompetitorAdjacent(youtube, competitors, config) {
  const additionalChannels = new Set();
  const boostSignals = new Map(); // channelId -> { competitorName, niche }
  let quotaUsed = 0;

  const publishedAfter = new Date();
  publishedAfter.setDate(publishedAfter.getDate() - config.search.publishedAfterDays);

  // Limit to configured max competitors
  const activeCompetitors = competitors.slice(0, config.competitors.maxCompetitors);

  for (const competitor of activeCompetitors) {
    // Skip placeholder entries
    if (competitor.channelId === 'REPLACE_WITH_REAL_ID') continue;

    // Extract search terms from competitor's niche description
    const searchTerms = generateCompetitorSearchTerms(competitor.niche);

    for (const term of searchTerms.slice(0, config.competitors.searchesPerCompetitor)) {
      try {
        const response = await youtube.search.list({
          part: 'snippet',
          q: term,
          type: 'video',
          order: 'viewCount',
          maxResults: 30,
          publishedAfter: publishedAfter.toISOString(),
          videoDuration: 'medium',
          relevanceLanguage: 'en',
          regionCode: 'US',
        });
        quotaUsed += 100;

        for (const item of (response.data.items || [])) {
          const channelId = item.snippet.channelId;
          // Skip the competitor channel itself
          if (channelId === competitor.channelId) continue;

          additionalChannels.add(channelId);

          if (!boostSignals.has(channelId)) {
            boostSignals.set(channelId, {
              competitorName: competitor.name,
              niche: competitor.niche,
              reason: `Found in same search results as "${competitor.name}" for "${term}"`,
            });
          }
        }

        await setTimeout(100);
      } catch (err) {
        if (err.code === 403 || err.response?.status === 403) {
          console.error('Quota exceeded during competitor mining. Stopping.');
          return { additionalChannels, boostSignals, quotaUsed };
        }
        console.error(`Error mining competitor "${competitor.name}": ${err.message}`);
      }
    }
  }

  console.log(`Competitor mining: found ${additionalChannels.size} adjacent channels from ${activeCompetitors.length} competitors (${quotaUsed} quota units)`);

  return { additionalChannels, boostSignals, quotaUsed };
}

/**
 * Generate search terms from a competitor's niche description.
 */
function generateCompetitorSearchTerms(niche) {
  const terms = [];
  const words = niche.toLowerCase().split(/\s+/);

  // Use the full niche phrase
  terms.push(niche);

  // Add variations
  if (words.length >= 2) {
    terms.push(`${words[0]} ${words[1]} explained`);
    terms.push(`the truth about ${words[0]}`);
  }

  return terms;
}

/**
 * Apply competitor boost signals to scored candidates.
 */
function applyCompetitorBoost(candidates, boostSignals) {
  for (const candidate of candidates) {
    const signal = boostSignals.get(candidate.channelId);
    if (signal) {
      candidate.competitorSignal = signal;
    }
  }
}

module.exports = { mineCompetitorAdjacent, applyCompetitorBoost };
