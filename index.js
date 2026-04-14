require('dotenv').config();

const { google } = require('googleapis');
const path = require('path');
const config = require('./config/config');
const searchQueries = require('./data/search-queries.json');
const { searchForVideos, selectQueriesForToday } = require('./src/scanner/youtube-search');
const { analyzeChannels } = require('./src/scanner/channel-analyzer');
const { scoreCandidate } = require('./src/scoring/opportunity-scorer');
const { checkEscalateTriggers, checkRejectTriggers } = require('./src/scoring/auto-triggers');
const { generateReport, writeReport } = require('./src/output/report-generator');
const { loadHistory, compareWithHistory, getDisappeared, saveHistory } = require('./src/tracking/history-tracker');
const { enhanceWithGrowthData } = require('./src/tracking/growth-analyzer');
const { generateBends } = require('./src/bending/niche-bender');
const { sendReportEmail } = require('./src/output/email-sender');
const { scanCompetition } = require('./src/scanner/competition-scanner');

// Competitor mining — optional, depends on data file having real entries
let mineCompetitorAdjacent, applyCompetitorBoost, competitorChannels;
try {
  const competitorMining = require('./src/scanner/competitor-mining');
  mineCompetitorAdjacent = competitorMining.mineCompetitorAdjacent;
  applyCompetitorBoost = competitorMining.applyCompetitorBoost;
  competitorChannels = require('./data/competitor-channels.json')
    .filter(c => c.channelId !== 'REPLACE_WITH_REAL_ID');
} catch (err) {
  competitorChannels = [];
}

async function main() {
  console.log('=== Niche Scanner — Full Pipeline ===');
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log();

  // Validate API key
  if (!config.apiKey || config.apiKey === 'YOUR_API_KEY_HERE') {
    console.error('ERROR: Set YOUTUBE_API_KEY in .env file');
    process.exit(1);
  }

  // Init YouTube API client
  const youtube = google.youtube({
    version: 'v3',
    auth: config.apiKey,
  });

  // === PHASE 4: Load history ===
  const history = loadHistory(config.history.dir);
  if (history.lastUpdated) {
    console.log(`History loaded: ${Object.keys(history.channels).length} channels tracked (last: ${history.lastUpdated})`);
  } else {
    console.log('No history found — first run, all channels will be tagged NEW');
  }

  // === PHASE 1: YouTube search ===
  const todayQueries = selectQueriesForToday(searchQueries, config.quota.maxSearchQueries);
  console.log(`\nRunning ${todayQueries.length} search queries...`);
  console.log(`Queries: ${todayQueries.slice(0, 5).join(', ')}${todayQueries.length > 5 ? '...' : ''}`);

  const searchResults = await searchForVideos(youtube, todayQueries, config);
  let totalQuota = searchResults.quotaUsed;

  // === PHASE 3: Competitor mining (merge into search results) ===
  let boostSignals = new Map();
  if (config.competitors.enabled && competitorChannels.length > 0 && mineCompetitorAdjacent) {
    console.log(`\nMining ${competitorChannels.length} competitor channels...`);
    const competitorResults = await mineCompetitorAdjacent(youtube, competitorChannels, config);
    totalQuota += competitorResults.quotaUsed;
    boostSignals = competitorResults.boostSignals;

    // Merge competitor-adjacent channels into main channel set
    for (const channelId of competitorResults.additionalChannels) {
      searchResults.channelIds.add(channelId);
    }
    console.log(`Merged ${competitorResults.additionalChannels.size} competitor-adjacent channels`);
  }

  if (searchResults.channelIds.size === 0) {
    console.log('No channels found. Check search queries or API key.');
    return;
  }

  // === Channel analysis (3-pass filtering) ===
  console.log(`\nAnalyzing ${searchResults.channelIds.size} unique channels...`);
  const { candidates, quotaUsed: analyzeQuota } = await analyzeChannels(
    youtube,
    searchResults.channelIds,
    config
  );
  totalQuota += analyzeQuota;

  if (candidates.length === 0) {
    console.log('\nNo channels passed all filters. Generating empty report.');
  }

  // === Scoring + triggers ===
  console.log(`\nScoring ${candidates.length} candidates...`);
  const scored = candidates.map(c => {
    const score = scoreCandidate(c, candidates);
    const escalate = checkEscalateTriggers(c, candidates);
    const reject = checkRejectTriggers(c);
    return { ...c, score, escalate, reject };
  });

  // Separate approved from rejected
  const approved = scored
    .filter(c => !c.reject.reject)
    .sort((a, b) => b.score.totalScore - a.score.totalScore);
  const rejected = scored.filter(c => c.reject.reject);

  console.log(`Results: ${approved.length} approved, ${rejected.length} rejected`);

  // === PHASE 4: Compare with history ===
  const historyTags = compareWithHistory(approved, history, config.history.trendThreshold);
  const allApprovedIds = approved.map(c => c.channelId);
  const disappeared = getDisappeared(history, allApprovedIds);

  const newCount = [...historyTags.values()].filter(tags => tags.includes('NEW')).length;
  const trendUpCount = [...historyTags.values()].filter(tags => tags.includes('TRENDING_UP')).length;
  if (newCount > 0) console.log(`NEW channels: ${newCount}`);
  if (trendUpCount > 0) console.log(`TRENDING UP: ${trendUpCount}`);
  if (disappeared.length > 0) console.log(`DISAPPEARED: ${disappeared.length}`);

  // === PHASE 5: Growth analysis ===
  enhanceWithGrowthData(approved, history);

  // === PHASE 2: Niche bending ===
  let bendCount = 0;
  for (const c of approved) {
    if (c.score.totalScore >= config.bending.minScore) {
      c.bends = generateBends(c);
      bendCount += c.bends.length;
    }
  }
  if (bendCount > 0) console.log(`Generated ${bendCount} niche bends for top opportunities`);

  // === Competition landscape (for 60+ candidates) ===
  if (config.competition.enabled) {
    const competitionCandidates = approved.filter(c => c.score.totalScore >= config.competition.minScoreForScan);
    if (competitionCandidates.length > 0) {
      console.log(`\nScanning competition for ${competitionCandidates.length} top candidates...`);
      for (const c of competitionCandidates) {
        try {
          c.competitionLandscape = await scanCompetition(youtube, c, config);
          totalQuota += c.competitionLandscape.quotaUsed;
        } catch (err) {
          console.error(`  Competition scan failed for ${c.channelTitle}: ${err.message}`);
        }
      }
    }
  }

  // === PHASE 3: Apply competitor boost signals ===
  if (boostSignals.size > 0 && applyCompetitorBoost) {
    applyCompetitorBoost(approved, boostSignals);
    const boosted = approved.filter(c => c.competitorSignal).length;
    if (boosted > 0) console.log(`Competitor signals: ${boosted} channels found near competitors`);
  }

  // === Escalation check ===
  const escalatedCount = approved.filter(c => c.escalate.escalate).length;
  if (escalatedCount > 0) {
    console.log(`\nESCALATED: ${escalatedCount} opportunities need immediate attention!`);
  }

  // === Generate and write report ===
  const report = generateReport(approved, rejected, {
    date: new Date(),
    totalChannelsScanned: searchResults.channelIds.size,
    quotaUsed: totalQuota,
    historyTags,
    disappeared,
  });

  const reportPath = writeReport(report, config.output.dir);

  // === PHASE 4: Save history ===
  saveHistory(approved, history, config.history.dir, config.history.maxDays);

  // === Email delivery ===
  try {
    await sendReportEmail(report, config);
  } catch (err) {
    console.error(`Email failed (non-fatal): ${err.message}`);
  }

  // === Summary ===
  console.log('\n=== Scan Complete ===');
  console.log(`Channels scanned: ${searchResults.channelIds.size}`);
  console.log(`Passed filters: ${candidates.length}`);
  console.log(`Approved: ${approved.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log(`Escalated: ${escalatedCount}`);
  console.log(`Niche bends generated: ${bendCount}`);
  console.log(`Top score: ${approved.length > 0 ? approved[0].score.totalScore + '/100' : 'N/A'}`);
  console.log(`Quota used: ~${totalQuota} / ${config.quota.dailyLimit}`);
  console.log(`Report: ${reportPath}`);
}

main().catch(err => {
  console.error('Scanner failed:', err.message);
  process.exit(1);
});
