const fs = require('fs');
const path = require('path');

/**
 * Load historical channel data from disk.
 */
function loadHistory(historyDir) {
  const filePath = path.join(historyDir, 'channels.json');

  if (!fs.existsSync(filePath)) {
    return { lastUpdated: null, channels: {} };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data;
  } catch (err) {
    console.error(`Error loading history: ${err.message}. Starting fresh.`);
    return { lastUpdated: null, channels: {} };
  }
}

/**
 * Compare today's candidates with historical data.
 * Returns a Map of channelId -> array of tags (NEW, TRENDING_UP, TRENDING_DOWN, RETURNING).
 */
function compareWithHistory(candidates, history, trendThreshold = 10) {
  const tags = new Map();

  for (const candidate of candidates) {
    const channelTags = [];
    const histEntry = history.channels[candidate.channelId];

    if (!histEntry || !histEntry.snapshots || histEntry.snapshots.length === 0) {
      channelTags.push('NEW');
    } else {
      const snapshots = histEntry.snapshots;
      const lastSnapshot = snapshots[snapshots.length - 1];
      const todayScore = candidate.score?.totalScore || 0;

      // Check if channel was absent for 2+ days then returned
      if (snapshots.length >= 1) {
        const lastDate = new Date(lastSnapshot.date);
        const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
        if (daysSinceLast >= 2) {
          channelTags.push('RETURNING');
        }
      }

      // Score trend
      const scoreDiff = todayScore - lastSnapshot.score;
      if (scoreDiff >= trendThreshold) {
        channelTags.push('TRENDING_UP');
      } else if (scoreDiff <= -trendThreshold) {
        channelTags.push('TRENDING_DOWN');
      }
    }

    if (channelTags.length > 0) {
      tags.set(candidate.channelId, channelTags);
    }
  }

  return tags;
}

/**
 * Find channels that were in the last scan but are missing today.
 */
function getDisappeared(history, todayChannelIds) {
  if (!history.lastUpdated) return [];

  const disappeared = [];
  const todaySet = new Set(todayChannelIds);

  for (const [channelId, entry] of Object.entries(history.channels)) {
    if (todaySet.has(channelId)) continue;

    const snapshots = entry.snapshots || [];
    if (snapshots.length === 0) continue;

    const lastSnapshot = snapshots[snapshots.length - 1];
    const lastDate = new Date(lastSnapshot.date);
    const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / 86400000);

    // Only flag channels that were seen in the last 2 days
    if (daysSinceLast <= 2) {
      disappeared.push({
        channelId,
        channelTitle: entry.channelTitle,
        lastScore: lastSnapshot.score,
        lastSeen: lastSnapshot.date,
        lastSubscribers: lastSnapshot.subscribers,
      });
    }
  }

  return disappeared;
}

/**
 * Save today's scan data to history. Prunes entries older than maxDays.
 */
function saveHistory(candidates, history, historyDir, maxDays = 30) {
  const today = new Date().toISOString().split('T')[0];

  for (const candidate of candidates) {
    if (!history.channels[candidate.channelId]) {
      history.channels[candidate.channelId] = {
        channelTitle: candidate.channelTitle,
        snapshots: [],
      };
    }

    const entry = history.channels[candidate.channelId];
    entry.channelTitle = candidate.channelTitle;

    // Avoid duplicate entries for same day
    const alreadyHasToday = entry.snapshots.some(s => s.date === today);
    if (!alreadyHasToday) {
      entry.snapshots.push({
        date: today,
        score: candidate.score?.totalScore || 0,
        subscribers: candidate.subscriberCount,
        avgViews: candidate.metrics?.averageViews || 0,
      });
    }

    // Prune old snapshots
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    entry.snapshots = entry.snapshots.filter(s => new Date(s.date) >= cutoff);
  }

  // Prune channels with no remaining snapshots
  for (const [id, entry] of Object.entries(history.channels)) {
    if (entry.snapshots.length === 0) {
      delete history.channels[id];
    }
  }

  history.lastUpdated = today;

  // Write to disk
  fs.mkdirSync(historyDir, { recursive: true });
  const filePath = path.join(historyDir, 'channels.json');
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');

  console.log(`History saved: ${Object.keys(history.channels).length} channels tracked`);
}

module.exports = { loadHistory, compareWithHistory, getDisappeared, saveHistory };
