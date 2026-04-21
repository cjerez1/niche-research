const fs = require('fs');
const path = require('path');

/**
 * Generate the daily markdown report from scored candidates.
 */
function generateReport(approved, rejected, metadata) {
  const date = metadata.date.toISOString().split('T')[0];
  const timestamp = metadata.date.toISOString();
  const opportunities60plus = approved.filter(c => c.score.totalScore >= 60);
  const historyTags = metadata.historyTags || new Map();
  const disappeared = metadata.disappeared || [];

  let md = '';

  md += `# Niche Scanner Report — ${date}\n`;
  md += `_Scan completed: ${timestamp}_\n`;
  md += `_Channels scanned: ${metadata.totalChannelsScanned}_\n`;
  md += `_Candidates after filtering: ${approved.length + rejected.length}_\n`;
  md += `_Opportunities scored 60+: ${opportunities60plus.length}_\n`;
  md += `_Quota used: ~${metadata.quotaUsed} units_\n`;
  md += '\n---\n\n';

  // Escalated opportunities first
  const escalated = approved.filter(c => c.escalate.escalate);
  if (escalated.length > 0) {
    md += '## ESCALATED — IMMEDIATE ATTENTION\n\n';
    for (const c of escalated) {
      md += formatCandidate(c, true, historyTags);
    }
    md += '---\n\n';
  }

  // Top opportunities ranked by score
  md += '## TOP OPPORTUNITIES (Ranked by Score)\n\n';
  const topOpportunities = approved.filter(c => c.score.totalScore >= 40);

  if (topOpportunities.length === 0) {
    md += '_No opportunities scoring 40+ found today. Check signals below._\n\n';
  } else {
    topOpportunities.forEach((c, i) => {
      const tags = historyTags.get(c.channelId) || [];
      const tagStr = tags.map(t => `[${t}]`).join(' ');
      md += `### ${i + 1}. ${c.channelTitle} ${tagStr}\n`;
      md += formatCandidate(c, false, historyTags);
    });
  }

  md += '---\n\n';

  // Signals to watch (scoring 20-39)
  const signals = approved.filter(c => c.score.totalScore >= 20 && c.score.totalScore < 40);
  if (signals.length > 0) {
    md += '## SIGNALS TO WATCH\n\n';
    for (const c of signals) {
      const tags = historyTags.get(c.channelId) || [];
      const tagStr = tags.length > 0 ? ` ${tags.map(t => `[${t}]`).join(' ')}` : '';
      md += `- **${c.channelTitle}**${tagStr} (Score: ${c.score.totalScore}) — `;
      md += `${c.subscriberCount} subs, ${c.ageDays} days old, `;
      md += `avg ${formatNumber(c.metrics.averageViews)} views/video\n`;
    }
    md += '\n';
  }

  md += '---\n\n';

  // Disappeared channels
  if (disappeared.length > 0) {
    md += '## DISAPPEARED CHANNELS\n\n';
    md += '_Channels present in recent scans but missing today._\n\n';
    md += '| Channel | Last Score | Last Subs | Last Seen |\n';
    md += '|---------|-----------|-----------|----------|\n';
    for (const d of disappeared) {
      md += `| ${d.channelTitle} | ${d.lastScore}/100 | ${formatNumber(d.lastSubscribers)} | ${d.lastSeen} |\n`;
    }
    md += '\n---\n\n';
  }

  // Rejected today
  md += '## REJECTED TODAY\n\n';
  if (rejected.length === 0) {
    md += '_No channels rejected._\n';
  } else {
    md += '| Channel | Reason |\n';
    md += '|---------|--------|\n';
    for (const c of rejected) {
      const reasons = c.reject.reasons.join('; ');
      md += `| ${c.channelTitle} | ${reasons} |\n`;
    }
  }

  md += '\n---\n\n';

  // Scan summary
  md += '## SCAN SUMMARY\n\n';
  md += `- Total unique channels discovered: ${metadata.totalChannelsScanned}\n`;
  md += `- Passed hard filters: ${approved.length + rejected.length}\n`;
  md += `- Auto-rejected: ${rejected.length}\n`;
  md += `- Scored opportunities: ${approved.length}\n`;
  md += `- Scoring 60+: ${opportunities60plus.length}\n`;
  md += `- Escalated: ${escalated.length}\n`;
  md += `- Disappeared: ${disappeared.length}\n`;
  md += `- API quota used: ~${metadata.quotaUsed} / 10,000 units\n`;

  return md;
}

function formatCandidate(c, isEscalated, historyTags) {
  let md = '';

  md += `**Score:** ${c.score.totalScore}/100 (${c.score.tier})\n`;

  if (isEscalated) {
    md += `**ESCALATION REASONS:**\n`;
    for (const r of c.escalate.reasons) {
      md += `- ${r}\n`;
    }
  }

  md += `**Channel:** [${c.channelTitle}](${c.channelUrl}) (${formatNumber(c.subscriberCount)} subs, ${c.ageDays} days old${c.hiddenSubs ? ', subs hidden' : ''})\n`;
  md += `**Key metrics:**\n`;
  md += `- Avg views: ${formatNumber(c.metrics.averageViews)} | Max: ${formatNumber(c.metrics.maxViews)} | Median: ${formatNumber(c.metrics.medianViews)}\n`;
  md += `- Upload frequency: ${c.uploadFrequency} videos/week\n`;
  md += `- View-to-sub ratio: ${c.metrics.viewToSubRatio}x\n`;
  md += `- Growth velocity: ~${formatNumber(c.metrics.growthVelocity)} subs/day\n`;
  md += `- Outlier videos (10x+ avg): ${c.metrics.outlierCount}\n`;

  md += `**Score breakdown:**\n`;
  const b = c.score.breakdown;
  md += `- Click potential: ${b.clickPotential}/15 | Watch-time: ${b.watchTimePotential}/15\n`;
  md += `- RPM potential: ${b.rpmPotential}/10 | Competition: ${b.competitionDensity}/10\n`;
  md += `- Production feasibility: ${b.productionFeasibility}/5 | Series potential: ${b.seriesPotential}/5\n`;

  md += `**Estimated RPM:** $${c.score.rpmEstimate[0]}-$${c.score.rpmEstimate[1]}\n`;

  // Competition landscape
  if (c.competitionLandscape) {
    const cl = c.competitionLandscape;
    if (cl.verdict) {
      // SOP verdict supersedes the legacy saturationLevel label — only show SOP line.
      md += `**Saturation Check (SOP) — Verdict:** ${cl.verdict} — ${cl.verdictReason || ''}\n`;
      md += `- Direct hits (${cl.windowDays || 30}d): ${cl.directHits} (${cl.directHitLevel})\n`;
      if (cl.topVideo) {
        md += `- Top competitor: ${cl.topVideo.title} — ${cl.topVideo.channelTitle} (${formatNumber(cl.topVideo.views)} views)\n`;
      }
    } else {
      // No SOP verdict — fall back to legacy summary line.
      md += `**Competition Landscape:** ${cl.saturationLevel} (${cl.totalCompetitors} competitors found)\n`;
    }
    md += `- Tiers: ${cl.tiers.over100k} channels 100K+ | ${cl.tiers['10k_100k']} channels 10K-100K | ${cl.tiers['1k_10k']} channels 1K-10K | ${cl.tiers.under1k} channels <1K\n`;
    if (cl.topCompetitors.length > 0) {
      md += `- Top competitors: ${cl.topCompetitors.map(tc => `${tc.title} (${formatNumber(tc.subscribers)})`).join(', ')}\n`;
    }
    md += `- Avg competitor age: ${cl.avgAge} days\n`;
  }

  // Competitor signal
  if (c.competitorSignal) {
    md += `**Competitor signal:** Found alongside "${c.competitorSignal.competitorName}" — ${c.competitorSignal.reason}\n`;
  }

  // Growth analysis (Phase 5 — only shows after 3+ days of history)
  if (c.growthAnalysis) {
    const g = c.growthAnalysis;
    md += `**Growth analysis (tracked ${g.daysTracked} days):**\n`;
    md += `- Sub growth: ${g.dailySubGrowthRate >= 0 ? '+' : ''}${g.dailySubGrowthRate} subs/day (${g.growthAcceleration})\n`;
    md += `- Projected 30-day subs: ${formatNumber(g.projectedSubscribers30d)}\n`;
    md += `- Score trajectory: ${g.scoreTrajectory}\n`;
  }

  // Faceless flag
  if (c.flags.possiblyFaceless) {
    md += `**Faceless:** Likely (based on content style) — verify manually\n`;
  } else {
    md += `**Faceless:** Uncertain — verify manually\n`;
  }

  if (c.flags.possiblyRebranded) {
    md += `**Warning:** Channel may be rebranded (creation date much earlier than first video)\n`;
  }

  // Recommended action
  if (c.score.totalScore >= 80) {
    md += `**Recommended action:** Test immediately\n`;
  } else if (c.score.totalScore >= 60) {
    md += `**Recommended action:** Research further, consider test\n`;
  } else if (c.score.totalScore >= 40) {
    md += `**Recommended action:** Monitor for growth signals\n`;
  } else {
    md += `**Recommended action:** Low priority — revisit if niche heats up\n`;
  }

  // Top performing videos
  const topVideos = [...c.videos].sort((a, b) => b.views - a.views).slice(0, 3);
  md += `**Top videos:**\n`;
  for (const v of topVideos) {
    md += `- "${v.title}" — ${formatNumber(v.views)} views (${Math.round(v.duration / 60)}min)\n`;
  }

  // Niche bends (Phase 2)
  if (c.bends && c.bends.length > 0) {
    md += `\n**Niche Bends:**\n`;
    for (const bend of c.bends) {
      md += `\n> **Bend:** ${bend.description} _(${bend.type})_\n`;
      md += `> **Base niche:** ${bend.baseNiche}\n`;
      md += `> **Target niche:** ${bend.targetNiche}\n`;
      md += `> **Why it works:** ${bend.whyItWorks}\n`;
      md += `> **Example titles:**\n`;
      for (const title of bend.exampleTitles) {
        md += `> - "${title}"\n`;
      }
      md += `> **Estimated competition:** ${bend.estimatedCompetition}\n`;
      md += `> **RPM estimate:** ${bend.rpmEstimate}\n`;
    }
  }

  md += '\n';
  return md;
}

/**
 * Write the report to disk.
 */
function writeReport(content, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const filePath = path.join(outputDir, `${date}.md`);

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Report saved to: ${filePath}`);

  return filePath;
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

module.exports = { generateReport, writeReport };
