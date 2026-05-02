const config = require('../../config/config');

const CURIOSITY_WORDS = [
  'truth', 'hidden', 'exposed', 'warning', 'banned', 'secret', 'never',
  'shocking', 'disturbing', 'terrifying', 'mystery', 'unknown', 'forgotten',
  'dangerous', 'illegal', 'controversial', 'dark side', 'untold', 'real reason',
  'they don\'t want', 'no one knows', 'what happened', 'why did', 'how did',
];

const RPM_TIERS = {
  high: {
    keywords: ['health', 'medical', 'finance', 'insurance', 'legal', 'lawyer', 'technology',
               'real estate', 'mortgage', 'investing', 'retirement', 'tax', 'credit',
               'dental', 'doctor', 'cancer', 'diabetes', 'weight loss', 'nutrition'],
    range: [15, 30],
    score: 9,
  },
  medium: {
    keywords: ['home improvement', 'food safety', 'science', 'education', 'cooking',
               'gardening', 'pest control', 'diy', 'repair', 'maintenance', 'cleaning',
               'history', 'documentary', 'nature', 'environment', 'consumer', 'product review'],
    range: [8, 15],
    score: 6,
  },
  low: {
    keywords: ['entertainment', 'gaming', 'general knowledge', 'trivia', 'comedy',
               'music', 'animation', 'memes', 'stories', 'compilation'],
    range: [3, 8],
    score: 3,
  },
};

const FACELESS_FRIENDLY = [
  'documentary', 'explained', 'narrated', 'history', 'science', 'facts',
  'exposed', 'warning', 'ancient', 'abandoned', 'mystery', 'hidden',
  'earth', 'space', 'nature', 'animation', 'ai voice',
];

/**
 * Score a candidate channel on the 6-criteria weighted model.
 * Returns normalized score (0-100), breakdown, and tier.
 */
function scoreCandidate(candidate, allCandidates) {
  const breakdown = {
    clickPotential: scoreClickPotential(candidate),
    watchTimePotential: scoreWatchTimePotential(candidate),
    rpmPotential: scoreRpmPotential(candidate),
    competitionDensity: scoreCompetitionDensity(candidate, allCandidates),
    productionFeasibility: scoreProductionFeasibility(candidate),
    seriesPotential: scoreSeriesPotential(candidate),
  };

  const weights = config.scoring.weights;
  const maxPoints = config.scoring.maxPoints;

  let rawScore = 0;
  let maxPossible = 0;
  for (const [key, weight] of Object.entries(weights)) {
    rawScore += breakdown[key] * weight;
    maxPossible += maxPoints[key] * weight;
  }

  let totalScore = Math.round((rawScore / maxPossible) * 100);

  // === NexLev bonus modifiers ===
  const nx = candidate.nexlev;
  const vq = candidate.vidiq;
  if (nx) {
    // Monetization bonus: already monetized = proven revenue niche
    if (nx.isMonetized === true) totalScore += 3;
    // Revenue signal: channel already earning $1K+/mo
    if (nx.avgMonthlyRevenue > 1000) totalScore += 2;
    // Outlier boost: significantly outperforming peers
    if (nx.outlierScore >= 3) totalScore += 5;
    else if (nx.outlierScore >= 2) totalScore += 3;
    else if (nx.outlierScore >= 1.5) totalScore += 1;
    // Cap at 100
    totalScore = Math.min(100, totalScore);
  }

  // VidIQ/Claude bonus modifiers. These are validation signals, not replacements
  // for the base scoring model.
  if (vq) {
    if (vq.outlierScore >= 3) totalScore += 4;
    else if (vq.outlierScore >= 2) totalScore += 2;
    if (vq.viewsPerHour >= 1000) totalScore += 2;
    if (vq.claudeVerdict?.verdict === 'GO') totalScore += 3;
    else if (vq.claudeVerdict?.verdict === 'BEND') totalScore += 1;
    else if (vq.claudeVerdict?.verdict === 'SKIP') totalScore -= 8;
    totalScore = Math.max(0, Math.min(100, totalScore));
  }

  let tier;
  if (totalScore >= 80) tier = 'Launch candidate';
  else if (totalScore >= 60) tier = 'Strong opportunity';
  else if (totalScore >= 40) tier = 'Monitor';
  else tier = 'Low priority';

  // Determine RPM estimate — use NexLev actual RPM if available
  let rpmEstimate;
  if (nx?.rpm) {
    rpmEstimate = [Math.round(nx.rpm * 0.8), Math.round(nx.rpm * 1.2)];
  } else {
    const rpmTier = detectRpmTier(candidate);
    rpmEstimate = rpmTier ? RPM_TIERS[rpmTier].range : [3, 8];
  }

  return { totalScore, breakdown, tier, rpmEstimate };
}

function scoreClickPotential(candidate) {
  const titles = candidate.videos.map(v => v.title.toLowerCase());
  let score = 0;

  // Curiosity/emotional trigger words
  const triggerMatches = titles.reduce((count, title) => {
    return count + CURIOSITY_WORDS.filter(w => title.includes(w)).length;
  }, 0);
  score += Math.min(5, triggerMatches); // up to 5 points

  // Question format titles (Why, How, What)
  const questionTitles = titles.filter(t =>
    /^(why|how|what|who|when|where|is |are |do |does |can |will )/i.test(t)
  ).length;
  score += Math.min(3, Math.round((questionTitles / titles.length) * 3)); // up to 3

  // Optimal title length (40-60 chars)
  const optimalLength = titles.filter(t => t.length >= 40 && t.length <= 70).length;
  score += Math.min(3, Math.round((optimalLength / titles.length) * 3)); // up to 3

  // Number usage in titles (years, amounts, counts)
  const numberTitles = titles.filter(t => /\d/.test(t)).length;
  score += Math.min(2, Math.round((numberTitles / titles.length) * 2)); // up to 2

  // View-to-impression proxy: high views on recent channel = good clickability
  if (candidate.metrics.viewToSubRatio > 5) score += 2;
  else if (candidate.metrics.viewToSubRatio > 2) score += 1;

  return Math.min(15, score);
}

function scoreWatchTimePotential(candidate) {
  let score = 0;

  // Average duration scoring (target: 8-20 minutes)
  const avgMinutes = candidate.metrics.averageDuration / 60;
  if (avgMinutes >= 8 && avgMinutes <= 20) score += 7;
  else if (avgMinutes >= 5 && avgMinutes <= 25) score += 5;
  else if (avgMinutes >= 3) score += 3;
  else score += 1;

  // Engagement proxy: views-to-subs ratio indicates people watch, not just click
  const ratio = candidate.metrics.viewToSubRatio;
  if (ratio > 10) score += 5;
  else if (ratio > 5) score += 4;
  else if (ratio > 2) score += 3;
  else if (ratio > 1) score += 2;
  else score += 1;

  // Comment engagement (comments per 1000 views across channel)
  const totalComments = candidate.videos.reduce((a, v) => a + v.comments, 0);
  const totalViews = candidate.videos.reduce((a, v) => a + v.views, 0);
  const commentRate = totalViews > 0 ? (totalComments / totalViews) * 1000 : 0;
  if (commentRate > 5) score += 3;
  else if (commentRate > 2) score += 2;
  else if (commentRate > 0.5) score += 1;

  return Math.min(15, score);
}

function scoreRpmPotential(candidate) {
  const tier = detectRpmTier(candidate);
  if (tier) return Math.min(10, RPM_TIERS[tier].score);
  return 4; // default middle-ground
}

function detectRpmTier(candidate) {
  const allText = [
    candidate.channelTitle,
    candidate.description,
    ...candidate.videos.map(v => v.title),
  ].join(' ').toLowerCase();

  for (const [tier, data] of Object.entries(RPM_TIERS)) {
    const matches = data.keywords.filter(kw => allText.includes(kw)).length;
    if (matches >= 2) return tier;
  }

  // Single keyword match — check with less confidence
  for (const [tier, data] of Object.entries(RPM_TIERS)) {
    const matches = data.keywords.filter(kw => allText.includes(kw)).length;
    if (matches >= 1) return tier;
  }

  return null;
}

function scoreCompetitionDensity(candidate, allCandidates) {
  // Count how many other candidates have significant title keyword overlap
  const candidateTitleWords = extractKeywords(candidate.videos.map(v => v.title).join(' '));

  let similarChannels = 0;
  for (const other of allCandidates) {
    if (other.channelId === candidate.channelId) continue;
    const otherWords = extractKeywords(other.videos.map(v => v.title).join(' '));
    const overlap = candidateTitleWords.filter(w => otherWords.includes(w)).length;
    const overlapRatio = overlap / Math.max(1, candidateTitleWords.length);
    if (overlapRatio > 0.3) similarChannels++;
  }

  // Fewer similar channels = higher score
  if (similarChannels === 0) return 10;
  if (similarChannels === 1) return 8;
  if (similarChannels <= 3) return 6;
  if (similarChannels <= 5) return 4;
  return 2;
}

function scoreProductionFeasibility(candidate) {
  const allText = [
    candidate.description,
    ...candidate.videos.map(v => v.title),
  ].join(' ').toLowerCase();

  const matches = FACELESS_FRIENDLY.filter(kw => allText.includes(kw)).length;
  let score = Math.min(4, matches);

  // Bonus if flagged as faceless
  if (candidate.flags.possiblyFaceless) score += 1;

  return Math.min(5, score);
}

function scoreSeriesPotential(candidate) {
  const titles = candidate.videos.map(v => v.title);
  let score = 0;

  // Check for numbered/serial titles (Part 1, #1, Episode 1, etc.)
  const serialTitles = titles.filter(t =>
    /(?:part|episode|ep|#|vol)\s*\d/i.test(t) || /\d+\s*[:.]/i.test(t)
  ).length;
  if (serialTitles >= 2) score += 2;

  // Check for consistent format pattern (similar title structure)
  const patterns = titles.map(t => {
    return t.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .slice(0, 3)
      .join(' ');
  });
  const uniquePatterns = new Set(patterns).size;
  const repetitionRatio = 1 - (uniquePatterns / Math.max(1, titles.length));
  if (repetitionRatio > 0.5) score += 2;
  else if (repetitionRatio > 0.3) score += 1;

  // Topic depth — does the niche naturally have many subtopics?
  if (titles.length >= 10) score += 1;

  return Math.min(5, score);
}

/**
 * Extract meaningful keywords from text (skip common stop words).
 */
function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'than', 'too', 'very', 'just', 'about', 'up', 'out', 'if', 'then',
    'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'we',
    'they', 'them', 'their', 'my', 'me', 'he', 'she', 'his', 'her', 'i',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  ]);

  return text.toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

module.exports = { scoreCandidate };
