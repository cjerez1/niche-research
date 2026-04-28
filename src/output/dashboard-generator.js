const fs = require('fs');
const path = require('path');

/**
 * Generate a self-contained HTML dashboard from scored candidates.
 */
function generateDashboard(approved, rejected, metadata) {
  return generateEditorialDashboard(approved, rejected, metadata);
}

function renderCard(c, isEscalated) {
  const score = c.score.totalScore;
  const scoreClass = score >= 80 ? 'score-green' : score >= 60 ? 'score-amber' : 'score-grey';
  const tier = c.score.tier;
  const nx = c.nexlev || {};
  const b = c.score.breakdown;

  // Trend indicator
  let trend = '';
  if (c.growthAnalysis) {
    const accel = c.growthAnalysis.growthAcceleration;
    if (accel === 'accelerating') trend = '<span class="trend trend-up">↑↑↑</span>';
    else if (accel === 'steady') trend = '<span class="trend trend-steady">→</span>';
    else trend = '<span class="trend trend-down">↓</span>';
  }
  const historyTag = c._historyTag || '';
  const tagHtml = historyTag === 'NEW' ? '<span class="tag tag-new">NEW</span>' :
                  historyTag === 'TRENDING_UP' ? '<span class="tag tag-trending-up">TRENDING UP</span>' :
                  historyTag === 'RETURNING' ? '<span class="tag tag-returning">RETURNING</span>' : '';

  // Top videos
  const topVids = (c.videos || c.nexlev?.recentVideos || [])
    .sort((a, b) => (b.views || b.video_view_count || 0) - (a.views || a.video_view_count || 0))
    .slice(0, 3);

  // Competition
  const cl = c.competitionLandscape;
  let compHtml = '';
  if (cl) {
    // Verdict styling (SOP: GO / CAUTION / BEND / SKIP)
    const verdict = cl.verdict || '';
    const verdictClass = verdict === 'GO' ? 'verdict-go' :
                         verdict === 'CAUTION' ? 'verdict-caution' :
                         verdict === 'BEND' ? 'verdict-bend' :
                         verdict === 'SKIP' ? 'verdict-skip' : '';
    const verdictBadge = verdict
      ? `<span class="badge ${verdictClass}">${verdict}</span>`
      : '';

    // When SOP verdict is present, drop the legacy saturationLevel badge (conflicts & confuses).
    // Fall back to the old badge only if no SOP verdict was produced.
    let legacyBadge = '';
    if (!verdict && cl.saturationLevel) {
      const satClass = cl.saturationLevel === 'Emerging' ? 'sat-emerging' :
                       cl.saturationLevel === 'Moderate' ? 'sat-moderate' :
                       cl.saturationLevel === 'Crowded' ? 'sat-crowded' : 'sat-saturated';
      legacyBadge = `<span class="badge ${satClass}">${cl.saturationLevel}</span>`;
    }

    // Direct hits + tier (only when SOP data present)
    const hitsLine = typeof cl.directHits === 'number'
      ? `<span class="comp-detail">${cl.directHits} direct hits (${cl.windowDays || 30}d · ${cl.directHitLevel || ''})</span>`
      : '';

    // Only show "channels in niche" if it meaningfully differs from direct hits
    // (avoid "29 direct hits · 29 competitors" where both numbers are the same).
    let channelsLine = '';
    if (typeof cl.totalCompetitors === 'number') {
      const hits = typeof cl.directHits === 'number' ? cl.directHits : -1;
      const diff = hits >= 0 ? Math.abs(cl.totalCompetitors - hits) / Math.max(hits, 1) : 1;
      if (hits < 0 || diff > 0.2) {
        channelsLine = `<span class="comp-detail">${cl.totalCompetitors} channels in niche</span>`;
      }
    }

    const topVideoLine = cl.topVideo
      ? `<div class="comp-names">Top: ${esc(cl.topVideo.title)} — ${esc(cl.topVideo.channelTitle)} (${fmtNum(cl.topVideo.views)} views)</div>`
      : '';
    const reasonLine = cl.verdictReason
      ? `<div class="comp-names">${esc(cl.verdictReason)}</div>`
      : '';
    compHtml = `
      <div class="comp-row">
        ${verdictBadge}
        ${legacyBadge}
        ${hitsLine}
        ${channelsLine}
      </div>
      ${topVideoLine}
      ${reasonLine}
      ${cl.topCompetitors?.length > 0 ? `<div class="comp-names">${cl.topCompetitors.slice(0, 3).map(tc => `${esc(tc.title)} (${fmtNum(tc.subscribers)})`).join(' · ')}</div>` : ''}
    `;
  }

  // Niche bends
  let bendsHtml = '';
  if (c.bends && c.bends.length > 0) {
    bendsHtml = `
      <details class="bends-section">
        <summary class="bends-toggle">Niche Bends (${c.bends.length})</summary>
        <div class="bends-content">
          ${c.bends.map(bend => `
            <div class="bend-card">
              <div class="bend-header">
                <strong>${esc(bend.description)}</strong>
                <span class="bend-type">${esc(bend.type)}</span>
              </div>
              <div class="bend-target">→ ${esc(bend.targetNiche)}</div>
              <div class="bend-why">${esc(bend.whyItWorks)}</div>
              <div class="bend-titles">
                ${(bend.exampleTitles || []).map(t => `<div class="bend-title">"${esc(t)}"</div>`).join('')}
              </div>
              ${bend.targetChannel ? `<div class="bend-channel">Target: ${esc(bend.targetChannel)}</div>` : ''}
              ${bend.confidence ? `<div class="bend-confidence">Confidence: ${bend.confidence}</div>` : ''}
              <div class="bend-meta">
                <span>RPM: ${esc(bend.rpmEstimate || 'N/A')}</span>
                <span>Competition: ${esc(bend.estimatedCompetition || 'N/A')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </details>
    `;
  }

  // Escalation reasons
  let escalateHtml = '';
  if (isEscalated && c.escalate?.reasons) {
    escalateHtml = `<div class="escalate-reasons">${c.escalate.reasons.map(r => `<div class="escalate-reason">⚡ ${esc(r)}</div>`).join('')}</div>`;
  }

  return `
    <div class="card ${isEscalated ? 'card-escalated' : ''}" data-score="${score}" data-revenue="${nx.avgMonthlyRevenue || 0}" data-views="${c.metrics?.averageViews || nx.avgViewPerVideo || 0}" data-age="${c.ageDays || nx.daysSinceStart || 999}">
      <div class="card-header">
        <div class="card-title-row">
          <a href="${c.channelUrl || nx.url || '#'}" target="_blank" class="card-name">${esc(c.channelTitle || nx.title)}</a>
          <div class="score-badge ${scoreClass}">${score}/100</div>
        </div>
        <div class="card-tier">${tier} ${tagHtml} ${trend}</div>
        ${escalateHtml}
      </div>

      <div class="card-metrics">
        <div class="metric">
          <span class="metric-val">${fmtNum(c.subscriberCount || nx.subscribers)}</span>
          <span class="metric-lbl">Subs</span>
        </div>
        <div class="metric">
          <span class="metric-val">${c.ageDays || nx.daysSinceStart || '?'}d</span>
          <span class="metric-lbl">Age</span>
        </div>
        <div class="metric">
          <span class="metric-val">${fmtNum(c.metrics?.averageViews || nx.avgViewPerVideo || 0)}</span>
          <span class="metric-lbl">Avg Views</span>
        </div>
        <div class="metric">
          <span class="metric-val">${c.uploadFrequency || nx.uploadsPerWeek || '?'}/wk</span>
          <span class="metric-lbl">Uploads</span>
        </div>
      </div>

      <div class="card-data-row">
        ${nx.rpm ? `<span class="data-chip">RPM: $${nx.rpm.toFixed(2)}</span>` : c.score.rpmEstimate ? `<span class="data-chip">RPM: $${c.score.rpmEstimate[0]}-$${c.score.rpmEstimate[1]}</span>` : ''}
        ${nx.avgMonthlyRevenue ? `<span class="data-chip revenue-chip">$${fmtNum(nx.avgMonthlyRevenue)}/mo</span>` : ''}
        ${nx.outlierScore ? `<span class="data-chip outlier-chip">${nx.outlierScore}x outlier</span>` : ''}
        ${nx.isMonetized === true ? '<span class="data-chip monetized-chip">Monetized</span>' : nx.isMonetized === false ? '<span class="data-chip not-monetized-chip">Not Monetized</span>' : ''}
      </div>

      <div class="card-data-row">
        ${nx.isFaceless === true ? `<span class="data-chip faceless-chip">Faceless${nx.facelessConfidence ? ` (${Math.round(nx.facelessConfidence * 100)}%)` : ''}</span>` :
          c.flags?.possiblyFaceless ? '<span class="data-chip faceless-maybe-chip">Likely Faceless</span>' : '<span class="data-chip faceless-unknown-chip">Faceless: ?</span>'}
        ${nx.quality ? `<span class="data-chip quality-chip quality-${nx.quality}">${nx.quality} quality</span>` : ''}
        ${(nx.categories || []).slice(0, 2).map(cat => `<span class="data-chip cat-chip">${esc(cat)}</span>`).join('')}
      </div>

      ${compHtml ? `<div class="card-competition">${compHtml}</div>` : ''}

      <div class="card-score-breakdown">
        <div class="score-bar"><span class="bar-label">Click</span><div class="bar-track"><div class="bar-fill" style="width:${(b.clickPotential / 15 * 100)}%"></div></div><span class="bar-val">${b.clickPotential}/15</span></div>
        <div class="score-bar"><span class="bar-label">Watch</span><div class="bar-track"><div class="bar-fill" style="width:${(b.watchTimePotential / 15 * 100)}%"></div></div><span class="bar-val">${b.watchTimePotential}/15</span></div>
        <div class="score-bar"><span class="bar-label">RPM</span><div class="bar-track"><div class="bar-fill" style="width:${(b.rpmPotential / 10 * 100)}%"></div></div><span class="bar-val">${b.rpmPotential}/10</span></div>
        <div class="score-bar"><span class="bar-label">Comp</span><div class="bar-track"><div class="bar-fill" style="width:${(b.competitionDensity / 10 * 100)}%"></div></div><span class="bar-val">${b.competitionDensity}/10</span></div>
      </div>

      ${topVids.length > 0 ? `
      <div class="card-videos">
        <div class="videos-label">Top Videos</div>
        ${topVids.map(v => `<div class="video-row"><span class="video-title">${esc(v.title || v.video_title || '')}</span><span class="video-views">${fmtNum(v.views || v.video_view_count || 0)}</span></div>`).join('')}
      </div>
      ` : ''}

      ${bendsHtml}

      ${c.flags?.possiblyRebranded ? '<div class="rebranded-warning">⚠ Possibly rebranded channel</div>' : ''}
    </div>
  `;
}

function renderSignal(c) {
  const nx = c.nexlev || {};
  return `
    <div class="signal-row">
      <span class="signal-score">${c.score.totalScore}</span>
      <a href="${c.channelUrl || nx.url || '#'}" target="_blank" class="signal-name">${esc(c.channelTitle || nx.title)}</a>
      <span class="signal-meta">${fmtNum(c.subscriberCount || nx.subscribers)} subs · ${c.ageDays || nx.daysSinceStart}d old · ${fmtNum(c.metrics?.averageViews || nx.avgViewPerVideo || 0)} avg views</span>
    </div>
  `;
}

function getCSS() {
  return `
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background: #0a0a14;
  color: #d0d0d8;
  line-height: 1.5;
  padding: 0;
}

.header {
  background: linear-gradient(135deg, #0f1029 0%, #1a1040 100%);
  padding: 24px 20px;
  border-bottom: 2px solid #00d4ff33;
}
.header-title { display: flex; align-items: baseline; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.header-title h1 { font-size: 22px; color: #00d4ff; letter-spacing: 2px; font-weight: 700; }
.header-date { color: #888; font-size: 14px; }
.header-stats { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-box { background: #12122a; border: 1px solid #222244; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 80px; }
.stat-box.highlight { border-color: #00d4ff55; background: #0a1a30; }
.stat-num { font-size: 22px; font-weight: 700; color: #fff; }
.stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }

.section { padding: 20px; }
.section-title { font-size: 16px; font-weight: 700; letter-spacing: 1px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #222; }
.escalated-title { color: #ff4444; }
.signals-title { color: #ffd93d; }
.disappeared-title { color: #888; }
.rejected-title { color: #666; cursor: pointer; list-style: none; }

.controls { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.sort-btn { background: #1a1a2e; border: 1px solid #333; color: #aaa; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.sort-btn.active { border-color: #00d4ff; color: #00d4ff; }
.sort-btn:hover { border-color: #00d4ff88; }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.card { background: #12122a; border: 1px solid #222244; border-radius: 12px; padding: 16px; transition: border-color 0.2s; }
.card:hover { border-color: #00d4ff44; }
.card-escalated { border-color: #ff444466; background: #1a0a0a; }
.card-escalated:hover { border-color: #ff4444; }

.card-header { margin-bottom: 12px; }
.card-title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.card-name { color: #ffd93d; font-size: 16px; font-weight: 600; text-decoration: none; line-height: 1.3; }
.card-name:hover { color: #ffe566; text-decoration: underline; }
.card-tier { font-size: 12px; color: #888; margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.score-badge { font-size: 20px; font-weight: 800; padding: 4px 10px; border-radius: 8px; min-width: 44px; text-align: center; line-height: 1; }
.score-green { background: #00cc6622; color: #00cc66; border: 1px solid #00cc6644; }
.score-amber { background: #ff990022; color: #ff9900; border: 1px solid #ff990044; }
.score-grey { background: #66666622; color: #999; border: 1px solid #66666644; }

.tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.tag-new { background: #00cc66; color: #000; }
.tag-trending-up { background: #00d4ff; color: #000; }
.tag-returning { background: #9966ff; color: #fff; }

.trend { font-weight: 700; }
.trend-up { color: #00cc66; }
.trend-steady { color: #888; }
.trend-down { color: #ff4444; }

.escalate-reasons { margin-top: 8px; }
.escalate-reason { font-size: 12px; color: #ff9900; padding: 2px 0; }

.card-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.metric { text-align: center; background: #0a0a1a; border-radius: 6px; padding: 8px 4px; }
.metric-val { display: block; font-size: 16px; font-weight: 700; color: #fff; }
.metric-lbl { display: block; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }

.card-data-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.data-chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #1a1a30; border: 1px solid #333; color: #aaa; }
.revenue-chip { border-color: #00cc6644; color: #00cc66; background: #00cc6611; }
.outlier-chip { border-color: #ff990044; color: #ff9900; background: #ff990011; }
.monetized-chip { border-color: #00cc6644; color: #00cc66; }
.not-monetized-chip { border-color: #ff444444; color: #ff6666; }
.faceless-chip { border-color: #00d4ff44; color: #00d4ff; }
.faceless-maybe-chip { border-color: #ffd93d44; color: #ffd93d; }
.faceless-unknown-chip { border-color: #44444444; color: #666; }
.quality-chip { text-transform: capitalize; }
.quality-high { border-color: #00cc6644; color: #00cc66; }
.quality-mid { border-color: #ffd93d44; color: #ffd93d; }
.quality-low { border-color: #ff444444; color: #ff6666; }
.cat-chip { border-color: #9966ff33; color: #9966ff; }

.card-competition { margin: 8px 0; padding: 8px; background: #0a0a1a; border-radius: 6px; }
.comp-row { display: flex; align-items: center; gap: 8px; }
.comp-detail { font-size: 12px; color: #888; }
.comp-names { font-size: 11px; color: #666; margin-top: 4px; }
.badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
.sat-emerging { background: #00cc6622; color: #00cc66; }
.sat-moderate { background: #ffd93d22; color: #ffd93d; }
.sat-crowded { background: #ff990022; color: #ff9900; }
.sat-saturated { background: #ff444422; color: #ff4444; }
.verdict-go { background: #00cc6644; color: #00ff99; }
.verdict-caution { background: #ffd93d44; color: #ffe066; }
.verdict-bend { background: #ff990044; color: #ffb347; }
.verdict-skip { background: #ff444444; color: #ff6b6b; }

.card-score-breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 10px 0; }
.score-bar { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.bar-label { width: 36px; color: #888; text-align: right; }
.bar-track { flex: 1; height: 6px; background: #1a1a2e; border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, #00d4ff, #00cc66); border-radius: 3px; }
.bar-val { width: 36px; color: #666; font-size: 10px; }

.card-videos { margin-top: 10px; }
.videos-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.video-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 12px; border-bottom: 1px solid #1a1a2e; }
.video-title { color: #aaa; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.video-views { color: #00d4ff; font-weight: 600; white-space: nowrap; }

.bends-section { margin-top: 12px; }
.bends-toggle { font-size: 13px; color: #00d4ff; cursor: pointer; padding: 6px 0; list-style: none; }
.bends-toggle::-webkit-details-marker { display: none; }
.bends-toggle::before { content: '▶ '; font-size: 10px; }
details[open] .bends-toggle::before { content: '▼ '; }
.bends-content { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.bend-card { background: #0a0a1a; border: 1px solid #222; border-radius: 8px; padding: 10px; }
.bend-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
.bend-header strong { color: #ffd93d; font-size: 13px; }
.bend-type { font-size: 10px; color: #666; background: #1a1a2e; padding: 2px 6px; border-radius: 3px; }
.bend-target { font-size: 12px; color: #00d4ff; margin-bottom: 4px; }
.bend-why { font-size: 12px; color: #888; margin-bottom: 6px; line-height: 1.4; }
.bend-titles { margin-bottom: 4px; }
.bend-title { font-size: 12px; color: #ccc; padding: 2px 0; }
.bend-channel { font-size: 11px; color: #9966ff; margin-top: 4px; }
.bend-confidence { font-size: 11px; color: #888; }
.bend-meta { display: flex; gap: 12px; font-size: 11px; color: #666; margin-top: 4px; }

.rebranded-warning { font-size: 12px; color: #ff9900; margin-top: 8px; }

.signal-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #12122a; border-radius: 8px; margin-bottom: 6px; }
.signal-score { font-size: 16px; font-weight: 700; color: #666; min-width: 30px; text-align: center; }
.signal-name { color: #ffd93d; text-decoration: none; font-weight: 500; }
.signal-name:hover { text-decoration: underline; }
.signal-meta { font-size: 12px; color: #666; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; padding: 8px 12px; background: #1a1a2e; color: #00d4ff; font-weight: 600; border-bottom: 1px solid #333; }
.data-table td { padding: 6px 12px; border-bottom: 1px solid #1a1a2e; }

.footer { text-align: center; padding: 24px; color: #444; font-size: 12px; }
.empty { color: #666; padding: 20px; text-align: center; }

@media (max-width: 640px) {
  .header { padding: 16px 12px; }
  .header-title h1 { font-size: 18px; }
  .header-stats { gap: 6px; }
  .stat-box { min-width: 60px; padding: 8px 10px; }
  .stat-num { font-size: 18px; }
  .section { padding: 12px; }
  .card-grid { grid-template-columns: 1fr; gap: 12px; }
  .card-metrics { grid-template-columns: repeat(2, 1fr); }
  .card-score-breakdown { grid-template-columns: 1fr; }
  .signal-row { flex-wrap: wrap; }
  .signal-meta { width: 100%; }
}
`;
}

function getJS() {
  return `
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    const key = this.dataset.sort;
    const grid = document.getElementById('opportunities');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.card'));
    cards.sort((a, b) => {
      const aVal = parseFloat(a.dataset[key]) || 0;
      const bVal = parseFloat(b.dataset[key]) || 0;
      return key === 'age' ? aVal - bVal : bVal - aVal;
    });
    cards.forEach(card => grid.appendChild(card));
  });
});
`;
}

function writeDashboard(html, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, 'index.html');
  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`Dashboard saved to: ${filePath}`);
  return filePath;
}

/**
 * Generate email-safe version of the dashboard (no JS, inline-friendly).
 */
function generateEmailHtml(approved, rejected, metadata) {
  const date = metadata.date.toISOString().split('T')[0];
  const allEscalated = approved.filter(c => c.escalate?.escalate);
  const allTop = approved.filter(c => c.score.totalScore >= 40);
  const opportunities60 = approved.filter(c => c.score.totalScore >= 60);
  const disappeared = metadata.disappeared || [];

  // EMAIL CAP: keep well below Gmail's 102KB clip threshold.
  // Each full card is ~3-5KB. Cap to 10 escalated + 20 top = ~120KB max,
  // then rely on header + legend + popping being at the TOP so nothing critical gets clipped.
  const ESCALATED_CAP = 10;
  const TOP_CAP = 20;
  const escalated = allEscalated.slice(0, ESCALATED_CAP).sort((a, b) => b.score.totalScore - a.score.totalScore);
  const top = allTop.slice().sort((a, b) => b.score.totalScore - a.score.totalScore).slice(0, TOP_CAP);
  const escalatedTrimmed = Math.max(0, allEscalated.length - ESCALATED_CAP);
  const topTrimmed = Math.max(0, allTop.length - TOP_CAP);

  // Email version: simplified, no JS, inline styles where needed
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getCSS()}</style></head><body>`;

  html += `<header class="header"><div class="header-title"><h1>NICHE SCANNER</h1><span class="header-date">${formatDate(date)}</span></div>`;
  html += `<div class="header-stats">`;
  html += `<div class="stat-box"><div class="stat-num">${metadata.totalChannelsScanned || 0}</div><div class="stat-label">Scanned</div></div>`;
  html += `<div class="stat-box highlight"><div class="stat-num">${opportunities60.length}</div><div class="stat-label">Score 60+</div></div>`;
  html += `<div class="stat-box"><div class="stat-num">${escalated.length}</div><div class="stat-label">Escalated</div></div>`;
  html += `</div></header>`;

  if (escalated.length > 0) {
    html += `<section class="section"><h2 class="section-title escalated-title">ESCALATED${escalatedTrimmed > 0 ? ` — top ${ESCALATED_CAP} of ${allEscalated.length}` : ''}</h2><div class="card-grid">`;
    html += escalated.map(c => renderCard(c, true)).join('');
    if (escalatedTrimmed > 0) {
      html += `<p class="empty">+${escalatedTrimmed} more escalated opportunities — see full dashboard for all.</p>`;
    }
    html += `</div></section>`;
  }

  html += `<section class="section"><h2 class="section-title">TOP OPPORTUNITIES${topTrimmed > 0 ? ` — top ${TOP_CAP} of ${allTop.length}` : ''}</h2><div class="card-grid">`;
  if (top.length > 0) {
    html += top.map(c => renderCard(c, false)).join('');
    if (topTrimmed > 0) {
      html += `<p class="empty">+${topTrimmed} more opportunities scored 40+ — see full dashboard: <code>niche-research/dashboard/index.html</code></p>`;
    }
  } else {
    html += '<p class="empty">No opportunities scoring 40+ found today.</p>';
  }
  html += `</div></section>`;

  if (disappeared.length > 0) {
    html += `<section class="section"><h2 class="section-title disappeared-title">DISAPPEARED</h2>`;
    html += `<table class="data-table"><thead><tr><th>Channel</th><th>Score</th><th>Last Seen</th></tr></thead><tbody>`;
    html += disappeared.map(d => `<tr><td>${esc(d.channelTitle)}</td><td>${d.lastScore}</td><td>${d.lastSeen}</td></tr>`).join('');
    html += `</tbody></table></section>`;
  }

  html += `<footer class="footer">Niche Scanner V2 — ${date}</footer></body></html>`;
  return html;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n) {
  if (n == null) return '?';
  n = Number(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// =============================================================================
// EDITORIAL FILTERABLE DASHBOARD
// Modeled on Wanner Aarts' "Fresh channels, unfair pace" report.
// Self-contained: inline CSS + inline JS, no external deps.
// =============================================================================

function generateEditorialDashboard(approved, rejected, metadata) {
  const date = metadata.date.toISOString().split('T')[0];

  // Bucket the approved candidates into editorial sections.
  const ready = approved.filter(isReadyToLaunch);
  const readyIds = new Set(ready.map(c => c.channelId));
  const escalated = approved.filter(c => c.escalate?.escalate && !readyIds.has(c.channelId));
  const escalatedIds = new Set(escalated.map(c => c.channelId));
  const skip = id => readyIds.has(id) || escalatedIds.has(id);
  const top = approved.filter(c => !skip(c.channelId) && c.score.totalScore >= 40);
  const frontier = approved.filter(c => {
    const age = c.ageDays || c.nexlev?.daysSinceStart || 999;
    return !skip(c.channelId) && age <= 30 && c.score.totalScore >= 25;
  });
  const frontierIds = new Set(frontier.map(c => c.channelId));
  const topMinusFrontier = top.filter(c => !frontierIds.has(c.channelId));
  const signals = approved.filter(c =>
    !skip(c.channelId) &&
    !frontierIds.has(c.channelId) &&
    c.score.totalScore >= 20 &&
    c.score.totalScore < 40
  );
  const disappeared = metadata.disappeared || [];

  const headline = pickHeadline({
    escalated: escalated.length,
    top: top.length,
    frontier: frontier.length,
    signals: signals.length
  });

  const allCards = [...escalated, ...topMinusFrontier, ...frontier, ...signals];
  const tagFreq = topTags(allCards, 14);
  const countries = uniqueCountries(allCards);

  const sections = [];
  if (ready.length > 0) sections.push({
    num: pad(sections.length + 1),
    type: 'ready',
    title: 'Ready to launch',
    accent: 'send to yt-automation',
    description: 'Channels passing the strict launch checklist: faceless · score ≥ 60 · GO/CAUTION verdict · last 5 uploads all ≥ 5K views (≥ 3 sample required) · age ≤ 60 days from first upload (optimal ≤ 30) · ≥ 5 uploads. Monetization shown as a tag, not a gate — early breakouts often haven\'t been detected yet. Click "Copy launch command" on a card to push it to yt-automation.',
    chips: ['FACELESS', 'SCORE ≥ 60', 'GO/CAUTION', 'LAST 5 UPLOADS ≥ 5K', 'AGE ≤ 60D', '≥ 5 UPLOADS'],
    cards: ready,
    isEscalated: false,
    isReady: true
  });
  if (escalated.length > 0) sections.push({
    num: pad(sections.length + 1),
    type: 'escalated',
    title: 'Escalated',
    accent: 'immediate attention',
    description: 'Channels triggering automatic escalation but not yet meeting all launch conditions: viral velocity, revenue threshold breach, or multi-strong outliers in the last 30 days.',
    chips: ['ESCALATION TRIGGER', 'SCORE ≥ 60', 'AUTO-FLAGGED'],
    cards: escalated,
    isEscalated: true,
    isReady: false
  });
  if (frontier.length > 0) sections.push({
    num: pad(sections.length + 1),
    type: 'frontier',
    title: 'Frontier under',
    accent: '30 days',
    description: 'Channels under 30 days old already showing real signals — first-mover lane. These are the urgent clone candidates.',
    chips: ['AGE ≤ 30 DAYS', 'SCORE ≥ 25', 'EARLY MOMENTUM'],
    cards: frontier,
    isEscalated: false
  });
  if (topMinusFrontier.length > 0) sections.push({
    num: pad(sections.length + 1),
    type: 'top',
    title: 'Top opportunities',
    accent: 'replicable now',
    description: 'Score 40+ candidates after escalation and frontier removed. Sorted by composite opportunity score.',
    chips: ['SCORE ≥ 40', 'MONETIZATION VERIFIED', 'FILTERS PASSED'],
    cards: topMinusFrontier,
    isEscalated: false
  });
  if (signals.length > 0) sections.push({
    num: pad(sections.length + 1),
    type: 'signals',
    title: 'Signals to watch',
    accent: 'next scan',
    description: 'Score 20–39. Not actionable today, but worth a second look on the next scan if signals strengthen.',
    chips: ['SCORE 20–39', 'WATCHLIST'],
    cards: signals,
    isEscalated: false
  });

  const sectionsHtml = sections.map(s => renderEditorialSection(s)).join('\n');

  const disappearedHtml = disappeared.length > 0 ? `
  <section class="section" data-section="disappeared">
    <div class="section-title-row">
      <span class="section-num">§ ${pad(sections.length + 1)}</span>
      <h2 class="section-title">Disappeared <span class="accent">channels</span></h2>
      <span class="section-count">${disappeared.length} channels</span>
    </div>
    <p class="section-desc">Channels previously tracked that have stopped uploading or fallen out of qualifying metrics.</p>
    <table class="data-table">
      <thead><tr><th>Channel</th><th>Last score</th><th>Last subs</th><th>Last seen</th></tr></thead>
      <tbody>
        ${disappeared.map(d => `<tr><td>${esc(d.channelTitle)}</td><td>${d.lastScore}/100</td><td>${fmtNum(d.lastSubscribers)}</td><td>${esc(d.lastSeen)}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>` : '';

  const rejectedHtml = rejected.length > 0 ? `
  <section class="section" data-section="rejected">
    <details>
      <summary class="section-title-row" style="cursor:pointer;">
        <span class="section-num">§ ${pad(sections.length + (disappeared.length > 0 ? 2 : 1))}</span>
        <h2 class="section-title">Rejected <span class="accent">today</span></h2>
        <span class="section-count">${rejected.length} channels</span>
      </summary>
      <p class="section-desc" style="margin-top:16px;">Channels that surfaced today but failed filters. Expand to audit the rejection reasons.</p>
      <table class="data-table">
        <thead><tr><th>Channel</th><th>Reason</th></tr></thead>
        <tbody>
          ${rejected.slice(0, 200).map(c => `<tr><td>${esc(c.channelTitle)}</td><td>${esc((c.reject?.reasons || []).join('; '))}</td></tr>`).join('')}
        </tbody>
      </table>
    </details>
  </section>` : '';

  // Per-section data for JS to recompute summary cards.
  const sectionMeta = sections.map(s => ({
    num: s.num,
    count: s.cards.length
  }));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Niche Scanner — ${formatDateShort(date)}</title>
<style>
${getEditorialCSS()}
</style>
</head>
<body>
<div class="container">

  <header class="doc-header">
    <h1>${headline}</h1>
    <div class="doc-meta">
      Prepared for <strong>Claudio Jerez</strong><br>
      Power Media Holdings B.V.<br>
      Report · ${formatDateShort(date)}
    </div>
  </header>

  <div class="ribbon">
    <div class="ribbon-stat"><span class="ribbon-num">${approved.length}</span><span class="ribbon-lbl">approved</span></div>
    <div class="ribbon-stat"><span class="ribbon-num">${escalated.length}</span><span class="ribbon-lbl">escalated</span></div>
    <div class="ribbon-stat"><span class="ribbon-num">${approved.filter(c => c.score.totalScore >= 60).length}</span><span class="ribbon-lbl">score 60+</span></div>
    <div class="ribbon-stat"><span class="ribbon-num">${metadata.totalChannelsScanned || 0}</span><span class="ribbon-lbl">scanned</span></div>
    <div class="ribbon-stat"><span class="ribbon-num">~${metadata.quotaUsed || 0}</span><span class="ribbon-lbl">api quota</span></div>
  </div>

  <!-- FILTER BAR -->
  <div class="filter-bar collapsed" id="filterBar">
    <div class="fb-row fb-row-1">
      <input type="search" id="f-search" class="fb-search" placeholder="Search channel, handle, tag…" autocomplete="off">
      <select id="f-sort" class="fb-select">
        <option value="score">Sort: Score</option>
        <option value="revenue">Sort: Monthly $</option>
        <option value="views">Sort: Avg views</option>
        <option value="age">Sort: Newest</option>
        <option value="outlier">Sort: Outlier ×</option>
      </select>
      ${countries.length > 1 ? `<select id="f-country" class="fb-select">
        <option value="all">Country: All</option>
        ${countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>` : ''}
      <select id="f-faceless" class="fb-select">
        <option value="all">Faceless: All</option>
        <option value="yes">Faceless: Yes</option>
        <option value="no">Faceless: No</option>
      </select>
      <button class="fb-toggle" id="f-more">More filters ▾</button>
      <button class="fb-reset" id="f-reset">Reset</button>
    </div>

    <div class="fb-row fb-row-2">
      <span class="fb-label">Verdict</span>
      <button class="vchip" data-verdict="GO">GO</button>
      <button class="vchip" data-verdict="CAUTION">CAUTION</button>
      <button class="vchip" data-verdict="BEND">BEND</button>
      <button class="vchip" data-verdict="SKIP">SKIP</button>
      <button class="vchip" data-verdict="NONE">No verdict</button>
    </div>

    ${tagFreq.length > 0 ? `<div class="fb-row fb-row-3 fb-collapsible">
      <span class="fb-label">Tags</span>
      ${tagFreq.map(([t, n]) => `<button class="tchip" data-tag="${esc(t.toLowerCase())}">${esc(t)} <em>${n}</em></button>`).join('')}
    </div>` : ''}

    <div class="fb-row fb-row-4 fb-collapsible">
      <div class="slider">
        <label>Score min <output id="o-score">0</output></label>
        <input type="range" id="f-score" min="0" max="100" step="5" value="0">
      </div>
      <div class="slider">
        <label>Age max <output id="o-age">∞</output></label>
        <input type="range" id="f-age" min="7" max="7500" step="1" value="7500">
      </div>
      <div class="slider">
        <label>Subs max <output id="o-subs">∞</output></label>
        <input type="range" id="f-subs" min="0" max="5000000" step="1000" value="5000000">
      </div>
      <div class="slider">
        <label>Avg views min <output id="o-views">5k</output></label>
        <input type="range" id="f-views" min="0" max="500000" step="500" value="5000">
      </div>
      <div class="slider">
        <label>Min views/video ≥ <output id="o-minviews">0</output></label>
        <input type="range" id="f-minviews" min="0" max="50000" step="500" value="0">
      </div>
      <div class="slider">
        <label>RPM min <output id="o-rpm">$0</output></label>
        <input type="range" id="f-rpm" min="0" max="15" step="0.5" value="0">
      </div>
      <div class="slider">
        <label>Monthly $ min <output id="o-rev">$0</output></label>
        <input type="range" id="f-rev" min="0" max="50000" step="500" value="0">
      </div>
    </div>

    <div class="fb-row fb-row-5">
      <span class="fb-status" id="f-status">Showing all ${allCards.length} of ${allCards.length} channels</span>
    </div>
  </div>

  <!-- LIVE SUMMARY (recomputes as filters change) -->
  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Channels qualifying</div>
      <div class="value" id="sm-count">${allCards.length}</div>
      <div class="caption">passed all filters</div>
    </div>
    <div class="summary-card">
      <div class="label">Combined monthly revenue</div>
      <div class="value accent" id="sm-rev">${formatMoney(sum(allCards, c => c.nexlev?.avgMonthlyRevenue || 0))}</div>
      <div class="caption">est. across cohort</div>
    </div>
    <div class="summary-card">
      <div class="label">Combined monthly views</div>
      <div class="value" id="sm-views">${formatViewsBig(sum(allCards, c => (c.nexlev?.avgMonthlyViews || (c.metrics?.averageViews || c.nexlev?.avgViewPerVideo || 0) * 4 * (c.nexlev?.uploadsPerWeek || c.uploadFrequency || 1))))}</div>
      <div class="caption">aggregate</div>
    </div>
    <div class="summary-card">
      <div class="label">Median channel age</div>
      <div class="value" id="sm-age">${median(allCards.map(c => c.ageDays || c.nexlev?.daysSinceStart || 0))}d</div>
      <div class="caption">since creation</div>
    </div>
  </div>

  ${sectionsHtml}
  ${disappearedHtml}
  ${rejectedHtml}

  <footer class="footer">
    Niche Scanner · ${formatDateShort(date)} · Quota ~${metadata.quotaUsed || 0}/10,000 · Power Media Holdings B.V.
  </footer>
</div>

<script>
window.__SECTIONS__ = ${JSON.stringify(sectionMeta)};
${getEditorialJS()}
</script>
</body>
</html>`;

  return html;
}

function renderEditorialSection(s) {
  return `
  <section class="section${s.isReady ? ' is-ready-section' : ''}" data-section="${s.num}" data-section-type="${s.type || ''}">
    <div class="section-title-row">
      <span class="section-num">§ ${s.num}</span>
      <h2 class="section-title">${esc(s.title)} <span class="accent">${esc(s.accent)}</span></h2>
      <span class="section-count" data-section-count="${s.num}">${s.cards.length} channels</span>
    </div>
    <p class="section-desc">${esc(s.description)}</p>
    <div class="filter-strip">
      ${s.chips.map(c => `<span class="chip active">${esc(c)}</span>`).join('')}
    </div>
    <div class="cards-grid">
      ${s.cards.map(c => renderEditorialCard(c, s.isEscalated, s.isReady)).join('\n')}
    </div>
  </section>`;
}

function renderEditorialCard(c, isEscalated, isReady) {
  const nx = c.nexlev || {};
  const m = c.metrics || {};
  const score = c.score?.totalScore || 0;
  const tier = c.score?.tier || '';

  const channelId = c.channelId || extractChannelId(c.channelUrl || nx.url || '');
  const channelUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : (c.channelUrl || nx.url || '#');
  const handle = extractHandle(c.channelUrl || nx.url || '') || extractHandle(channelUrl);
  const country = c.country || nx.country || '—';
  const ageDays = c.ageDays || nx.daysSinceStart || 0;
  const firstUploadDate = ageDays > 0 ? formatDateShort(new Date(Date.now() - ageDays * 86400000).toISOString().split('T')[0]) : '—';
  const monetization = monetizationStack(nx.categories || [], (c.channelTitle || nx.title || ''));
  const subNiches = (c.bends || []).slice(0, 3);
  const minV = computeMinViews(c);
  const minViews = minV.value;
  const minSampleEligible = minV.eligible;
  const minSample = minV.sample;
  const optimalAge = isOptimalAge(c);
  const subs = c.subscriberCount || nx.subscribers || 0;
  const monthlyRev = nx.avgMonthlyRevenue || 0;
  const rpm = nx.rpm || 0;
  const avgViews = m.averageViews || nx.avgViewPerVideo || 0;
  const monthlyViews = nx.avgMonthlyViews ||
    (avgViews * 4 * (nx.uploadsPerWeek || c.uploadFrequency || 1));
  const avgLength = m.averageDuration || nx.avgVideoLength || 0;
  const uploadsWeek = nx.uploadsPerWeek || c.uploadFrequency || 0;
  const outlier = nx.outlierScore || m.maxViews && m.medianViews ? Math.max(nx.outlierScore || 0, (m.medianViews ? m.maxViews / m.medianViews : 0)) : 0;
  const quality = nx.quality || 'mid';
  const isFaceless = nx.isFaceless === true ? 'yes' : nx.isFaceless === false ? 'no' : (c.flags?.possiblyFaceless ? 'yes' : 'unknown');

  const verdict = c.competitionLandscape?.verdict || c.verdict?.verdict || '';
  const verdictReason = c.competitionLandscape?.verdictReason || c.verdict?.reason || '';

  const tags = (nx.categories || []).slice(0, 3);
  const tagsLower = (nx.categories || []).map(t => t.toLowerCase()).join(' ');

  // Top performer
  const vids = (c.videos || nx.lastUploadedVideos || []).map(v => ({
    title: v.title || v.video_title || '',
    views: v.views || v.video_view_count || 0
  }));
  const topVid = vids.sort((a, b) => b.views - a.views)[0];

  const searchBlob = `${(c.channelTitle || nx.title || '').toLowerCase()} ${(handle || '').toLowerCase()} ${tagsLower}`;

  const verdictPill = verdict ? `<span class="verdict-pill v-${verdict.toLowerCase()}">${verdict}</span>` : '';
  const escalatePill = isEscalated ? `<span class="esc-pill">⚡ ESCALATED</span>` : '';

  // Escalation reasons (compact)
  const escReasons = (isEscalated && c.escalate?.reasons || []).slice(0, 2)
    .map(r => `<div class="esc-reason">⚡ ${esc(r)}</div>`).join('');

  const handoffCmd = `node bin/handoff-channel.js ${channelId}`;
  return `
  <article class="channel-card${isEscalated ? ' is-escalated' : ''}${isReady ? ' is-ready' : ''}"
    data-score="${score}"
    data-revenue="${monthlyRev}"
    data-views-monthly="${monthlyViews}"
    data-views-avg="${avgViews}"
    data-rpm="${rpm}"
    data-age="${ageDays}"
    data-subs="${subs}"
    data-outlier="${outlier.toFixed(2)}"
    data-min-views="${minViews}"
    data-optimal-age="${optimalAge ? '1' : '0'}"
    data-faceless="${isFaceless}"
    data-country="${esc(country)}"
    data-verdict="${verdict || 'NONE'}"
    data-tags="${esc(tagsLower)}"
    data-search="${esc(searchBlob)}">
    <div class="ch-head">
      <div class="ch-logo">${nx.thumbnailUrl ? `<img src="${esc(nx.thumbnailUrl)}" alt="" loading="lazy">` : ''}</div>
      <div class="ch-id">
        <div class="ch-name"><a href="${esc(channelUrl)}" target="_blank">${esc(c.channelTitle || nx.title || 'Untitled')}</a></div>
        <div class="ch-handle">${handle ? '@' + esc(handle) : '—'} · started ${firstUploadDate}</div>
      </div>
      <span class="age-pill">${ageDays}d</span>
    </div>

    <div class="pill-row">${escalatePill}${verdictPill}<span class="score-pill score-${scoreBucket(score)}">${score}/100</span>${optimalAge ? '<span class="optimal-pill">★ OPTIMAL AGE</span>' : ''}${(!escalatePill && !verdictPill && !optimalAge) ? `<span class="tier-text">${esc(tier)}</span>` : ''}</div>

    <div class="stat-row-3">
      <div class="stat">
        <div class="stat-label">Monthly $</div>
        <div class="stat-value">${monthlyRev ? formatMoney(monthlyRev) : '—'}</div>
        <div class="stat-caption">${nx.isMonetized === false ? 'not monetized' : 'revenue'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Monthly views</div>
        <div class="stat-value">${monthlyViews ? formatViewsBig(monthlyViews) : '—'}</div>
        <div class="stat-caption">last 30 days</div>
      </div>
      <div class="stat">
        <div class="stat-label">RPM total</div>
        <div class="stat-value">${rpm ? '$' + rpm.toFixed(2) : '—'}</div>
        <div class="stat-caption">${nx.isMonetized === true ? 'verified' : 'inferred'}</div>
      </div>
    </div>

    <div class="stat-row-2x3">
      <div class="stat stat-views">
        <div class="stat-label">Avg views/video</div>
        <div class="stat-value sm">${avgViews ? fmtNum(avgViews) : '—'}</div>
      </div>
      <div class="stat stat-min-views ${!minSampleEligible ? 'insufficient' : (minViews >= 5000 ? 'pass' : 'fail')}">
        <div class="stat-label">Min views (last ${minSample || 0})</div>
        <div class="stat-value sm">${minSampleEligible ? fmtNum(minViews) : '—'}</div>
      </div>
      <div class="stat stat-length">
        <div class="stat-label">Avg length</div>
        <div class="stat-value sm">${avgLength ? formatDuration(avgLength) : '—'}</div>
      </div>
      <div class="stat stat-subs">
        <div class="stat-label">Subscribers</div>
        <div class="stat-value sm">${fmtNum(subs)}</div>
      </div>
      <div class="stat stat-uploads">
        <div class="stat-label">Uploads/week</div>
        <div class="stat-value sm">${uploadsWeek ? Number(uploadsWeek).toFixed(1) : '—'}</div>
      </div>
      <div class="stat stat-firstup">
        <div class="stat-label">First upload</div>
        <div class="stat-value sm" style="font-size:13px;">${firstUploadDate}</div>
      </div>
    </div>

    ${tags.length > 0 ? `<div class="tag-row">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}

    ${topVid ? `<div class="top-perf">
      <div class="tp-label">Top performer</div>
      <div class="tp-row">
        <span class="tp-title">${esc(topVid.title)}</span>
        <span class="tp-views">${fmtNum(topVid.views)}</span>
      </div>
    </div>` : ''}

    ${verdictReason ? `<div class="verdict-reason">${esc(verdictReason)}</div>` : ''}
    ${escReasons}

    ${subNiches.length > 0 ? `<details class="sub-niche">
      <summary><span class="sn-label">Recommended sub-niche</span> <strong>${esc(subNiches[0].targetNiche || subNiches[0].description || '')}</strong></summary>
      <div class="sn-body">
        ${subNiches.map(b => `<div class="sn-card">
          <div class="sn-target">${esc(b.targetNiche || '')}</div>
          <div class="sn-why">${esc(b.whyItWorks || b.description || '')}</div>
          ${(b.exampleTitles || []).slice(0, 2).map(t => `<div class="sn-title">"${esc(t)}"</div>`).join('')}
        </div>`).join('')}
      </div>
    </details>` : ''}

    ${monetization.length > 0 ? `<div class="moni-row">
      <span class="moni-label">Monetization</span>
      ${monetization.map(m => `<span class="moni-chip moni-${m.type}" title="${esc(m.tip)}">${esc(m.label)}</span>`).join('')}
    </div>` : ''}

    ${isReady ? `<button class="handoff-btn" data-cmd="${esc(handoffCmd)}" data-channel="${esc(channelId)}" data-name="${esc(c.channelTitle || nx.title || '')}">→ Copy launch command</button>` : ''}

    <div class="ch-foot">
      <span class="quality"><span class="dot ${quality}"></span>Quality: ${esc(quality)}${outlier ? ` · Outlier ${outlier.toFixed(2)}×` : ''}</span>
      <a class="open-btn" href="${esc(channelUrl)}" target="_blank">Open ↗</a>
    </div>
  </article>`;
}

function getEditorialCSS() {
  return `
:root {
  --bg: #FAF8F3;
  --ink: #1A1A1A;
  --ink-soft: #555;
  --ink-faint: #999;
  --line: #E5E2DA;
  --accent: #D4F542;
  --card: #FFFFFF;
  --pill-bg: #F0EDE5;
  --good: #4A9D5C;
  --warn: #E8A33D;
  --bend: #7B5EA7;
  --bad: #C44A3D;
  /* Metric tints — slightly desaturated so the design stays editorial */
  --tint-revenue: #2E7D4F;     /* deep green for $ */
  --tint-views: #1F6FA8;       /* muted blue for views */
  --tint-rpm: #6B4A99;         /* purple for RPM */
  --tint-subs: #B87333;        /* warm amber for subs */
  --tint-uploads: #4A8E94;     /* teal for cadence */
  --tint-length: #777;         /* neutral grey for length */
  --tint-firstup: #8C6E3D;     /* soft brown for time-since */
  --tint-min: #C44A3D;         /* red when fails the 5K floor */
  /* Section accents */
  --sec-ready: #4A9D5C;
  --sec-escalated: #C44A3D;
  --sec-frontier: #2A8A8E;
  --sec-top: #D4F542;
  --sec-signals: #9B82C7;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.container { max-width: 1320px; margin: 0 auto; padding: 48px 32px 80px; }

/* HEADER */
.doc-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 24px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 32px;
}
.doc-header h1 {
  font-family: 'Tiempos Headline', 'Canela', Georgia, 'Times New Roman', serif;
  font-weight: 400;
  font-size: 64px;
  line-height: 1.0;
  letter-spacing: -0.02em;
  margin: 0;
}
.doc-header h1 em {
  font-style: italic;
  background: var(--accent);
  padding: 0 8px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.doc-meta {
  text-align: right;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.doc-meta strong { color: var(--ink); font-weight: 600; }

/* RIBBON */
.ribbon {
  display: flex;
  gap: 32px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.ribbon-stat { display: flex; flex-direction: column; }
.ribbon-num {
  font-family: 'Tiempos Headline', Georgia, serif;
  font-size: 24px;
  line-height: 1;
}
.ribbon-lbl {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-top: 4px;
}

/* FILTER BAR */
.filter-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 24px;
  margin-left: -32px;
  padding-left: 32px;
  margin-right: -32px;
  padding-right: 32px;
}
.fb-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 6px 0;
}
.fb-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  min-width: 60px;
}
.fb-search {
  flex: 1;
  min-width: 240px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--card);
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
}
.fb-search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.fb-select {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--card);
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
}
.fb-reset {
  padding: 8px 14px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--bg);
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fb-reset:hover { background: var(--ink-soft); border-color: var(--ink-soft); }
.fb-toggle {
  padding: 8px 14px;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fb-toggle:hover { border-color: var(--ink); }
.fb-toggle.on { background: var(--accent); border-color: var(--ink); }
.filter-bar.collapsed .fb-collapsible { display: none; }

.vchip, .tchip {
  border: 1px solid var(--line);
  background: var(--pill-bg);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.vchip:hover, .tchip:hover { border-color: var(--ink); }
.vchip.on { background: var(--accent); color: var(--ink); border-color: var(--ink); font-weight: 600; }
.tchip.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.tchip em { font-style: normal; opacity: 0.6; margin-left: 4px; font-size: 10px; }

.slider {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
  flex: 1;
}
.slider label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  display: flex;
  justify-content: space-between;
}
.slider output { color: var(--ink); font-weight: 600; }
.slider input[type=range] {
  width: 100%;
  accent-color: var(--ink);
}
.fb-status {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  font-style: italic;
}

/* SECTION */
.section { margin-bottom: 64px; }
.section-title-row {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.section-num {
  font-family: 'Tiempos Headline', Georgia, serif;
  font-size: 14px;
  color: var(--ink-faint);
  letter-spacing: 0.05em;
  flex-shrink: 0;
}
.section-title {
  font-family: 'Tiempos Headline', Georgia, serif;
  font-weight: 400;
  font-size: 36px;
  letter-spacing: -0.01em;
  margin: 0;
  flex: 1;
  line-height: 1.1;
}
.section-title .accent {
  background: var(--accent);
  padding: 0 8px;
  font-style: italic;
}
.section-count {
  font-size: 12px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  flex-shrink: 0;
  background: var(--card);
}
.section-desc {
  color: var(--ink-soft);
  max-width: 760px;
  margin: 0 0 16px;
}
.section-desc strong { color: var(--ink); }

.filter-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.chip {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--pill-bg);
  color: var(--ink-soft);
}
.chip.active { background: var(--accent); color: var(--ink); font-weight: 600; }

/* SUMMARY */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 40px;
}
.summary-card {
  background: var(--card);
  border: 1px solid var(--line);
  padding: 20px 24px;
  border-radius: 4px;
}
.summary-card .label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-bottom: 8px;
}
.summary-card .value {
  font-family: 'Tiempos Headline', Georgia, serif;
  font-size: 40px;
  line-height: 1.0;
  color: var(--ink);
}
.summary-card .value.accent {
  background: linear-gradient(180deg, transparent 60%, var(--accent) 60%);
  display: inline;
  padding: 0 4px;
}
.summary-card .caption {
  font-size: 11px;
  color: var(--ink-soft);
  margin-top: 8px;
}

/* CARDS */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.channel-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.15s, transform 0.15s;
}
.channel-card:hover { border-color: var(--ink); }
.channel-card.is-escalated { border-color: var(--bad); border-width: 1px; box-shadow: 0 0 0 1px var(--bad) inset; }
.channel-card.is-ready { border-color: var(--good); box-shadow: 0 0 0 2px var(--good) inset; background: linear-gradient(180deg, rgba(74,157,92,0.04), var(--card) 40px); }
.section.is-ready-section .section-title .accent { background: var(--good); color: #fff; }
.handoff-btn {
  width: 100%;
  padding: 10px 14px;
  background: var(--good);
  color: #fff;
  border: 1px solid var(--good);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.1s;
}
.handoff-btn:hover { background: #3d8a4f; }
.handoff-btn.copied { background: var(--ink); border-color: var(--ink); }
.channel-card.hidden { display: none; }

.ch-head {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  align-items: center;
}
.ch-logo {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: var(--pill-bg);
  overflow: hidden;
  flex-shrink: 0;
}
.ch-logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ch-id { min-width: 0; }
.ch-name { font-weight: 600; font-size: 14px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-name a { color: var(--ink); text-decoration: none; }
.ch-name a:hover { text-decoration: underline; }
.ch-handle { font-size: 11px; color: var(--ink-faint); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.age-pill {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--pill-bg);
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--ink-soft);
  flex-shrink: 0;
}

.pill-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.score-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}
.score-high { background: rgba(74,157,92,0.15); color: var(--good); }
.score-mid { background: rgba(232,163,61,0.15); color: var(--warn); }
.score-low { background: var(--pill-bg); color: var(--ink-soft); }
.tier-text { font-size: 11px; color: var(--ink-soft); font-style: italic; }
.esc-pill {
  font-size: 10px;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--bad);
  color: #fff;
}
.verdict-pill {
  font-size: 10px;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
}
.v-go { background: rgba(74,157,92,0.18); color: var(--good); }
.v-caution { background: rgba(232,163,61,0.18); color: var(--warn); }
.v-bend { background: rgba(123,94,167,0.18); color: var(--bend); }
.v-skip { background: rgba(196,74,61,0.18); color: var(--bad); }

.stat-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stat-row-3 > .stat:nth-child(1) .stat-value { color: var(--tint-revenue); }
.stat-row-3 > .stat:nth-child(2) .stat-value { color: var(--tint-views); }
.stat-row-3 > .stat:nth-child(3) .stat-value { color: var(--tint-rpm); }
.stat-row-2x2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.stat-row-2x3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 14px; }
.stat .stat-label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.stat .stat-value { font-family: 'Tiempos Headline', Georgia, serif; font-size: 22px; line-height: 1.1; margin-top: 4px; }
.stat .stat-value.sm { font-size: 16px; }
.stat .stat-caption { font-size: 10px; color: var(--ink-faint); margin-top: 4px; }
.stat-views .stat-value { color: var(--tint-views); }
.stat-min-views.pass .stat-value { color: var(--tint-revenue); }
.stat-min-views.fail .stat-value { color: var(--tint-min); }
.stat-min-views.fail::after {
  content: '< 5K';
  display: block;
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--tint-min);
  margin-top: 2px;
  font-weight: 600;
}
.stat-min-views.insufficient .stat-value { color: var(--ink-faint); }
.stat-min-views.insufficient::after {
  content: 'sample < 3';
  display: block;
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  margin-top: 2px;
  font-style: italic;
}
.stat-length .stat-value { color: var(--tint-length); }
.stat-subs .stat-value { color: var(--tint-subs); }
.stat-uploads .stat-value { color: var(--tint-uploads); }
.stat-firstup .stat-value { color: var(--tint-firstup); }

/* Per-section accent variants — keyed off semantic type, not number */
.section[data-section-type="ready"] .section-title .accent { background: var(--sec-ready); color: #fff; }
.section[data-section-type="escalated"] .section-title .accent { background: var(--sec-escalated); color: #fff; }
.section[data-section-type="frontier"] .section-title .accent { background: var(--sec-frontier); color: #fff; }
.section[data-section-type="top"] .section-title .accent { background: var(--sec-top); color: var(--ink); }
.section[data-section-type="signals"] .section-title .accent { background: var(--sec-signals); color: #fff; }
.section[data-section="disappeared"] .section-title .accent { background: var(--ink-soft); color: var(--bg); }
.section[data-section="rejected"] .section-title .accent { background: var(--pill-bg); color: var(--ink-soft); }
/* Section count pill picks up the section accent at low opacity */
.section[data-section-type="ready"] .section-count { border-color: var(--sec-ready); color: var(--sec-ready); }
.section[data-section-type="escalated"] .section-count { border-color: var(--sec-escalated); color: var(--sec-escalated); }
.section[data-section-type="frontier"] .section-count { border-color: var(--sec-frontier); color: var(--sec-frontier); }
.section[data-section-type="signals"] .section-count { border-color: var(--sec-signals); color: var(--sec-signals); }

.optimal-pill {
  font-size: 10px;
  letter-spacing: 0.06em;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--ink);
  text-transform: uppercase;
}

.tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 3px 8px; background: var(--pill-bg); border-radius: 3px; color: var(--ink-soft); }

.top-perf { padding: 12px 0; border-top: 1px solid var(--line); }
.top-perf .tp-label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 6px; }
.tp-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.tp-title {
  font-size: 12px;
  line-height: 1.3;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tp-views { font-size: 12px; font-weight: 600; flex-shrink: 0; }

.verdict-reason {
  font-size: 11px;
  color: var(--ink-soft);
  font-style: italic;
  padding: 8px 10px;
  background: var(--pill-bg);
  border-radius: 4px;
  line-height: 1.4;
}
.esc-reason {
  font-size: 11px;
  color: var(--bad);
  padding: 2px 0;
}

.sub-niche {
  background: var(--pill-bg);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 11px;
  border: 1px solid var(--line);
}
.sub-niche summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sub-niche summary::-webkit-details-marker { display: none; }
.sub-niche summary::before { content: '▶ '; font-size: 9px; color: var(--ink-faint); }
.sub-niche[open] summary::before { content: '▼ '; }
.sn-label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.sub-niche summary strong { color: var(--ink); font-size: 12px; }
.sn-body { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.sn-card { padding: 8px; background: var(--card); border-radius: 4px; border: 1px solid var(--line); }
.sn-target { font-weight: 600; color: var(--ink); font-size: 11px; margin-bottom: 4px; }
.sn-why { color: var(--ink-soft); font-size: 11px; line-height: 1.4; margin-bottom: 4px; }
.sn-title { color: var(--ink); font-size: 11px; font-style: italic; padding: 2px 0; }

.moni-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.moni-label { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); margin-right: 4px; }
.moni-chip {
  font-size: 10px;
  padding: 3px 7px;
  border-radius: 3px;
  cursor: help;
  border: 1px solid var(--line);
}
.moni-affiliate { background: rgba(74,157,92,0.10); color: var(--good); border-color: rgba(74,157,92,0.30); }
.moni-sponsorship { background: rgba(123,94,167,0.10); color: var(--bend); border-color: rgba(123,94,167,0.30); }
.moni-product { background: rgba(232,163,61,0.12); color: var(--warn); border-color: rgba(232,163,61,0.30); }
.moni-leadgen { background: var(--pill-bg); color: var(--ink); }

.ch-foot { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid var(--line); margin-top: auto; }
.quality { font-size: 11px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.dot.high { background: var(--good); }
.dot.low { background: var(--bad); }
.open-btn {
  font-size: 11px;
  text-decoration: none;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line);
  padding: 6px 12px;
  border-radius: 4px;
  transition: background 0.1s;
}
.open-btn:hover { background: var(--accent); border-color: var(--ink); }

/* DATA TABLE */
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--card); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.data-table th { text-align: left; padding: 10px 14px; background: var(--pill-bg); color: var(--ink); font-weight: 600; border-bottom: 1px solid var(--line); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
.data-table td { padding: 8px 14px; border-bottom: 1px solid var(--line); }
.data-table tr:last-child td { border-bottom: none; }

/* FOOTER */
.footer { text-align: center; padding: 32px 0; color: var(--ink-faint); font-size: 11px; letter-spacing: 0.04em; border-top: 1px solid var(--line); margin-top: 64px; }

/* RESPONSIVE */
@media (max-width: 1100px) {
  .cards-grid { grid-template-columns: repeat(3, 1fr); }
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .doc-header h1 { font-size: 48px; }
}
@media (max-width: 820px) {
  .container { padding: 24px 16px 60px; }
  .cards-grid { grid-template-columns: repeat(2, 1fr); }
  .doc-header { grid-template-columns: 1fr; gap: 16px; }
  .doc-meta { text-align: left; }
  .doc-header h1 { font-size: 36px; }
  .section-title { font-size: 26px; }
  .filter-bar { margin-left: -16px; padding-left: 16px; margin-right: -16px; padding-right: 16px; }
}
@media (max-width: 520px) {
  .cards-grid { grid-template-columns: 1fr; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
  .stat-row-3 { grid-template-columns: 1fr; gap: 8px; }
}
`;
}

function getEditorialJS() {
  return `
(function(){
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const cards = $$('.channel-card');
  const totalCount = cards.length;

  const state = {
    search: '',
    sort: 'score',
    country: 'all',
    faceless: 'all',
    verdicts: new Set(),
    tags: new Set(),
    scoreMin: 0,
    ageMax: 7500,
    subsMax: 5000000,
    viewsMin: 5000,
    minViewsMin: 0,
    rpmMin: 0,
    revMin: 0
  };

  const fmtMoney = (n) => {
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'k';
    return '$' + Math.round(n);
  };
  const fmtViews = (n) => {
    if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(0) + 'k';
    return String(Math.round(n));
  };
  const fmtSubs = (n) => {
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(0) + 'k';
    return String(n);
  };
  const median = (arr) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a,b)=>a-b);
    const m = Math.floor(s.length/2);
    return s.length%2 ? s[m] : Math.round((s[m-1]+s[m])/2);
  };

  function apply() {
    const q = state.search.trim().toLowerCase();
    let visible = [];
    cards.forEach(card => {
      const score = parseFloat(card.dataset.score) || 0;
      const rev = parseFloat(card.dataset.revenue) || 0;
      const monthlyViews = parseFloat(card.dataset.viewsMonthly) || 0;
      const avgViews = parseFloat(card.dataset.viewsAvg) || 0;
      const minViewsCard = parseFloat(card.dataset.minViews) || 0;
      const rpm = parseFloat(card.dataset.rpm) || 0;
      const age = parseFloat(card.dataset.age) || 0;
      const subs = parseFloat(card.dataset.subs) || 0;
      const faceless = card.dataset.faceless;
      const country = card.dataset.country;
      const verdict = card.dataset.verdict;
      const tags = card.dataset.tags || '';
      const search = card.dataset.search || '';

      let show = true;
      if (q && !search.includes(q)) show = false;
      if (show && score < state.scoreMin) show = false;
      if (show && age > state.ageMax) show = false;
      if (show && subs > state.subsMax) show = false;
      if (show && avgViews < state.viewsMin) show = false;
      if (show && minViewsCard < state.minViewsMin) show = false;
      if (show && rpm < state.rpmMin) show = false;
      if (show && rev < state.revMin) show = false;
      if (show && state.faceless !== 'all' && faceless !== state.faceless) show = false;
      if (show && state.country !== 'all' && country !== state.country) show = false;
      if (show && state.verdicts.size > 0 && !state.verdicts.has(verdict)) show = false;
      if (show && state.tags.size > 0) {
        for (const t of state.tags) {
          if (!tags.includes(t)) { show = false; break; }
        }
      }

      card.classList.toggle('hidden', !show);
      if (show) visible.push(card);
    });

    // Sort within each grid
    const grids = $$('.cards-grid');
    grids.forEach(grid => {
      const gridCards = $$('.channel-card', grid).filter(c => !c.classList.contains('hidden'));
      gridCards.sort((a, b) => {
        let av, bv;
        if (state.sort === 'age') {
          av = parseFloat(a.dataset.age) || 0; bv = parseFloat(b.dataset.age) || 0;
          return av - bv;
        }
        if (state.sort === 'revenue') { av = parseFloat(a.dataset.revenue)||0; bv = parseFloat(b.dataset.revenue)||0; }
        else if (state.sort === 'views') { av = parseFloat(a.dataset.viewsAvg)||0; bv = parseFloat(b.dataset.viewsAvg)||0; }
        else if (state.sort === 'outlier') { av = parseFloat(a.dataset.outlier)||0; bv = parseFloat(b.dataset.outlier)||0; }
        else { av = parseFloat(a.dataset.score)||0; bv = parseFloat(b.dataset.score)||0; }
        return bv - av;
      });
      gridCards.forEach(c => grid.appendChild(c));
    });

    // Recompute per-section counts
    $$('section.section').forEach(section => {
      const num = section.dataset.section;
      const visibleInSection = $$('.channel-card', section).filter(c => !c.classList.contains('hidden')).length;
      const totalInSection = $$('.channel-card', section).length;
      const badge = $('[data-section-count="' + num + '"]', section);
      if (badge) {
        badge.textContent = visibleInSection === totalInSection
          ? totalInSection + ' channels'
          : visibleInSection + ' / ' + totalInSection + ' channels';
      }
      // Hide entire section if 0 visible
      section.style.display = visibleInSection === 0 && totalInSection > 0 ? 'none' : '';
    });

    // Recompute summary cards
    $('#sm-count').textContent = visible.length;
    const totalRev = visible.reduce((s,c) => s + (parseFloat(c.dataset.revenue)||0), 0);
    const totalViews = visible.reduce((s,c) => s + (parseFloat(c.dataset.viewsMonthly)||0), 0);
    const ages = visible.map(c => parseFloat(c.dataset.age)||0).filter(a => a > 0);
    $('#sm-rev').textContent = totalRev > 0 ? fmtMoney(totalRev) : '$0';
    $('#sm-views').textContent = totalViews > 0 ? fmtViews(totalViews) : '0';
    $('#sm-age').textContent = (ages.length ? median(ages) : 0) + 'd';

    // Status line
    $('#f-status').textContent = 'Showing ' + visible.length + ' of ' + totalCount + ' channels';
  }

  // Wire controls
  $('#f-search').addEventListener('input', e => { state.search = e.target.value; apply(); });
  $('#f-sort').addEventListener('change', e => { state.sort = e.target.value; apply(); });
  const fc = $('#f-country');
  if (fc) fc.addEventListener('change', e => { state.country = e.target.value; apply(); });
  $('#f-faceless').addEventListener('change', e => { state.faceless = e.target.value; apply(); });

  $$('.vchip').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.verdict;
    if (state.verdicts.has(v)) { state.verdicts.delete(v); b.classList.remove('on'); }
    else { state.verdicts.add(v); b.classList.add('on'); }
    apply();
  }));
  $$('.tchip').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (state.tags.has(t)) { state.tags.delete(t); b.classList.remove('on'); }
    else { state.tags.add(t); b.classList.add('on'); }
    apply();
  }));

  function bindSlider(id, key, fmt, output) {
    const el = $('#' + id);
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state[key] = v;
      $('#' + output).textContent = fmt(v);
      apply();
    });
  }
  bindSlider('f-score', 'scoreMin', v => v, 'o-score');
  bindSlider('f-age', 'ageMax', v => v >= 7500 ? '∞' : v, 'o-age');
  bindSlider('f-subs', 'subsMax', v => v >= 5000000 ? '∞' : fmtSubs(v), 'o-subs');
  bindSlider('f-views', 'viewsMin', v => fmtViews(v), 'o-views');
  bindSlider('f-minviews', 'minViewsMin', v => fmtViews(v), 'o-minviews');
  bindSlider('f-rpm', 'rpmMin', v => '$' + v.toFixed(1), 'o-rpm');
  bindSlider('f-rev', 'revMin', v => fmtMoney(v), 'o-rev');

  $('#f-more').addEventListener('click', () => {
    const bar = $('#filterBar');
    bar.classList.toggle('collapsed');
    const btn = $('#f-more');
    btn.textContent = bar.classList.contains('collapsed') ? 'More filters ▾' : 'Less filters ▴';
    btn.classList.toggle('on', !bar.classList.contains('collapsed'));
  });

  $('#f-reset').addEventListener('click', () => {
    state.search = ''; $('#f-search').value = '';
    state.sort = 'score'; $('#f-sort').value = 'score';
    if (fc) { state.country = 'all'; fc.value = 'all'; }
    state.faceless = 'all'; $('#f-faceless').value = 'all';
    state.verdicts.clear(); $$('.vchip').forEach(b => b.classList.remove('on'));
    state.tags.clear(); $$('.tchip').forEach(b => b.classList.remove('on'));
    state.scoreMin = 0; $('#f-score').value = 0; $('#o-score').textContent = '0';
    state.ageMax = 7500; $('#f-age').value = 7500; $('#o-age').textContent = '∞';
    state.subsMax = 5000000; $('#f-subs').value = 5000000; $('#o-subs').textContent = '∞';
    state.viewsMin = 5000; $('#f-views').value = 5000; $('#o-views').textContent = '5k';
    state.minViewsMin = 0; $('#f-minviews').value = 0; $('#o-minviews').textContent = '0';
    state.rpmMin = 0; $('#f-rpm').value = 0; $('#o-rpm').textContent = '$0';
    state.revMin = 0; $('#f-rev').value = 0; $('#o-rev').textContent = '$0';
    apply();
  });

  // Handoff button — copy launch command to clipboard
  document.querySelectorAll('.handoff-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      const name = btn.dataset.name;
      try {
        await navigator.clipboard.writeText(cmd);
      } catch (err) {
        // Fallback for file:// where clipboard API may be blocked
        const ta = document.createElement('textarea');
        ta.value = cmd;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const original = btn.textContent;
      btn.textContent = '✓ Copied — paste in PowerShell';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 3000);
    });
  });

  apply();
})();
`;
}

// ---- helpers ----

function pickHeadline({ escalated, top, frontier, signals }) {
  if (escalated >= 3) return 'Fresh channels,<br><em>unfair pace.</em>';
  if (frontier >= 5) return 'Under three months,<br><em>real velocity.</em>';
  if (escalated === 0 && top < 5) return 'Quiet day,<br><em>one or two threads.</em>';
  if (signals > top * 2) return 'Lots of noise,<br><em>little signal.</em>';
  if (top >= 10) return 'Today\'s lane,<br><em>worth replicating.</em>';
  return 'Today\'s lane,<br><em>worth watching.</em>';
}

function topTags(cards, limit) {
  const freq = new Map();
  cards.forEach(c => {
    (c.nexlev?.categories || []).forEach(t => {
      const k = String(t).trim();
      if (!k) return;
      freq.set(k, (freq.get(k) || 0) + 1);
    });
  });
  return Array.from(freq.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function uniqueCountries(cards) {
  const set = new Set();
  cards.forEach(c => {
    const v = c.country || c.nexlev?.country;
    if (v && v !== '—') set.add(v);
  });
  return Array.from(set).sort();
}

function extractChannelId(url) {
  if (!url) return '';
  const m = url.match(/channel\/(UC[\w-]+)/);
  return m ? m[1] : '';
}

function extractHandle(url) {
  if (!url) return '';
  const m = url.match(/@([\w.\-]+)/);
  return m ? m[1] : '';
}

function scoreBucket(s) {
  if (s >= 60) return 'high';
  if (s >= 40) return 'mid';
  return 'low';
}

function pad(n) { return String(n).padStart(2, '0'); }

// STRICT launch checklist — all 7 conditions must pass.
// Sends only the highest-confidence channels into yt-automation.
//
// Notes on view threshold:
//   We require the MINIMUM video view count to be >= 5000, not the average.
//   This proves no upload tanked. With NexLev's recentVideos (~7 most recent)
//   that's a meaningful floor across the visible upload window.
//
// Notes on age:
//   Channel must be <= 60 days old (counted from first upload). Younger is
//   better — the "optimal" tag is rendered separately for <= 30 days.
function isReadyToLaunch(c) {
  const nx = c.nexlev || {};
  const score = c.score?.totalScore || 0;
  const verdict = c.competitionLandscape?.verdict || c.verdict?.verdict || '';
  const ageDays = c.ageDays || nx.daysSinceStart || 0;
  const videoCount = c.videoCount || nx.numOfUploads || 0;
  const minV = computeMinViews(c);
  // Monetization is NOT a gate — early-stage channels (e.g. 5 videos in, going
  // viral) often haven't been detected as monetized yet. Status still appears
  // on the card as a chip; we just don't block on it.
  return (
    nx.isFaceless === true &&
    score >= 60 &&
    (verdict === 'GO' || verdict === 'CAUTION') &&
    minV.eligible && minV.value >= 5000 &&
    ageDays > 0 && ageDays <= 60 &&
    videoCount >= 5
  );
}

// Policy A with sample-size floor:
//   "Min view count across the last 5 most-recent uploads, requiring at least
//    3 valid samples to qualify. Channels with fewer than 3 uploads return 0."
//
// Returns { value, sample, eligible }:
//   value    — Math.min across the (up to) 5 most-recent videos
//   sample   — how many we actually evaluated (3..5)
//   eligible — whether the sample is large enough to judge (>= 3)
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

  // Sort newest -> oldest, take top N most recent.
  parsed.sort((a, b) => b.ts - a.ts);
  const recent = parsed.slice(0, MIN_VIEWS_WINDOW_VIDEOS);

  if (recent.length < MIN_VIEWS_REQUIRED_SAMPLE) {
    return { value: 0, sample: recent.length, eligible: false };
  }
  const value = Math.min(...recent.map(r => r.views));
  return { value, sample: recent.length, eligible: true };
}

function isOptimalAge(c) {
  const ageDays = c.ageDays || c.nexlev?.daysSinceStart || 999;
  return ageDays > 0 && ageDays <= 30;
}

// Static category → monetization opportunity table.
// Goes beyond AdSense: flags affiliate networks, sponsorship potential, digital products, lead-gen.
const MONETIZATION_RULES = [
  { match: /senior|over 50|over 60|over 65|aged?|elder|mobility|joint|arthritis|longevity/i, stack: [
    { type: 'affiliate', label: 'Joint/mobility supplements', tip: 'Glucosamine, MSM, turmeric, collagen via Amazon Associates / ShareASale' },
    { type: 'affiliate', label: 'Mobility aids', tip: 'Knee braces, walking aids, heated massagers, TENS units' },
    { type: 'product', label: '$27–47 mobility ebook/program', tip: 'Lead magnet → email list → 12-week mobility program' },
    { type: 'leadgen', label: 'Health newsletter', tip: 'Weekly health tips PDF — recurring revenue if subscriptions added' },
  ]},
  { match: /\bhealth\b|wellness|nutrition|diet|disease|medication|symptom|doctor/i, stack: [
    { type: 'affiliate', label: 'Supplements', tip: 'High-RPM tier: vitamins, supplements, health foods' },
    { type: 'sponsorship', label: 'Health brand sponsorship', tip: 'BetterHelp, Athletic Greens, Ritual, Seed' },
    { type: 'product', label: 'Meal/diet plan', tip: 'PDF meal plans, $19–47, scale via email list' },
  ]},
  { match: /sleep|insomnia|relaxation|asmr|meditation|calm/i, stack: [
    { type: 'affiliate', label: 'Mattress/bedding', tip: 'Casper, Helix, Saatva — high payouts ($50–150 per sale)' },
    { type: 'affiliate', label: 'Sleep aids', tip: 'Magnesium, melatonin, weighted blankets, sleep masks' },
    { type: 'sponsorship', label: 'Sleep brand sponsorship', tip: 'Eight Sleep, Manta Sleep, Calm app' },
    { type: 'product', label: 'Sleep audio packs', tip: 'Premium ad-free sleep audio on Patreon / own site' },
  ]},
  { match: /cook|recipe|food|kitchen|chef|meal/i, stack: [
    { type: 'affiliate', label: 'Cookware', tip: 'Made In, Lodge, Le Creuset via Amazon Associates' },
    { type: 'affiliate', label: 'Meal kits', tip: 'HelloFresh, Blue Apron — high CPA' },
    { type: 'sponsorship', label: 'Food brand sponsorship', tip: 'Kettle & Fire, Thrive Market, Magic Spoon' },
    { type: 'product', label: 'Recipe ebook', tip: '$9–19 niche cookbook, sells well to evergreen audiences' },
  ]},
  { match: /diy|hack|fix|repair|maintenance|home|tool|build/i, stack: [
    { type: 'affiliate', label: 'Tools/hardware', tip: 'Home Depot, Amazon — DeWalt, Milwaukee, Ryobi' },
    { type: 'affiliate', label: 'Smart home', tip: 'Smart locks, thermostats, security cams' },
    { type: 'sponsorship', label: 'Tool brand sponsorship', tip: 'Stanley, Klein, Rockler' },
    { type: 'product', label: 'DIY blueprint pack', tip: 'PDF plans bundled, $17–37' },
  ]},
  { match: /survival|prepper|off-?grid|homestead/i, stack: [
    { type: 'affiliate', label: 'Survival gear', tip: 'Knives, fire starters, water filters, emergency food (Mountain House)' },
    { type: 'affiliate', label: 'Solar/power', tip: 'Jackery, Bluetti, EcoFlow — $100+ payouts' },
    { type: 'product', label: 'Prepping ebook', tip: '"30-day food storage" $19–37 evergreen' },
  ]},
  { match: /finance|money|invest|stock|crypto|debt|wealth/i, stack: [
    { type: 'affiliate', label: 'Brokerages/banks', tip: 'SoFi, Robinhood, M1 — $50–250 per signup' },
    { type: 'sponsorship', label: 'Fintech sponsorship', tip: 'NerdWallet, Credit Karma, MoneyLion' },
    { type: 'product', label: 'Money course/ebook', tip: 'High-ticket: $97–497 financial education' },
  ]},
  { match: /pet|dog|cat|animal/i, stack: [
    { type: 'affiliate', label: 'Pet supplies', tip: 'Chewy, Amazon — food, toys, grooming' },
    { type: 'sponsorship', label: 'Pet brand sponsorship', tip: 'Ollie, Farmers Dog, BarkBox' },
    { type: 'product', label: 'Training ebook', tip: '"Stop barking in 7 days" type, $17–27' },
  ]},
  { match: /travel|destination|country|city/i, stack: [
    { type: 'affiliate', label: 'Travel booking', tip: 'Booking.com, Expedia, Hotels.com' },
    { type: 'sponsorship', label: 'VPN/travel insurance', tip: 'NordVPN, ExpressVPN, SafetyWing' },
    { type: 'product', label: 'City guide PDF', tip: 'Niche destination guides, $9–19' },
  ]},
  { match: /tech|gadget|review|software|ai\b|crypto/i, stack: [
    { type: 'affiliate', label: 'Tech gear', tip: 'Amazon, Best Buy — gadgets, cables, peripherals' },
    { type: 'sponsorship', label: 'SaaS sponsorship', tip: 'Notion, ClickUp, ConvertKit — high LTV brands pay well' },
    { type: 'product', label: 'AI prompt pack / template', tip: 'Digital products $17–47, evergreen' },
  ]},
  { match: /space|astronomy|cosmic|universe|nasa|earth|science|nature/i, stack: [
    { type: 'affiliate', label: 'Telescopes / science kits', tip: 'Celestron, Orion via Amazon' },
    { type: 'sponsorship', label: 'Education sponsorship', tip: 'Brilliant, Curiosity Stream, Magellan TV' },
    { type: 'product', label: 'Stargazing PDF / poster', tip: 'Niche prints + ebooks $9–29' },
  ]},
  { match: /history|ancient|forgotten|civilization|empire|war/i, stack: [
    { type: 'affiliate', label: 'Books / collectibles', tip: 'Amazon books, replica artifacts' },
    { type: 'sponsorship', label: 'History sponsorship', tip: 'History Hit, Curiosity Stream, Magellan TV' },
    { type: 'product', label: 'Timeline ebook', tip: '"Forgotten history" PDF compilations $9–19' },
  ]},
  { match: /crime|mystery|true crime|murder|case/i, stack: [
    { type: 'affiliate', label: 'Personal safety', tip: 'Self-defense, home security, doorbell cams' },
    { type: 'sponsorship', label: 'True crime sponsorship', tip: 'BetterHelp, Audible, June\'s Journey' },
    { type: 'product', label: 'Case files PDF series', tip: 'Subscription: $5/mo for unsolved case deep-dives' },
  ]},
];

function monetizationStack(categories, title) {
  const blob = (categories.join(' ') + ' ' + (title || '')).toLowerCase();
  const matched = [];
  const seen = new Set();
  for (const rule of MONETIZATION_RULES) {
    if (rule.match.test(blob)) {
      for (const item of rule.stack) {
        const key = item.type + '|' + item.label;
        if (!seen.has(key)) { seen.add(key); matched.push(item); }
      }
    }
  }
  // Cap at 4 to keep cards compact.
  return matched.slice(0, 4);
}

function sum(arr, fn) { return arr.reduce((s, x) => s + (fn(x) || 0), 0); }

function median(arr) {
  const xs = arr.filter(x => x > 0).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2);
}

function formatMoney(n) {
  if (!n) return '$0';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
  return '$' + Math.round(n);
}

function formatViewsBig(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(Math.round(n));
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const s = Math.round(Number(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Editorial email summary — short body that pairs with the full dashboard HTML attachment.
// Goal: tiny payload (~10-15KB) so Gmail never clips, but visually consistent with the dashboard.
// All controls/cards live in the attachment; the email body is a "what's in it" preview.
function generateEmailSummary(approved, rejected, metadata) {
  const date = metadata.date.toISOString().split('T')[0];
  const dateShort = formatDateShort(date);

  const ready = approved.filter(isReadyToLaunch);
  const readyIds = new Set(ready.map(c => c.channelId));
  const escalated = approved.filter(c => c.escalate?.escalate && !readyIds.has(c.channelId));
  const top60 = approved.filter(c => !readyIds.has(c.channelId) && !escalated.find(e => e.channelId === c.channelId) && c.score.totalScore >= 60);
  const top40 = approved.filter(c => c.score.totalScore >= 40);

  const totalRev = approved.reduce((s, c) => s + (c.nexlev?.avgMonthlyRevenue || 0), 0);

  const headline = pickHeadline({
    escalated: escalated.length,
    top: top40.length,
    frontier: approved.filter(c => (c.ageDays || c.nexlev?.daysSinceStart || 999) <= 30 && c.score.totalScore >= 25).length,
    signals: approved.filter(c => c.score.totalScore >= 20 && c.score.totalScore < 40).length
  });

  const renderRow = (c) => {
    const nx = c.nexlev || {};
    const score = c.score?.totalScore || 0;
    const verdict = c.competitionLandscape?.verdict || c.verdict?.verdict || '';
    const ageDays = c.ageDays || nx.daysSinceStart || 0;
    const channelId = c.channelId || extractChannelId(c.channelUrl || nx.url || '');
    const url = channelId ? `https://www.youtube.com/channel/${channelId}` : (c.channelUrl || nx.url || '#');
    const verdictBadge = verdict ? `<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:${verdict==='GO'?'#e6f2e9':verdict==='CAUTION'?'#fbeed8':verdict==='BEND'?'#ebe2f3':'#f3dcd9'};color:${verdict==='GO'?'#4A9D5C':verdict==='CAUTION'?'#E8A33D':verdict==='BEND'?'#7B5EA7':'#C44A3D'};margin-right:6px;font-weight:600;letter-spacing:0.04em;">${verdict}</span>` : '';
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E2DA;">
        <div style="font-weight:600;font-size:13px;"><a href="${esc(url)}" style="color:#1A1A1A;text-decoration:none;">${esc(c.channelTitle || nx.title || '')}</a></div>
        <div style="font-size:11px;color:#999;margin-top:2px;">${verdictBadge}${ageDays}d · ${(nx.categories || []).slice(0,2).join(' · ') || 'general'}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E2DA;text-align:right;font-family:Georgia,serif;font-size:18px;">${score}<span style="font-size:11px;color:#999;font-family:inherit;">/100</span></td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E2DA;text-align:right;font-size:12px;color:#555;">${nx.avgMonthlyRevenue ? formatMoney(nx.avgMonthlyRevenue) : '—'}<br><span style="font-size:10px;color:#999;">${(nx.avgMonthlyViews ? formatViewsBig(nx.avgMonthlyViews) : '—')} views/mo</span></td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Niche Scanner — ${dateShort}</title>
</head>
<body style="margin:0;padding:0;background:#FAF8F3;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;color:#1A1A1A;">
<div style="max-width:680px;margin:0 auto;padding:32px 24px;">

  <div style="padding-bottom:24px;border-bottom:1px solid #E5E2DA;margin-bottom:24px;">
    <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:36px;line-height:1.05;margin:0 0 12px;letter-spacing:-0.02em;">${headline}</h1>
    <div style="font-size:11px;color:#555;line-height:1.7;">
      Prepared for <strong style="color:#1A1A1A;">Claudio Jerez</strong> · Power Media Holdings B.V. · Report · ${dateShort}
    </div>
  </div>

  <div style="background:#fff;border:2px solid #D4F542;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#555;margin-bottom:6px;">📎 Full dashboard attached</div>
    <div style="font-size:13px;color:#1A1A1A;line-height:1.5;">
      Open <strong>niche-scanner-${date}.html</strong> in your browser for the complete filterable view —
      all ${approved.length} approved channels, sub-niche recommendations, monetization stack per channel,
      verdict/score/age sliders, search, sort, and "→ Copy launch command" buttons for ready-to-launch channels.
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr>
      <td style="width:25%;padding:14px 12px;background:#fff;border:1px solid #E5E2DA;text-align:left;">
        <div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:6px;">Approved</div>
        <div style="font-family:Georgia,serif;font-size:30px;line-height:1;">${approved.length}</div>
      </td>
      <td style="width:25%;padding:14px 12px;background:#fff;border:1px solid #E5E2DA;border-left:none;text-align:left;">
        <div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:6px;">Ready to launch</div>
        <div style="font-family:Georgia,serif;font-size:30px;line-height:1;color:${ready.length>0?'#4A9D5C':'#1A1A1A'};">${ready.length}</div>
      </td>
      <td style="width:25%;padding:14px 12px;background:#fff;border:1px solid #E5E2DA;border-left:none;text-align:left;">
        <div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:6px;">Score 60+</div>
        <div style="font-family:Georgia,serif;font-size:30px;line-height:1;">${top60.length + ready.length}</div>
      </td>
      <td style="width:25%;padding:14px 12px;background:#fff;border:1px solid #E5E2DA;border-left:none;text-align:left;">
        <div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:6px;">Combined $/mo</div>
        <div style="font-family:Georgia,serif;font-size:30px;line-height:1;"><span style="background:linear-gradient(180deg,transparent 60%,#D4F542 60%);padding:0 4px;">${formatMoney(totalRev)}</span></div>
      </td>
    </tr>
  </table>

  ${ready.length > 0 ? `
  <div style="margin-bottom:24px;">
    <h2 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 8px;">§ 01 Ready to launch <span style="background:#4A9D5C;color:#fff;padding:0 6px;font-style:italic;">send to yt-automation</span></h2>
    <p style="margin:0 0 12px;color:#555;font-size:12px;">Passed the strict 7-condition checklist. Ready for handoff via <code style="background:#F0EDE5;padding:1px 5px;border-radius:3px;font-size:11px;">node bin/handoff-channel.js &lt;id&gt;</code></p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #4A9D5C;border-radius:4px;overflow:hidden;">
      ${ready.slice(0, 8).map(renderRow).join('')}
    </table>
  </div>` : ''}

  ${escalated.length > 0 ? `
  <div style="margin-bottom:24px;">
    <h2 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 8px;">§ ${ready.length>0?'02':'01'} Escalated <span style="background:#D4F542;padding:0 6px;font-style:italic;">immediate attention</span></h2>
    <p style="margin:0 0 12px;color:#555;font-size:12px;">Auto-flagged escalation triggers but missing one or more launch conditions.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #E5E2DA;border-radius:4px;overflow:hidden;">
      ${escalated.slice(0, 8).map(renderRow).join('')}
    </table>
  </div>` : ''}

  ${top60.length > 0 ? `
  <div style="margin-bottom:24px;">
    <h2 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 8px;">§ ${(ready.length>0?1:0)+(escalated.length>0?1:0)+1 < 10 ? '0'+((ready.length>0?1:0)+(escalated.length>0?1:0)+1) : (ready.length>0?1:0)+(escalated.length>0?1:0)+1} Top 60+ score <span style="background:#D4F542;padding:0 6px;font-style:italic;">replicable now</span></h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #E5E2DA;border-radius:4px;overflow:hidden;">
      ${top60.slice(0, 12).map(renderRow).join('')}
    </table>
    ${top60.length > 12 ? `<p style="font-size:11px;color:#999;margin:8px 0 0;font-style:italic;">+${top60.length - 12} more — see full dashboard attachment.</p>` : ''}
  </div>` : ''}

  <div style="padding:16px;background:#F0EDE5;border-radius:4px;margin-bottom:24px;font-size:12px;color:#555;line-height:1.5;">
    <strong style="color:#1A1A1A;">Reading guide:</strong>
    Score = how good the channel is.
    Verdict (<span style="color:#4A9D5C;font-weight:600;">GO</span>/<span style="color:#E8A33D;font-weight:600;">CAUTION</span>/<span style="color:#7B5EA7;font-weight:600;">BEND</span>/<span style="color:#C44A3D;font-weight:600;">SKIP</span>) = how much room there is in the market.
    They can disagree — a great channel in a SKIP market means clone the format with a niche bend, not the topic.
  </div>

  <div style="text-align:center;color:#999;font-size:10px;letter-spacing:0.04em;border-top:1px solid #E5E2DA;padding-top:20px;">
    Niche Scanner · ${dateShort} · ${metadata.totalChannelsScanned || 0} scanned · ~${metadata.quotaUsed || 0}/10k API quota · Power Media Holdings B.V.
  </div>

</div>
</body>
</html>`;
}

module.exports = { generateDashboard, writeDashboard, generateEmailHtml, generateEmailSummary };
