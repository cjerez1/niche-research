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
const { generateDashboard, writeDashboard, generateEmailHtml, generateEmailSummary } = require('./src/output/dashboard-generator');
const { writeHandoffPayloads } = require('./src/output/handoff-writer');
const { writeIntelligenceExport } = require('./src/output/intelligence-export');
const { loadHistory, compareWithHistory, getDisappeared, saveHistory } = require('./src/tracking/history-tracker');
const { enhanceWithGrowthData } = require('./src/tracking/growth-analyzer');
const { generateBends } = require('./src/bending/niche-bender');
const { sendReportEmail } = require('./src/output/email-sender');
const { scanCompetition } = require('./src/scanner/competition-scanner');
const { loadNexlevCache, normalizeNexlevCandidate, mergeWithYouTubeResults } = require('./src/nexlev/discovery');
const { loadVidiqCache, normalizeVidiqCandidate, mergeCandidates } = require('./src/vidiq/discovery');
const popping = require('./src/output/popping-section');

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
const isNexlevOnlyMode = process.argv.includes('--nexlev-only') || process.argv.includes('--no-youtube');
const isVidiqMode = process.argv.includes('--vidiq') || process.argv.includes('--nexlev');

async function main() {
  console.log('=== Niche Scanner V2 ===');
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`Mode: ${modeLabel()}`);
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
  let vidiqCandidates = [];
  let ytCandidates = [];
  let totalQuota = 0;
  let totalScanned = 0;

  // === NexLev Discovery ===
  if (isNexlevMode || isNexlevOnlyMode) {
    const nexlevCache = loadNexlevCache(config.nexlev?.cacheDir || path.join(__dirname, 'niche-research', 'nexlev-cache'));
    if (nexlevCache) {
      nexlevCandidates = nexlevCache.candidates.map(normalizeNexlevCandidate).filter(c => c.channelId);
      console.log(`NexLev candidates: ${nexlevCandidates.length} channels`);
      totalScanned += nexlevCandidates.length;
    }
  }

  if (isNexlevOnlyMode && nexlevCandidates.length === 0) {
    throw new Error('NexLev-only mode requires a fresh cache with at least one valid channel. Refusing to send an empty report.');
  }

  // === Claude + VidIQ Intelligence ===
  if (isVidiqMode) {
    const vidiqCache = loadVidiqCache(config.vidiq?.cacheDir || path.join(__dirname, 'niche-research', 'vidiq-cache'));
    if (vidiqCache) {
      vidiqCandidates = vidiqCache.rows.map(normalizeVidiqCandidate).filter(Boolean);
      console.log(`VidIQ/Claude candidates: ${vidiqCandidates.length} channels`);
      totalScanned += vidiqCandidates.length;
    }
  }

  // === YouTube API Search (primary in api-only mode, supplementary in nexlev mode) ===
  if (youtube && !isNexlevOnlyMode) {
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
  let allCandidates = mergeCandidates(nexlevCandidates, vidiqCandidates, ytCandidates);
  if (nexlevCandidates.length > 0 && ytCandidates.length > 0 && vidiqCandidates.length === 0) {
    allCandidates = mergeWithYouTubeResults(nexlevCandidates, ytCandidates);
  }
  console.log(`\nMerged: ${allCandidates.length} unique candidates (${nexlevCandidates.length} NexLev + ${vidiqCandidates.length} Claude/VidIQ + ${ytCandidates.length} YouTube API)`);

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
  if (config.competition.enabled && youtube && !isNexlevOnlyMode) {
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

  // === Load today's "popping off" channels (populated by scheduled task) ===
  const poppingDir = path.join(__dirname, 'niche-research', 'popping-channels');
  const poppingData = popping.loadPoppingChannels(poppingDir);
  if (poppingData) {
    console.log(`\nPopping-off longform cohort: ${poppingData.rankedChannels.length} channels (${poppingData.date})`);
  }

  // === Generate markdown report ===
  let report = generateReport(approved, rejected, reportMetadata);
  // Insert legend after the header block (before ESCALATED / TOP OPPORTUNITIES sections)
  report = report.replace('\n---\n\n', `\n---\n${popping.renderLegendMarkdown()}---\n\n`);
  if (poppingData) report += popping.renderMarkdown(poppingData);
  const reportPath = writeReport(report, config.output.dir);

  // === Generate HTML dashboard ===
  let dashboardHtml = generateDashboard(approved, rejected, reportMetadata);
  {
    // Always inject the legend at top of dashboard; popping section at bottom (dashboard isn't clipped).
    const css = `<style>${popping.extraCss}</style>`;
    const legend = popping.renderLegend();
    dashboardHtml = dashboardHtml.replace('</head>', `${css}</head>`);
    // Insert legend right after the </header> tag
    dashboardHtml = dashboardHtml.replace('</header>', `</header>${legend}`);
    if (poppingData) {
      const section = popping.renderHtml(poppingData);
      dashboardHtml = dashboardHtml.replace('</body>', `${section}</body>`);
    }
  }
  const dashboardDir = config.output.dashboardDir || path.join(__dirname, 'niche-research', 'dashboard');
  const dashboardPath = writeDashboard(dashboardHtml, dashboardDir);

  // === Write handoff payloads for "ready to launch" channels ===
  const handoffDir = path.join(__dirname, 'niche-research', 'handoff-queue');
  writeHandoffPayloads(approved, handoffDir);

  // === Write merged machine-readable intelligence for downstream services ===
  const intelligenceDir = path.join(__dirname, 'niche-research', 'intelligence');
  writeIntelligenceExport(approved, rejected, reportMetadata, intelligenceDir);

  // === Save history ===
  saveHistory(approved, history, config.history.dir, config.history.maxDays);

  // === Email delivery: small editorial summary body + full dashboard as attachment ===
  // The body stays under ~30KB (zero risk of Gmail clipping) while the recipient gets the
  // complete filterable dashboard (~600KB) as a clickable HTML attachment that opens in browser.
  try {
    const fs = require('fs');
    const emailSentFlag = process.env.EMAIL_SENT_FLAG || '';
    const emailSentValue = process.env.EMAIL_SENT_VALUE || reportMetadata.date.toISOString().split('T')[0];
    const alreadySent = emailSentFlag && fs.existsSync(emailSentFlag)
      && fs.readFileSync(emailSentFlag, 'utf-8').trim() === emailSentValue;

    if (process.env.SKIP_EMAIL === '1') {
      console.log('Email skipped because SKIP_EMAIL=1');
    } else if (alreadySent) {
      console.log(`Email skipped: report already sent for ${emailSentValue}`);
    } else {
      const summaryHtml = generateEmailSummary(approved, rejected, reportMetadata);
      const dashboardBuffer = fs.readFileSync(dashboardPath);
      const filename = `niche-scanner-${reportMetadata.date.toISOString().split('T')[0]}.html`;
      console.log(`Email summary size: ${summaryHtml.length.toLocaleString()} bytes; attachment: ${dashboardBuffer.length.toLocaleString()} bytes`);
      await sendReportEmail(summaryHtml, config, true, {
        attachments: [{ filename, content: dashboardBuffer }]
      });
      if (emailSentFlag) {
        fs.writeFileSync(emailSentFlag, `${emailSentValue}\n`, 'utf-8');
        console.log(`Email sent flag written: ${emailSentFlag} = ${emailSentValue}`);
      }
    }
  } catch (err) {
    console.error(`Email failed (non-fatal): ${err.message}`);
  }

  // === Summary ===
  console.log('\n=== Scan Complete ===');
  console.log(`Mode: ${modeLabel()}`);
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

function modeLabel() {
  if (isNexlevOnlyMode) return isVidiqMode ? 'NexLev + Claude/VidIQ cache only' : 'NexLev cache only';
  if (isNexlevMode) return 'NexLev + Claude/VidIQ + YouTube API';
  if (isVidiqMode) return 'Claude/VidIQ + YouTube API';
  return 'YouTube API only';
}

main().catch(err => {
  console.error('Scanner failed:', err.message);
  process.exit(1);
});
