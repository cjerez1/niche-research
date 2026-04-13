const saturatedNiches = require('../../data/saturated-niches.json');

/**
 * Check if a candidate should be auto-escalated (flagged for immediate attention).
 */
function checkEscalateTriggers(candidate, allCandidates) {
  const reasons = [];

  // Trigger 1: Very new channel with viral video
  if (candidate.ageDays < 14 && candidate.metrics.maxViews > 100000) {
    reasons.push(`Channel is only ${candidate.ageDays} days old with a video at ${formatNumber(candidate.metrics.maxViews)} views`);
  }

  // Trigger 2: New channel with multiple strong videos
  if (candidate.ageDays < 30) {
    const strongVideos = candidate.videos.filter(v => v.views > 50000);
    if (strongVideos.length >= 3) {
      reasons.push(`${strongVideos.length} videos over 50K views on a ${candidate.ageDays}-day-old channel`);
    }
  }

  // Trigger 3: Niche cluster detection
  if (allCandidates) {
    const nicheCluster = detectNicheCluster(candidate, allCandidates);
    if (nicheCluster) {
      reasons.push(`Niche cluster detected: ${nicheCluster.count} channels in "${nicheCluster.niche}" niche`);
    }
  }

  // Trigger 4: High RPM niche with low competition
  // (checked via score data — this trigger fires if RPM score >= 8 and competition score >= 8)

  return {
    escalate: reasons.length > 0,
    reasons,
  };
}

/**
 * Check if a candidate should be auto-rejected.
 */
function checkRejectTriggers(candidate) {
  const reasons = [];

  // Trigger 1: Not faceless
  if (candidate.flags.possiblyFaceless === false) {
    reasons.push('Channel does not appear to be faceless format');
  }

  // Trigger 2: Not English
  if (candidate.flags.englishConfidence < 0.5) {
    reasons.push(`Low English confidence: ${Math.round(candidate.flags.englishConfidence * 100)}%`);
  }

  // Trigger 3: Saturated niche match
  const satMatch = checkSaturatedNiche(candidate);
  if (satMatch) {
    reasons.push(`Saturated niche: ${satMatch}`);
  }

  // Trigger 4: Reupload/stolen content detection
  if (checkReuploadSignals(candidate)) {
    reasons.push('Possible reupload/stolen content detected');
  }

  return {
    reject: reasons.length > 0,
    reasons,
  };
}

/**
 * Check if channel content matches a saturated niche.
 * Uses phrase matching — "war documentary" must appear as phrase, not individual words.
 */
function checkSaturatedNiche(candidate) {
  const titles = candidate.videos.map(v => v.title.toLowerCase());
  const allTitles = titles.join(' | ');

  for (const niche of saturatedNiches) {
    let matchingTitles = 0;

    for (const title of titles) {
      const hasMatch = niche.keywords.some(kw => title.includes(kw));
      if (hasMatch) matchingTitles++;
    }

    // If more than 40% of titles match a saturated niche phrase, reject
    if (titles.length > 0 && (matchingTitles / titles.length) > 0.4) {
      return niche.label;
    }
  }

  return null;
}

/**
 * Simple reupload/stolen content heuristic.
 */
function checkReuploadSignals(candidate) {
  const titles = candidate.videos.map(v => v.title.toLowerCase());

  // Check for "reupload", "re-upload", "credit to" patterns
  const reuploadSignals = titles.filter(t =>
    t.includes('reupload') || t.includes('re-upload') || t.includes('re upload') ||
    t.includes('credit to') || t.includes('original by') || t.includes('not mine')
  );

  return reuploadSignals.length >= 2;
}

/**
 * Detect if multiple unrelated channels appear in the same niche.
 */
function detectNicheCluster(candidate, allCandidates) {
  if (allCandidates.length < 3) return null;

  // Extract top keywords from this candidate's titles
  const myKeywords = extractTopKeywords(candidate.videos.map(v => v.title).join(' '));
  if (myKeywords.length === 0) return null;

  let clusterCount = 0;
  const clusterChannels = [];

  for (const other of allCandidates) {
    if (other.channelId === candidate.channelId) continue;
    const otherKeywords = extractTopKeywords(other.videos.map(v => v.title).join(' '));
    const overlap = myKeywords.filter(kw => otherKeywords.includes(kw)).length;
    if (overlap >= 2) {
      clusterCount++;
      clusterChannels.push(other.channelTitle);
    }
  }

  if (clusterCount >= 2) {
    return {
      count: clusterCount + 1, // include the candidate itself
      niche: myKeywords.slice(0, 3).join('/'),
      channels: clusterChannels,
    };
  }

  return null;
}

function extractTopKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'and', 'but', 'or', 'not',
    'this', 'that', 'it', 'you', 'we', 'they', 'how', 'what', 'why', 'who',
    'when', 'where', 'which', 'will', 'can', 'has', 'have', 'had', 'do',
    'does', 'did', 'about', 'just', 'more', 'most', 'very', 'than',
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Return top 5 by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

module.exports = { checkEscalateTriggers, checkRejectTriggers };
