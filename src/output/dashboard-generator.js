const fs = require('fs');
const path = require('path');

/**
 * Generate a self-contained HTML dashboard from scored candidates.
 */
function generateDashboard(approved, rejected, metadata) {
  const date = metadata.date.toISOString().split('T')[0];
  const escalated = approved.filter(c => c.escalate?.escalate);
  const top = approved.filter(c => c.score.totalScore >= 40);
  const signals = approved.filter(c => c.score.totalScore >= 20 && c.score.totalScore < 40);
  const disappeared = metadata.disappeared || [];
  const opportunities60 = approved.filter(c => c.score.totalScore >= 60);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Niche Scanner — ${date}</title>
<style>
${getCSS()}
</style>
</head>
<body>

<!-- HEADER -->
<header class="header">
  <div class="header-title">
    <h1>NICHE SCANNER</h1>
    <span class="header-date">${formatDate(date)}</span>
  </div>
  <div class="header-stats">
    <div class="stat-box">
      <div class="stat-num">${metadata.totalChannelsScanned || 0}</div>
      <div class="stat-label">Scanned</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">${approved.length}</div>
      <div class="stat-label">Opportunities</div>
    </div>
    <div class="stat-box highlight">
      <div class="stat-num">${opportunities60.length}</div>
      <div class="stat-label">Score 60+</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">${escalated.length}</div>
      <div class="stat-label">Escalated</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">~${metadata.quotaUsed || 0}</div>
      <div class="stat-label">API Quota</div>
    </div>
  </div>
</header>

${escalated.length > 0 ? `
<!-- ESCALATED -->
<section class="section">
  <h2 class="section-title escalated-title">ESCALATED — IMMEDIATE ATTENTION</h2>
  <div class="card-grid">
    ${escalated.map(c => renderCard(c, true)).join('\n')}
  </div>
</section>
` : ''}

<!-- TOP OPPORTUNITIES -->
<section class="section">
  <h2 class="section-title">TOP OPPORTUNITIES</h2>
  <div class="controls">
    <button class="sort-btn active" data-sort="score">Score ▼</button>
    <button class="sort-btn" data-sort="revenue">Revenue ▼</button>
    <button class="sort-btn" data-sort="views">Views ▼</button>
    <button class="sort-btn" data-sort="age">Newest ▼</button>
  </div>
  <div class="card-grid" id="opportunities">
    ${top.length > 0 ? top.map(c => renderCard(c, false)).join('\n') : '<p class="empty">No opportunities scoring 40+ found today.</p>'}
  </div>
</section>

${signals.length > 0 ? `
<!-- SIGNALS TO WATCH -->
<section class="section">
  <h2 class="section-title signals-title">SIGNALS TO WATCH</h2>
  <div class="signals-list">
    ${signals.map(c => renderSignal(c)).join('\n')}
  </div>
</section>
` : ''}

${disappeared.length > 0 ? `
<!-- DISAPPEARED -->
<section class="section">
  <h2 class="section-title disappeared-title">DISAPPEARED CHANNELS</h2>
  <table class="data-table">
    <thead><tr><th>Channel</th><th>Last Score</th><th>Last Subs</th><th>Last Seen</th></tr></thead>
    <tbody>
      ${disappeared.map(d => `<tr><td>${esc(d.channelTitle)}</td><td>${d.lastScore}/100</td><td>${fmtNum(d.lastSubscribers)}</td><td>${d.lastSeen}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>
` : ''}

${rejected.length > 0 ? `
<!-- REJECTED -->
<section class="section">
  <details>
    <summary class="section-title rejected-title">REJECTED TODAY (${rejected.length})</summary>
    <table class="data-table">
      <thead><tr><th>Channel</th><th>Reason</th></tr></thead>
      <tbody>
        ${rejected.map(c => `<tr><td>${esc(c.channelTitle)}</td><td>${esc(c.reject.reasons.join('; '))}</td></tr>`).join('\n')}
      </tbody>
    </table>
  </details>
</section>
` : ''}

<!-- FOOTER -->
<footer class="footer">
  <p>Niche Scanner V2 — ${date} — Quota: ~${metadata.quotaUsed || 0}/10,000</p>
</footer>

<script>
${getJS()}
</script>
</body>
</html>`;

  return html;
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
  const escalated = approved.filter(c => c.escalate?.escalate);
  const top = approved.filter(c => c.score.totalScore >= 40);
  const opportunities60 = approved.filter(c => c.score.totalScore >= 60);
  const disappeared = metadata.disappeared || [];

  // Email version: simplified, no JS, inline styles where needed
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getCSS()}</style></head><body>`;

  html += `<header class="header"><div class="header-title"><h1>NICHE SCANNER</h1><span class="header-date">${formatDate(date)}</span></div>`;
  html += `<div class="header-stats">`;
  html += `<div class="stat-box"><div class="stat-num">${metadata.totalChannelsScanned || 0}</div><div class="stat-label">Scanned</div></div>`;
  html += `<div class="stat-box highlight"><div class="stat-num">${opportunities60.length}</div><div class="stat-label">Score 60+</div></div>`;
  html += `<div class="stat-box"><div class="stat-num">${escalated.length}</div><div class="stat-label">Escalated</div></div>`;
  html += `</div></header>`;

  if (escalated.length > 0) {
    html += `<section class="section"><h2 class="section-title escalated-title">ESCALATED</h2><div class="card-grid">`;
    html += escalated.map(c => renderCard(c, true)).join('');
    html += `</div></section>`;
  }

  html += `<section class="section"><h2 class="section-title">TOP OPPORTUNITIES</h2><div class="card-grid">`;
  if (top.length > 0) {
    html += top.map(c => renderCard(c, false)).join('');
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

module.exports = { generateDashboard, writeDashboard, generateEmailHtml };
