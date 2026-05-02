const fs = require('fs');
const path = require('path');

function writeIntelligenceExport(approved, rejected, metadata, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    date: metadata.date instanceof Date ? metadata.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    source: 'niche-scanner',
    description: 'Merged and scored opportunities after existing scanner approval/reject logic. Intended for downstream brain/warmup services.',
    counts: {
      approved: approved.length,
      rejected: rejected.length,
      escalated: approved.filter(c => c.escalate?.escalate).length,
    },
    approved: approved.map(serializeCandidate),
    rejected: rejected.map(serializeCandidate),
  };

  const latestPath = path.join(outputDir, 'latest-opportunities.json');
  const datedPath = path.join(outputDir, `${payload.date}-opportunities.json`);
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(latestPath, json, 'utf-8');
  fs.writeFileSync(datedPath, json, 'utf-8');
  console.log(`Intelligence export: ${approved.length} approved candidates written to ${latestPath}`);
  return latestPath;
}

function serializeCandidate(c) {
  const nx = c.nexlev || {};
  const vq = c.vidiq || {};
  return {
    channelId: c.channelId,
    channelTitle: c.channelTitle || nx.title || '',
    channelUrl: c.channelUrl || nx.url || '',
    source: c._source || '',
    score: c.score?.totalScore || 0,
    tier: c.score?.tier || '',
    approved: !c.reject?.reject,
    rejectReasons: c.reject?.reasons || [],
    escalated: c.escalate?.escalate || false,
    escalationReasons: c.escalate?.reasons || [],
    subscribers: c.subscriberCount || nx.subscribers || 0,
    ageDays: c.ageDays || nx.daysSinceStart || 0,
    videoCount: c.videoCount || nx.numOfUploads || 0,
    uploadFrequency: c.uploadFrequency || nx.uploadsPerWeek || 0,
    averageViews: c.metrics?.averageViews || nx.avgViewPerVideo || 0,
    medianViews: c.metrics?.medianViews || 0,
    averageDurationSec: c.metrics?.averageDuration || nx.avgVideoLength || 0,
    nexlev: {
      rpm: nx.rpm || 0,
      avgMonthlyRevenue: nx.avgMonthlyRevenue || 0,
      avgMonthlyViews: nx.avgMonthlyViews || 0,
      outlierScore: nx.outlierScore || 0,
      isMonetized: nx.isMonetized,
      isFaceless: nx.isFaceless,
      categories: nx.categories || [],
    },
    vidiq: {
      outlierScore: vq.outlierScore || 0,
      viewsPerHour: vq.viewsPerHour || 0,
      searchVolume: vq.searchVolume || 0,
      competition: vq.competition || 0,
      trend: vq.trend || '',
      tags: vq.tags || [],
      whyItMatters: vq.whyItMatters || '',
      claudeVerdict: vq.claudeVerdict || null,
    },
    competitionLandscape: c.competitionLandscape || null,
    bends: c.bends || [],
    topVideos: (c.videos || []).slice(0, 5).map(v => ({
      videoId: v.videoId || v.video_id || '',
      title: v.title || v.video_title || '',
      views: v.views || v.video_view_count || 0,
      publishedAt: v.publishedAt || v.video_upload_date || '',
      duration: v.duration || 0,
      outlierScore: v.outlierScore || 0,
      viewsPerHour: v.viewsPerHour || 0,
    })),
  };
}

module.exports = { writeIntelligenceExport };
