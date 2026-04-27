#!/usr/bin/env node
/**
 * Handoff a scanner-approved channel into yt-automation.
 *
 * Usage:   node bin/handoff-channel.js <channelId>
 * Example: node bin/handoff-channel.js UCmNd9YwJEGzc0CQZSVe2oWg
 *
 * Reads the payload from niche-research/handoff-queue/<channelId>.json
 * (written by the daily scanner for every "Ready to launch" channel).
 *
 * Steps:
 *   1. Render strategy/channels/<slug>.md into yt-automation
 *   2. POST /api/channels to register the channel (returns DB id)
 *   3. POST /api/ideation/run-async to queue topic generation
 *
 * If yt-automation is not running, step 1 still happens (file write) so
 * Claudio can register manually later.
 */

require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const http = require('http');

const SCANNER_ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(SCANNER_ROOT, 'niche-research', 'handoff-queue');
const YT_AUTOMATION_ROOT = process.env.YT_AUTOMATION_PATH ||
  'C:\\Users\\claud\\OneDrive\\Documents\\yt-automation';
const YT_AUTOMATION_API = process.env.YT_AUTOMATION_API || 'http://localhost:8000';

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

const channelId = process.argv[2];
if (!channelId) die('Usage: node bin/handoff-channel.js <channelId>');

const payloadPath = path.join(QUEUE_DIR, `${channelId}.json`);
if (!fs.existsSync(payloadPath)) {
  die(`No handoff payload at ${payloadPath}.\n` +
      `Either the channel hasn't been scored as "ready to launch" yet, or the daily scan hasn't run.\n` +
      `Run: node index.js --nexlev   (or wait for the next 7pm VM scan)`);
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf-8'));

console.log('=== Channel Handoff ===');
console.log(`Title:     ${payload.title}`);
console.log(`Niche:     ${payload.niche}`);
console.log(`Score:     ${payload.score}/100  (verdict ${payload.verdict})`);
console.log(`Subs:      ${payload.subs.toLocaleString()}`);
console.log(`Avg views: ${payload.avgViews.toLocaleString()}`);
console.log(`Monthly $: $${payload.monthlyRevenue.toLocaleString()}`);
console.log(`RPM:       $${payload.rpm.toFixed(2)}`);
console.log(`Started:   ${payload.firstUploadDate}`);
console.log();

// 1. Write strategy MD
const strategyDir = path.join(YT_AUTOMATION_ROOT, 'strategy', 'channels');
if (!fs.existsSync(strategyDir)) {
  console.warn(`WARNING: ${strategyDir} does not exist. Creating it.`);
  fs.mkdirSync(strategyDir, { recursive: true });
}
const mdPath = path.join(strategyDir, `${payload.slug}.md`);
fs.writeFileSync(mdPath, renderStrategyMd(payload), 'utf-8');
console.log(`✓ Strategy doc written: ${mdPath}`);

// 2 + 3. Hit the yt-automation API if reachable
(async () => {
  const reachable = await isApiReachable(YT_AUTOMATION_API);
  if (!reachable) {
    console.log(`\n⚠ yt-automation API at ${YT_AUTOMATION_API} is not reachable.`);
    console.log(`  Strategy doc is in place. Start the FastAPI server then either:`);
    console.log(`    a) Re-run this command to register + ideate, or`);
    console.log(`    b) Use the yt-automation UI to create the channel from the strategy doc.`);
    return;
  }

  try {
    const channelRes = await postJson(`${YT_AUTOMATION_API}/api/channels`, {
      name: payload.title,
      youtube_channel_url: payload.url,
      niche: payload.niche,
      voice_provider: 'elevenlabs',
      voice_model_id: 'eleven_multilingual_v2',
      target_duration_minutes: estimateTargetDuration(payload.avgVideoLengthSec)
    });
    const ytChannelId = channelRes.id;
    console.log(`✓ yt-automation channel created: id=${ytChannelId}`);

    const ideationRes = await postJson(`${YT_AUTOMATION_API}/api/ideation/run-async`, {
      channel_id: ytChannelId,
      max_suggestions: 10,
      use_ai: true,
      sync_strategy_doc: true
    });
    console.log(`✓ Topic ideation queued: job=${ideationRes.job_id || ideationRes.id || '(see UI)'}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Open yt-automation UI`);
    console.log(`  2. Approve topics for channel "${payload.title}"`);
    console.log(`  3. Scripts/voiceover/thumbnails will follow the existing approval queue`);
  } catch (err) {
    console.error(`\n✗ API call failed: ${err.message}`);
    console.error(`  Strategy doc is still in place; register channel manually in yt-automation UI.`);
  }
})();

// ---------- helpers ----------

function estimateTargetDuration(seconds) {
  if (!seconds) return 12;
  const minutes = Math.round(seconds / 60);
  // Clamp to a reasonable production target.
  return Math.max(8, Math.min(20, minutes));
}

function renderStrategyMd(p) {
  const competitorLines = (p.bends || [])
    .map(b => `- ${b.targetNiche || ''} — ${b.whyItWorks || b.description || ''}`)
    .join('\n');

  return `# ${p.title}

**Source:** Niche Scanner handoff · ${new Date().toISOString().split('T')[0]}
**Channel ID:** \`${p.channelId}\`
**URL:** ${p.url}

## Identity

- **Niche:** ${p.niche}
- **Categories:** ${(p.categories || []).join(', ') || '(none)'}
- **Faceless:** ${p.isFaceless ? 'Yes' : 'No'}
- **First upload:** ${p.firstUploadDate || 'unknown'} (${p.ageDays} days old)
- **Format:** AI-narrated long-form (assumed — verify and adjust)

## Source channel snapshot (verified via NexLev)

| Metric | Value |
|---|---|
| Subscribers | ${p.subs.toLocaleString()} |
| Avg views/video | ${p.avgViews.toLocaleString()} |
| Avg video length | ${Math.round(p.avgVideoLengthSec / 60)}m |
| Uploads/week | ${p.uploadsPerWeek} |
| Monthly views | ${p.monthlyViews.toLocaleString()} |
| Monthly revenue | $${p.monthlyRevenue.toLocaleString()} |
| RPM | $${p.rpm.toFixed(2)} |
| Total videos | ${p.videoCount} |
| Opportunity score | ${p.score}/100 (${p.tier}) |
| Saturation verdict | ${p.verdict} — ${p.verdictReason || ''} |

${p.topPerformer ? `## Top performer\n\n- **${p.topPerformer.title}** — ${p.topPerformer.views.toLocaleString()} views\n` : ''}

## Recommended sub-niches (clone with differentiation)

${competitorLines || '- (No bends generated yet — run the scanner with bending enabled)'}

## Production defaults

- **Target video length:** ${estimateTargetDuration(p.avgVideoLengthSec)} minutes
- **Voice provider:** ElevenLabs (model \`eleven_multilingual_v2\`)
- **Voice ID:** TODO — pick a male, age 50+, warm-authoritative US voice; test 3 candidates with a 30-sec sample
- **Cadence:** ${p.uploadsPerWeek >= 3 ? '3/week (Tue/Thu/Sat)' : '2/week (Tue/Fri)'}

## Script prompt (starter — refine in yt-automation UI)

> You are writing a faceless long-form YouTube script for a channel in the **${p.niche}** niche, modeled after **${p.title}**.
>
> Target audience: 45+ US-leaning, looking for clear authoritative explanations.
> Include ElevenLabs emotion tags from start to end. Do NOT include avatar tags or B-roll tags.
> Open with a pattern interrupt + body-signal callout + curiosity gap + authority frame.
> Cite plausible-sounding research without fabricating quotes.

## Kill criteria

| Checkpoint | Threshold | Action if missed |
|---|---|---|
| Video 6 (week 3) | Median views ≥ 2,000 | Pause uploads, reassess title/thumbnail |
| Video 10 (week 5) | Subs growth ≥ 100/week | Kill or pivot vertical |
| Video 15 (week 7) | Total views ≥ 50,000 | Kill |
| Month 3 | Median views ≥ 5,000 | Format clone failing — niche-bend axes need review |

<!-- SYSTEM_SYNC_START -->
<!-- This block is rewritten by yt-automation. Do not edit by hand. -->
<!-- SYSTEM_SYNC_END -->
`;
}

function isApiReachable(baseUrl) {
  return new Promise(resolve => {
    const url = new URL(baseUrl);
    const req = http.get({
      host: url.hostname,
      port: url.port || 80,
      path: '/api/channels',
      timeout: 1500
    }, res => { resolve(res.statusCode < 500); res.resume(); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      host: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(chunks)); } catch (e) { resolve({}); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${chunks.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}
