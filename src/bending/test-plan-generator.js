/**
 * Stage-2 Test Plan Generator — for Launch-tier (score >= 80) candidates only.
 * Outputs the first 6 video titles + thumbnail/script direction + pass/fail KPI gates
 * so a dummy channel test can be run without further human ideation.
 */

const Anthropic = require('@anthropic-ai/sdk');

let anthropicClient = null;
function getClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

const FALLBACK_GATES = {
  impressions48h: '≥100K (kill if <100K, watch if 100K–300K, fast-track if 300K+)',
  browseFeaturesPct: '≥40% by video 6',
  bestVideoViews7d: '≥1,000 views on at least one of the first 6 videos',
  trend: 'Impressions trending up across 6 uploads',
};

async function generateTestPlan(candidate) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return staticFallback(candidate);
  }

  const topVideos = (candidate.videos || [])
    .slice()
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 5)
    .map(v => `- "${v.title}" (${(v.views || 0).toLocaleString()} views)`)
    .join('\n');

  const nx = candidate.nexlev || {};
  const niche = (nx.categories && nx.categories.join(', ')) || nx.format || 'unspecified';
  const score = candidate.score?.totalScore || 0;
  const verdict = candidate.competitionLandscape?.verdict || '';

  const prompt = `You are designing a Stage-2 dummy-channel test for a faceless YouTube niche. The goal: validate whether this format can earn impressions on a fresh channel before committing real production budget.

REFERENCE CHANNEL: "${candidate.channelTitle}"
NICHE: ${niche}
SUBSCRIBERS: ${candidate.subscriberCount || nx.subscribers || 0}
AGE: ${candidate.ageDays || nx.daysSinceStart || '?'} days
SCORE: ${score}/100
COMPETITION VERDICT: ${verdict || 'unknown'}

TOP VIDEOS (for format reference):
${topVideos || '(no videos)'}

Output a JSON test plan with this exact shape (raw JSON only, no markdown):
{
  "first6Titles": ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5", "Title 6"],
  "thumbnailDirection": "One sentence describing thumbnail style.",
  "scriptStyle": "One sentence describing voiceover/script style.",
  "expectedCtrAngle": "What hook will drive click-through?",
  "killerRiskIn6Months": "What could shut this niche down?",
  "passFailGates": {
    "impressions48h": "Threshold for the 2-min dummy upload",
    "browseFeaturesPct": "Browse Features % of traffic by video 6",
    "bestVideoViews7d": "Views target for best of first 6 in 7 days",
    "trend": "Impressions trend requirement across uploads"
  },
  "recommendation": "ENTER | WATCH | AVOID"
}

Titles must be specific, natural, and 50-80 chars. They must follow the proven format from the top videos but vary the topic.`;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object in response');
      parsed = JSON.parse(match[0]);
    }
    return {
      first6Titles: parsed.first6Titles || [],
      thumbnailDirection: parsed.thumbnailDirection || '',
      scriptStyle: parsed.scriptStyle || '',
      expectedCtrAngle: parsed.expectedCtrAngle || '',
      killerRiskIn6Months: parsed.killerRiskIn6Months || '',
      passFailGates: { ...FALLBACK_GATES, ...(parsed.passFailGates || {}) },
      recommendation: parsed.recommendation || 'WATCH',
      generatedBy: 'claude',
    };
  } catch (err) {
    console.error(`  Test plan generation failed for ${candidate.channelTitle}: ${err.message}`);
    return staticFallback(candidate);
  }
}

function staticFallback(candidate) {
  const sample = (candidate.videos || []).slice(0, 6).map(v => v.title).filter(Boolean);
  return {
    first6Titles: sample.length === 6 ? sample : [],
    thumbnailDirection: '(Manual — Claude API unavailable)',
    scriptStyle: '(Manual — Claude API unavailable)',
    expectedCtrAngle: '',
    killerRiskIn6Months: '',
    passFailGates: { ...FALLBACK_GATES },
    recommendation: 'WATCH',
    generatedBy: 'fallback',
  };
}

module.exports = { generateTestPlan };
