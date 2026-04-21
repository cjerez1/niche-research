const fs = require('fs');
const path = require('path');

/**
 * Load today's popping-channels JSON (if one exists).
 * The file is produced daily by a scheduled task that calls the NexLev MCP tools.
 * Shape: { date, criteria, rankedChannels: [...], patternSummary: [...] }
 */
function loadPoppingChannels(baseDir) {
  const today = new Date().toISOString().split('T')[0];
  const todayPath = path.join(baseDir, `${today}.json`);
  if (fs.existsSync(todayPath)) {
    try { return JSON.parse(fs.readFileSync(todayPath, 'utf-8')); } catch { /* fall through */ }
  }
  // Fall back to most recent file in the dir (within 2 days)
  if (!fs.existsSync(baseDir)) return null;
  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json')).sort().reverse();
  if (files.length === 0) return null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(baseDir, files[0]), 'utf-8'));
    const fileDate = new Date(data.date);
    const ageDays = (Date.now() - fileDate.getTime()) / 86400000;
    if (ageDays > 2) return null;
    return data;
  } catch { return null; }
}

function fmtNum(n) {
  if (!n && n !== 0) return '';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Markdown section appended to the daily report. */
function renderMarkdown(data) {
  if (!data || !data.rankedChannels?.length) return '';
  let md = `\n---\n\n## POPPING OFF RIGHT NOW — ${data.rankedChannels.length} Longform Channels (${data.date})\n\n`;
  md += `*${data.criteria}*\n\n`;

  for (const c of data.rankedChannels) {
    md += `### #${c.rank}. ${c.title}\n`;
    md += `- **Niche:** ${c.niche}\n`;
    md += `- **Stats:** ${c.uploads} uploads · ${fmtNum(c.subscribers)} subs · ${fmtNum(c.totalViews)} total views · ${fmtNum(c.avgViewPerVideo)} avg/video · outlier ${c.outlierScore} · ~$${Math.round(c.monthlyRevenueUSD || 0)}/mo · RPM $${c.rpm} · ${c.daysSinceStart}d old\n`;
    if (c.topVideo) {
      md += `- **Top video:** "${c.topVideo.title}" — ${fmtNum(c.topVideo.views)} views\n`;
    }
    md += `- **Why working:** ${c.whyWorking}\n`;
    md += `- **Link:** ${c.url}\n\n`;
  }

  if (data.patternSummary?.length) {
    md += `### Pattern Summary\n`;
    for (const p of data.patternSummary) md += `- ${p}\n`;
    md += '\n';
  }
  return md;
}

/** HTML block for dashboard + email. */
function renderHtml(data) {
  if (!data || !data.rankedChannels?.length) return '';
  const cards = data.rankedChannels.map(c => `
    <div class="pop-card">
      <div class="pop-head">
        <span class="pop-rank">#${c.rank}</span>
        <a class="pop-title" href="${esc(c.url)}" target="_blank">${esc(c.title)}</a>
        <span class="pop-niche">${esc(c.niche)}</span>
      </div>
      <div class="pop-stats">
        ${c.uploads} uploads ·
        ${fmtNum(c.subscribers)} subs ·
        <b>${fmtNum(c.totalViews)}</b> total views ·
        <b>${fmtNum(c.avgViewPerVideo)}</b> avg/video ·
        outlier ${c.outlierScore} ·
        $${Math.round(c.monthlyRevenueUSD || 0)}/mo ·
        RPM $${c.rpm} ·
        ${c.daysSinceStart}d old
      </div>
      ${c.topVideo ? `<div class="pop-top">Top: "${esc(c.topVideo.title)}" — ${fmtNum(c.topVideo.views)} views</div>` : ''}
      <div class="pop-why"><b>Why working:</b> ${esc(c.whyWorking)}</div>
    </div>
  `).join('');

  const patterns = (data.patternSummary || []).map(p => `<li>${esc(p)}</li>`).join('');

  return `
    <section class="popping-section">
      <h2>POPPING OFF RIGHT NOW — Top ${data.rankedChannels.length} Longform Channels</h2>
      <p class="pop-criteria">${esc(data.criteria)}</p>
      <div class="pop-grid">${cards}</div>
      ${patterns ? `<div class="pop-patterns"><h3>Pattern Summary</h3><ul>${patterns}</ul></div>` : ''}
    </section>
  `;
}

/** Compact HTML for EMAIL — slimmer per-channel row, no patterns block, truncated why. */
function renderHtmlCompact(data) {
  if (!data || !data.rankedChannels?.length) return '';
  const trimWhy = (s) => {
    if (!s) return '';
    if (s.length <= 160) return s;
    // try to break on sentence end near the limit
    const cut = s.slice(0, 160);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.trim() + '…');
  };

  const rows = data.rankedChannels.map(c => `
    <div class="pop-row">
      <div class="pop-row-head">
        <span class="pop-rank">#${c.rank}</span>
        <a class="pop-title" href="${esc(c.url)}" target="_blank">${esc(c.title)}</a>
        <span class="pop-niche">${esc(c.niche)}</span>
      </div>
      <div class="pop-row-stats">
        <b>${fmtNum(c.avgViewPerVideo)}</b> avg/vid ·
        ${fmtNum(c.totalViews)} total ·
        ${c.uploads} uploads ·
        ${fmtNum(c.subscribers)} subs ·
        outlier ${c.outlierScore} ·
        ${c.daysSinceStart}d old
      </div>
      ${c.topVideo ? `<div class="pop-row-top">Top: "${esc(c.topVideo.title)}" — ${fmtNum(c.topVideo.views)} views</div>` : ''}
      <div class="pop-row-why">${esc(trimWhy(c.whyWorking))}</div>
    </div>
  `).join('');

  return `
    <section class="popping-section popping-compact">
      <h2>🔥 POPPING OFF RIGHT NOW — Top ${data.rankedChannels.length} Longform Channels</h2>
      <p class="pop-criteria">${esc(data.criteria)}</p>
      <div class="pop-list">${rows}</div>
    </section>
  `;
}

/** Inline legend block for email + dashboard — keeps every label self-explanatory. */
function renderLegend() {
  return `
    <section class="legend-block">
      <h3>KEY — what each label means</h3>
      <div class="legend-grid">
        <div><b>Score / Tier</b><span>X/100 opportunity score · Launch ≥80 · Strong ≥60 · Monitor ≥40</span></div>
        <div><b>Verdict</b><span>GO (open lane) · CAUTION (low demand) · BEND (differentiate angle) · SKIP (too crowded)</span></div>
        <div><b>Direct hits (30d)</b><span>Unique videos on same angle. Clear = 0 · Low = 1-2 · Medium = 3-5 · High = 6+</span></div>
        <div><b>Flags</b><span>NEW (first seen) · RETURNING (back after gap) · TRENDING UP (score climbing)</span></div>
        <div><b>Growth</b><span>↑↑↑ accelerating · → steady · ↓ declining (subscriber trajectory)</span></div>
        <div><b>Score vs Verdict</b><span>They can disagree — Score rates the CHANNEL, Verdict rates room in the MARKET.</span></div>
      </div>
    </section>
  `;
}

/** Markdown legend for the .md report. */
function renderLegendMarkdown() {
  return `\n## KEY — what each label means\n\n` +
    `- **Score / Tier** — X/100 opportunity score. Launch ≥80 · Strong ≥60 · Monitor ≥40.\n` +
    `- **Verdict** — GO (open lane) · CAUTION (low demand) · BEND (differentiate angle) · SKIP (too crowded).\n` +
    `- **Direct hits (30d)** — Unique videos on same angle in last 30 days. Clear = 0 · Low = 1-2 · Medium = 3-5 · High = 6+.\n` +
    `- **Flags** — NEW (first seen) · RETURNING (back after absence) · TRENDING UP (score climbing).\n` +
    `- **Growth arrow** — ↑↑↑ accelerating · → steady · ↓ declining (subscriber trajectory).\n` +
    `- **Score vs Verdict** — they can disagree. Score rates the CHANNEL; Verdict rates room in the MARKET.\n\n`;
}

const extraCss = `
.popping-section { margin: 32px 0; padding: 20px; background: linear-gradient(135deg, #1a0f2e 0%, #0f0f1a 100%); border: 1px solid #ff990044; border-radius: 10px; }
.popping-section h2 { color: #ffb347; margin-top: 0; font-size: 20px; }
.pop-criteria { color: #888; font-size: 12px; font-style: italic; margin-bottom: 16px; }
.pop-grid { display: grid; gap: 12px; }
.pop-card { background: #0a0a1a; padding: 12px 14px; border-radius: 6px; border-left: 3px solid #ffb347; }
.pop-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.pop-rank { color: #ffb347; font-weight: 700; font-size: 18px; }
.pop-title { color: #00d4ff; text-decoration: none; font-weight: 700; font-size: 16px; }
.pop-title:hover { text-decoration: underline; }
.pop-niche { color: #888; font-size: 12px; }
.pop-stats { color: #bbb; font-size: 12px; margin-bottom: 4px; }
.pop-stats b { color: #00cc66; }
.pop-top { color: #e0e0e0; font-size: 12px; margin-bottom: 6px; }
.pop-why { color: #ccc; font-size: 13px; line-height: 1.45; }
.pop-patterns { margin-top: 14px; padding-top: 12px; border-top: 1px solid #333; }
.pop-patterns h3 { color: #ffb347; font-size: 14px; margin-bottom: 6px; }
.pop-patterns ul { margin: 0; padding-left: 18px; color: #ccc; font-size: 13px; line-height: 1.5; }

/* Compact email variant */
.popping-compact { margin: 16px 0 20px 0; padding: 14px 16px; }
.pop-list { display: block; }
.pop-row { padding: 8px 0; border-bottom: 1px solid #222; }
.pop-row:last-child { border-bottom: none; }
.pop-row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.pop-row-stats { color: #bbb; font-size: 11px; margin-bottom: 3px; }
.pop-row-stats b { color: #00cc66; }
.pop-row-top { color: #ddd; font-size: 11px; margin-bottom: 3px; }
.pop-row-why { color: #aaa; font-size: 12px; line-height: 1.4; }

/* Legend */
.legend-block { margin: 12px 0 20px 0; padding: 12px 16px; background: #0a0a1a; border: 1px solid #333; border-radius: 8px; }
.legend-block h3 { margin: 0 0 8px 0; color: #00d4ff; font-size: 13px; letter-spacing: 0.5px; }
.legend-grid { display: grid; grid-template-columns: 1fr; gap: 4px; font-size: 12px; color: #ccc; }
.legend-grid > div { display: flex; gap: 10px; align-items: baseline; }
.legend-grid b { color: #ffb347; min-width: 130px; }
.legend-grid span { color: #bbb; }
`;

module.exports = { loadPoppingChannels, renderMarkdown, renderHtml, renderHtmlCompact, renderLegend, renderLegendMarkdown, extraCss };
