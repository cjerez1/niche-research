const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cachePath = path.join(ROOT, 'niche-research', 'nexlev-cache', 'latest.json');
const outputDir = path.join(ROOT, 'niche-research', 'popping-channels');

function n(value) {
  if (value && typeof value === 'object') return n(value.total ?? value.base);
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function named(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(named).filter(Boolean).slice(0, 3).join(', ');
  if (typeof value === 'object') return value.name || value.title || value.label || '';
  return String(value);
}

function validChannelId(id) {
  return /^UC[\w-]{22}$/.test(String(id || ''));
}

function daysBetween(a, b) {
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 9999;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function videos(c) {
  return (c.lastUploadedVideos || c.recentVideos || c.videos || [])
    .map(v => {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    })
    .filter(Boolean);
}

function topVideo(c) {
  const top = videos(c)
    .slice()
    .sort((a, b) => n(b.video_view_count ?? b.views) - n(a.video_view_count ?? a.views))[0];
  if (!top) return null;
  return {
    title: top.video_title || top.title || '',
    views: n(top.video_view_count ?? top.views),
    url: top.video_id ? `https://www.youtube.com/watch?v=${top.video_id}` : (top.url || ''),
    uploadDate: top.video_upload_date || top.publishedAt || '',
  };
}

function score(c) {
  const s = c.stats || {};
  const avg = n(s.avgViewsPerVideo);
  const outlier = n(c.outlierScore);
  const vals = videos(c).map(v => n(v.video_view_count ?? v.views)).filter(Boolean);
  const consistency = vals.length < 2 ? 0.5 : Math.min(...vals) / Math.max(1, avg);
  return (Math.log10(avg + 1) * 40) + (outlier * 25) + (consistency * 35);
}

function build() {
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8').replace(/^\uFEFF/, ''));
  const today = raw.date || new Date().toISOString().slice(0, 10);
  const asOf = raw.timestamp || `${today}T12:00:00Z`;
  const candidates = raw.candidates || [];

  const matched = candidates
    .filter(c => {
      const s = c.stats || {};
      const subs = n(s.subscribers);
      const uploads = n(s.totalVideos);
      const totalViews = n(s.totalViews);
      const avgLen = n(s.avgVideoLength);
      const lastAge = daysBetween(s.lastVideoDate, asOf);
      return validChannelId(c.ytChannelId || c.channelId)
        && subs >= 0 && subs <= 15000
        && uploads >= 3 && uploads <= 4
        && totalViews >= 100000
        && avgLen >= 480
        && lastAge <= 21;
    })
    .sort((a, b) => score(b) - score(a))
    .slice(0, 10);

  const rankedChannels = matched.map((c, i) => {
    const s = c.stats || {};
    const id = c.ytChannelId || c.channelId;
    const avg = n(s.avgViewsPerVideo);
    const tv = topVideo(c);
    return {
      rank: i + 1,
      title: c.title || '',
      url: `https://www.youtube.com/channel/${id}`,
      niche: named(c.category || c.tags || c.format) || 'general',
      uploads: n(s.totalVideos),
      subscribers: n(s.subscribers),
      totalViews: n(s.totalViews),
      avgViewPerVideo: Math.round(avg),
      avgVideoLengthSec: Math.round(n(s.avgVideoLength)),
      outlierScore: n(c.outlierScore),
      monthlyRevenueUSD: n(s.monthlyRevenue),
      rpm: n(s.rpm),
      daysSinceStart: daysBetween(s.firstVideoDate, asOf),
      topVideo: tv,
      whyWorking: [
        `${Math.round(avg).toLocaleString('en-US')} avg views/video`,
        `${n(s.totalVideos)} uploads`,
        tv ? `top video ${Math.round(tv.views).toLocaleString('en-US')} views` : '',
        `last upload ${daysBetween(s.lastVideoDate, asOf)}d ago`,
      ].filter(Boolean).join('; '),
    };
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${today}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    date: today,
    criteria: 'Longform >=8min, 3-4 uploads, 100K+ views, last upload within 3 weeks, 0-15K subscribers. Raw NexLev channels only; invalid/missing channel IDs excluded.',
    rankedChannels,
    patternSummary: rankedChannels.length > 0
      ? ['Built from the latest local NexLev cache only; no refresh or YouTube API call used.']
      : ['No real cached NexLev channels matched the Popping Off gate today.'],
  }, null, 2), 'utf-8');

  console.log(`Popping list written: ${outputPath} (${rankedChannels.length} channels)`);
}

build();
