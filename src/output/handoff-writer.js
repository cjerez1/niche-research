// Writes per-channel handoff payloads for the yt-automation bridge.
// Called from index.js after scoring/scanning. The CLI bin/handoff-channel.js
// reads these payloads when triggered from the dashboard "Copy launch command" button.

const fs = require('fs');
const path = require('path');

// Policy A with sample-size floor: min view count across the last 5 most-recent
// uploads, requires at least 3 valid samples to be eligible.
const MIN_VIEWS_WINDOW_VIDEOS = 5;
const MIN_VIEWS_REQUIRED_SAMPLE = 3;

function computeMinViews(c) {
  const nx = c.nexlev || {};
  const raw = c.videos || nx.lastUploadedVideos || [];
  const parsed = raw.map(v => {
    const vid = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (e) { return {}; } })() : v;
    const views = Number(vid.views || vid.video_view_count || 0);
    const date = vid.publishedAt || vid.video_upload_date || vid.date || null;
    const ts = date ? new Date(date).getTime() : 0;
    return { views, ts };
  }).filter(v => v.views > 0);
  parsed.sort((a, b) => b.ts - a.ts);
  const recent = parsed.slice(0, MIN_VIEWS_WINDOW_VIDEOS);
  if (recent.length < MIN_VIEWS_REQUIRED_SAMPLE) {
    return { value: 0, sample: recent.length, eligible: false };
  }
  return { value: Math.min(...recent.map(r => r.views)), sample: recent.length, eligible: true };
}

function isReadyToLaunch(c) {
  const nx = c.nexlev || {};
  const verdict = c.competitionLandscape?.verdict || c.verdict?.verdict || '';
  const ageDays = c.ageDays || nx.daysSinceStart || 0;
  const videoCount = c.videoCount || nx.numOfUploads || 0;
  const minV = computeMinViews(c);
  // Monetization is NOT a gate — early-stage channels often haven't been detected
  // as monetized yet. Status still propagates into the handoff payload.
  return (
    nx.isFaceless === true &&
    (verdict === 'GO' || verdict === 'CAUTION') &&
    minV.eligible && minV.value >= 5000 &&
    ageDays > 0 && ageDays <= 60 &&
    videoCount >= 5
  );
}

function buildPayload(c) {
  const nx = c.nexlev || {};
  const m = c.metrics || {};
  const ageDays = c.ageDays || nx.daysSinceStart || 0;
  const firstUploadDate = ageDays > 0
    ? new Date(Date.now() - ageDays * 86400000).toISOString().split('T')[0]
    : null;
  const topVid = (c.videos || nx.lastUploadedVideos || [])
    .map(v => ({ title: v.title || v.video_title || '', views: v.views || v.video_view_count || 0 }))
    .sort((a, b) => b.views - a.views)[0];

  return {
    channelId: c.channelId,
    title: c.channelTitle || nx.title || '',
    url: c.channelUrl || nx.url || '',
    slug: slugify(c.channelTitle || nx.title || c.channelId),
    niche: (nx.categories && nx.categories[0]) || nx.category || 'general',
    categories: nx.categories || [],
    isFaceless: nx.isFaceless === true,
    avgVideoLengthSec: m.averageDuration || nx.avgVideoLength || 0,
    avgViews: m.averageViews || nx.avgViewPerVideo || 0,
    monthlyViews: nx.avgMonthlyViews || 0,
    monthlyRevenue: nx.avgMonthlyRevenue || 0,
    rpm: nx.rpm || 0,
    subs: c.subscriberCount || nx.subscribers || 0,
    ageDays,
    firstUploadDate,
    videoCount: c.videoCount || nx.numOfUploads || 0,
    uploadsPerWeek: nx.uploadsPerWeek || c.uploadFrequency || 0,
    score: c.score?.totalScore || 0,
    tier: c.score?.tier || '',
    viewTier: c.score?.viewTier || null,
    estimatedMonthlyViews: c.score?.monthlyViews || 0,
    singleSpikeRisk: !!c.score?.singleSpikeRisk,
    verdict: c.competitionLandscape?.verdict || c.verdict?.verdict || '',
    verdictReason: c.competitionLandscape?.verdictReason || '',
    bends: (c.bends || []).slice(0, 3),
    testPlan: c.testPlan || null,
    topPerformer: topVid || null,
    sourceScannedAt: new Date().toISOString()
  };
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function writeHandoffPayloads(approved, outputDir) {
  const ready = approved.filter(isReadyToLaunch);
  fs.mkdirSync(outputDir, { recursive: true });

  // Per-channel payload files
  for (const c of ready) {
    const payload = buildPayload(c);
    const file = path.join(outputDir, `${c.channelId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
  }

  // Index file (list of ready channels for the CLI to enumerate)
  const index = {
    generatedAt: new Date().toISOString(),
    count: ready.length,
    channels: ready.map(c => ({
      channelId: c.channelId,
      title: c.channelTitle || c.nexlev?.title || '',
      score: c.score?.totalScore || 0,
      verdict: c.competitionLandscape?.verdict || c.verdict?.verdict || ''
    }))
  };
  fs.writeFileSync(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  console.log(`Handoff payloads: ${ready.length} ready channels written to ${outputDir}`);
  return ready.length;
}

module.exports = { writeHandoffPayloads, isReadyToLaunch, buildPayload, slugify };
