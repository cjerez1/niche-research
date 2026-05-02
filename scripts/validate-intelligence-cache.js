const fs = require('fs');
const path = require('path');
const { loadVidiqCache, normalizeVidiqCandidate } = require('../src/vidiq/discovery');

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
const nexlev = JSON.parse(fs.readFileSync('niche-research/nexlev-cache/latest.json', 'utf8').replace(/^\uFEFF/, ''));
if (nexlev.date !== today || !(nexlev.candidates || []).length) {
  throw new Error(`NexLev cache not fresh/usable: date=${nexlev.date} count=${(nexlev.candidates || []).length}`);
}

const vidiq = loadVidiqCache(path.join(process.cwd(), 'niche-research', 'vidiq-cache'));
if (!vidiq || vidiq.date !== today) {
  throw new Error(`Claude/VidIQ cache not fresh: date=${vidiq?.date || 'missing'}`);
}

const normalized = vidiq.rows.map(normalizeVidiqCandidate).filter(Boolean);
if (normalized.length < 1) {
  throw new Error('Claude/VidIQ cache has no normalizable channel candidates.');
}

console.log(`[validate-intelligence] NexLev ${(nexlev.candidates || []).length}; Claude/VidIQ ${normalized.length}`);
