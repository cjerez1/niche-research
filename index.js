require('dotenv').config({ override: true });

const { google } = require('googleapis');
const path = require('path');
const config = require('./config/config');
const searchQueries = require('./data/search-queries.json');
const { searchForVideos, selectQueriesForToday } = require('./src/scanner/youtube-search');
const { analyzeChannels } = require('./src/scanner/channel-analyzer');
const { scoreCandidate } = require('./src/scoring/opportunity-scorer');
const { checkEscalateTriggers, checkRejectTriggers } = require('./src/scoring/auto-triggers');
const { generateReport, writeReport } = require('./src/output/report-generator');
const { generateDashboard, writeDashboard, generateEmailHtml } = require('./src/output/dashboard-generator');
const { loadHistory, compareWithHistory, getDisappeared, saveHistory } = require('./src/tracking/history-tracker');
const { enhanceWithGrowthData } = require('./src/tracking/growth-analyzer');
const { generateBends } = require('./src/bending/niche-bender');
const { sendReportEmail } = require('./src/output/email-sender');
const { scanCompetition } = require('./src/scanner/competition-scanner');
const { loadNexlevCache, normalizeNexlevCandidate, mergeWithYouTubeResults } = require('./src/nexlev/discovery');

// Competitor mining — optional
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

const isNexlevMode = process.argv.includes('--nexlev');

async function main() {
  console.log('=== Niche Scanner V2 ===');
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`Mode: ${isNexlevMode ? 'NexLev + YouTube API' : 'YouTube API only'}`);
  console.log();

  // Init YouTube API client (needed for both modes)
  const youtube = config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE'
    ? google.youtube({ version: 'v3', auth: config.apiKey })
    : null;

  // === Load history ===
  const history = loadHistory(config.history.dir);
  if (history.lastUpdated) {
    console.log(`History loaded: ${Object.keys(history.channels).length} channels tracked (last: ${history.lastUpdated})`);
  } else {
    console.log('No history found — first run');
  }

  let nexlevCandidates = [];
  let ytCandidates = [];
  let totalQuota = 0;
  let totalScanned = 0;

  // === NexLev Discovery ===
  if (isNexlevMode) {
    const nexlevCache = loadNexlevCache(config.nexlev?.cacheDir || path.join(__dirname, 'niche-research', 'nexlev-cache'));
    if (nexlevCache) {
      nexlevCandidates = nexlevCache.candidates.map(normalizeNexlevCandidate).filter(c => c.channelId);
      console.log(`NexLev candidates: ${nexlevCandidates.length} channels`);
      totalScanned += nexlevCandidates.length;
    }
  }

  // === YouTube API Search (primary in api-only mode, supplementary in nexlev mode) ===
  if (youtube) {
    const todayQueries = selectQueriesForToday(searchQueries, config.quota.maxSearchQueries);
    console.log(`\nRunning ${todayQueries.length} YouTube API search queries...`);

    const searchResults = await searchForVideos(youtube, todayQueries, config);
    totalQuota = searchResults.quotaUsed;

    // Competitor mining
    let boostSignals = new Map();
    if (config.competitors.enabled && competitorChannels.length > 0 && mineCompetitorAdjacent) {
      console.log(`\nMining ${competitorChannels.length} competitor channels...`);
      const competitorResults = await mineCompetitorAdjacent(youtube, competitorChannels, config);
      totalQuota += competitorResults.quotaUsed;
      boostSignals = competitorResults.boostSignals;
      for (const channelId of competitorResults.additionalChannels) {
        searchResults.channelIds.add(channelId);
      }
      console.log(`Merged ${competitorResults.additionalChannels.size} competitor-adjacent channels`);
    }

    if (searchResults.channelIds.size > 0) {
      console.log(`\nAnalyzing ${searchResults.channelIds.size} YouTube API channels...`);
      const { candidates, quotaUsed: analyzeQuota } = await analyzeChannels(youtube, searchResults.channelIds, config);
      totalQuota += analyzeQuota;
      ytCandidates = candidates;
      totalScanned += searchResults.channelIds.size;
    }

    // Store boost signals for later
    global._boostSignals = boostSignals;
  }

  // === Merge NexLev + YouTube API candidates ===
  let allCandidates;
  if (nexlevCandidates.length > 0 && ytCandidates.length > 0) {
    allCandidates = mergeWithYouTubeResults(nexlevCandidates, ytCandidates);
    console.log(`\nMerged: ${allCandidates.length} unique candidates (${nexlevCandidates.length} NexLev + ${ytCandidates.length} YouTube API)`);
  } else if (nexlevCandidates.length > 0) {
    allCandidates = nexlevCandidates;
  } else {
    allCandidates = ytCandidates;
  }

  if (allCandidates.length === 0) {
    console.log('\nNo candidates found. Generating empty report.');
  }

  // === Scoring + triggers ===
  console.log(`\nScoring ${allCandidates.length} candidates...`);
  const scored = allCandidates.map(c => {
    const score = scoreCandidate(c, allCandidates);
    const escalate = checkEscalateTriggers(c, allCandidates);
    const reject = checkRejectTriggers(c);
    return { ...c, score, escalate, reject };
  });

  const approved = scored
    .filter(c => !c.reject.reject)
    .sort((a, b) => b.score.totalScore - a.score.totalScore);
  const rejected = scored.filter(c => c.reject.reject);

  console.log(`Results: ${approved.length} approved, ${rejected.length} rejected`);

  // === History comparison ===
  const historyTags = compareWithHistory(approved, history, config.history.trendThreshold);
  const allApprovedIds = approved.map(c => c.channelId);
  const disappeared = getDisappeared(history, allApprovedIds);

  // Tag candidates for dashboard display
  for (const c of approved) {
    const tags = historyTags.get(c.channelId) || [];
    if (tags.includes('NEW')) c._historyTag = 'NEW';
    else if (tags.includes('TRENDING_UP')) c._historyTag = 'TRENDING_UP';
    else if (tags.includes('RETURNING')) c._historyTag = 'RETURNING';
  }

  const newCount = [...historyTags.values()].filter(tags => tags.includes('NEW')).length;
  if (newCount > 0) console.log(`NEW channels: ${newCount}`);
  if (disappeared.length > 0) console.log(`DISAPPEARED: ${disappeared.length}`);

  // === Growth analysis ===
  enhanceWithGrowthData(approved, history);

  // === Niche bending (Claude Opus) ===
  let bendCount = 0;
  const bendCandidates = approved.filter(c => c.score.totalScore >= config.bending.minScore);
  if (bendCandidates.length > 0) {
    console.log(`\nGenerating niche bends for ${bendCandidates.length} candidates (Claude Opus)...`);
    for (const c of bendCandidates) {
      try {
        c.bends = await generateBends(c);
        bendCount += c.bends.length;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\n  Bend failed for ${c.channelTitle}: ${err.message}`);
        c.bends = [];
      }
    }
    if (bendCount > 0) console.log(`\nGenerated ${bendCount} niche bends`);
  }

  // === Competition landscape ===
  if (config.competition.enabled && youtube) {
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

  // === Competitor boost signals ===
  const boostSignals = global._boostSignals || new Map();
  if (boostSignals.size > 0 && applyCompetitorBoost) {
    applyCompetitorBoost(approved, boostSignals);
    const boosted = approved.filter(c => c.competitorSignal).length;
    if (boosted > 0) console.log(`Competitor signals: ${boosted} channels found near competitors`);
  }

  // === Escalation ===
  const escalatedCount = approved.filter(c => c.escalate.escalate).length;
  if (escalatedCount > 0) {
    console.log(`\nESCALATED: ${escalatedCount} opportunities need immediate attention!`);
  }

  const reportMetadata = {
    date: new Date(),
    totalChannelsScanned: totalScanned,
    quotaUsed: totalQuota,
    historyTags,
    disappeared,
  };

  // === Generate markdown report ===
  const report = generateReport(approved, rejected, reportMetadata);
  const reportPath = writeReport(report, config.output.dir);

  // === Generate HTML dashboard ===
  const dashboardHtml = generateDashboard(approved, rejected, reportMetadata);
  const dashboardDir = config.output.dashboardDir || path.join(__dirname, 'niche-research', 'dashboard');
  const dashboardPath = writeDashboard(dashboardHtml, dashboardDir);

  // === Save history ===
  saveHistory(approved, history, config.history.dir, config.history.maxDays);

  // === Email delivery (use dashboard HTML) ===
  try {
    const emailHtml = generateEmailHtml(approved, rejected, reportMetadata);
    await sendReportEmail(emailHtml, config, true);
  } catch (err) {
    console.error(`Email failed (non-fatal): ${err.message}`);
  }

  // === Summary ===
  console.log('\n=== Scan Complete ===');
  console.log(`Mode: ${isNexlevMode ? 'NexLev + YouTube API' : 'YouTube API only'}`);
  console.log(`Channels scanned: ${totalScanned}`);
  console.log(`Approved: ${approved.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log(`Escalated: ${escalatedCount}`);
  console.log(`Niche bends: ${bendCount}`);
  console.log(`Top score: ${approved.length > 0 ? approved[0].score.totalScore + '/100' : 'N/A'}`);
  console.log(`Quota used: ~${totalQuota} / ${config.quota.dailyLimit}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Dashboard: ${dashboardPath}`);
}

main().catch(err => {
  console.error('Scanner failed:', err.message);
  process.exit(1);
});
