// Standalone dashboard renderer for verification.
// No email, no git, no API calls — just renders today's NexLev cache through
// the scorer and writes the dashboard to a test path.
require('dotenv').config({ override: true });

const path = require('path');
const config = require('./config/config');
const { scoreCandidate } = require('./src/scoring/opportunity-scorer');
const { checkEscalateTriggers, checkRejectTriggers } = require('./src/scoring/auto-triggers');
const { generateDashboard, writeDashboard, generateEmailHtml } = require('./src/output/dashboard-generator');
const { writeHandoffPayloads } = require('./src/output/handoff-writer');
const { loadNexlevCache, normalizeNexlevCandidate } = require('./src/nexlev/discovery');
const popping = require('./src/output/popping-section');

// Bypass staleness check — read raw for testing
const fs = require('fs');
const cachePath = path.join(__dirname, 'niche-research', 'nexlev-cache', 'latest.json');
let content = fs.readFileSync(cachePath, 'utf-8');
if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
const cache = JSON.parse(content);

const normalized = cache.candidates.map(normalizeNexlevCandidate).filter(c => c.channelId);
console.log(`Loaded ${normalized.length} candidates from cache.`);

const scored = normalized.map(c => {
  const score = scoreCandidate(c, normalized);
  const escalate = checkEscalateTriggers(c, normalized);
  const reject = checkRejectTriggers(c);
  return { ...c, score, escalate, reject };
});

const approved = scored.filter(c => !c.reject.reject).sort((a, b) => b.score.totalScore - a.score.totalScore);
const rejected = scored.filter(c => c.reject.reject);

console.log(`Approved: ${approved.length}, Rejected: ${rejected.length}`);

const metadata = {
  date: new Date(),
  totalChannelsScanned: normalized.length,
  quotaUsed: 0,
  historyTags: new Map(),
  disappeared: [],
};

let html = generateDashboard(approved, rejected, metadata);

// Mirror index.js injections (legend + popping)
const poppingDir = path.join(__dirname, 'niche-research', 'popping-channels');
const poppingData = popping.loadPoppingChannels(poppingDir);
const css = `<style>${popping.extraCss}</style>`;
const legend = popping.renderLegend();
html = html.replace('</head>', `${css}</head>`);
// Inject legend after the doc-header for the editorial layout
html = html.replace('</header>', `</header>${legend}`);
if (poppingData) {
  const section = popping.renderHtml(poppingData);
  html = html.replace('</body>', `${section}</body>`);
}

const outputDir = path.join(__dirname, 'niche-research', 'dashboard-test');
const out = writeDashboard(html, outputDir);
writeHandoffPayloads(approved, path.join(__dirname, 'niche-research', 'handoff-queue'));
console.log(`HTML size: ${html.length.toLocaleString()} bytes`);
console.log(`Wrote: ${out}`);

// Also verify email HTML still produces output (regression check)
const emailHtml = generateEmailHtml(approved, rejected, metadata);
console.log(`Email HTML size: ${emailHtml.length.toLocaleString()} bytes (Gmail limit ~102,400)`);
