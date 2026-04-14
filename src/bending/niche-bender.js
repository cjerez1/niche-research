/**
 * Niche Bending Engine — suggests 2-3 twisted angles for high-scoring opportunities.
 * Purely rule-based, no API calls.
 */

// Narrative/rhetorical words that appear frequently in clickbait titles
// but are NOT actual topics. Must be filtered before topic extraction.
const NARRATIVE_WORDS = new Set([
  'revealed', 'reveals', 'reveal', 'exposed', 'exposing', 'expose',
  'hidden', 'secret', 'secrets', 'truth', 'banned', 'shocking',
  'disturbing', 'terrifying', 'dangerous', 'mysterious', 'unknown',
  'strange', 'weird', 'warning', 'finally', 'actually', 'really',
  'nobody', 'everyone', 'everything', 'nothing', 'discovered',
  'forgotten', 'controversial', 'illegal', 'untold', 'impossible',
  'incredible', 'unbelievable', 'insane', 'crazy', 'entire', 'world',
  'shocked', 'prove', 'proved', 'proven', 'wrong', 'right', 'real',
  'fake', 'true', 'false', 'explain', 'explained', 'explaining',
  'thought', 'think', 'knew', 'know', 'knows', 'known', 'told',
  'said', 'says', 'made', 'make', 'makes', 'came', 'come', 'comes',
  'found', 'find', 'finding', 'show', 'shows', 'showed', 'showing',
  'looked', 'look', 'looks', 'looking', 'want', 'wants', 'wanted',
  'need', 'needs', 'needed', 'took', 'take', 'takes', 'taking',
  'gave', 'give', 'gives', 'went', 'goes', 'going', 'gone',
  'turned', 'turn', 'turns', 'left', 'called', 'call', 'calls',
  'changed', 'change', 'changes', 'story', 'stories', 'happened',
  'happens', 'happening', 'years', 'year', 'days', 'time', 'times',
  'people', 'person', 'things', 'thing', 'fact', 'facts', 'reason',
  'reasons', 'part', 'full', 'ever', 'back', 'just', 'like',
  'documentary', 'history', 'archive', 'channel', 'video', 'videos',
  'subscribe', 'share', 'comment', 'episode', 'series',
]);

const STOP_WORDS = new Set([
  'the', 'and', 'but', 'for', 'are', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may',
  'new', 'now', 'old', 'see', 'way', 'who', 'did', 'get', 'got', 'let',
  'say', 'she', 'too', 'use', 'yes', 'yet', 'why', 'try', 'own', 'any',
  'few', 'off', 'set', 'two', 'run', 'put', 'end', 'big', 'ago', 'far',
  'this', 'that', 'them', 'they', 'their', 'there', 'these', 'those',
  'with', 'from', 'about', 'were', 'been', 'have', 'will', 'your',
  'more', 'most', 'than', 'very', 'what', 'when', 'where',
  'which', 'while', 'would', 'could', 'should', 'into', 'only',
  'also', 'then', 'each', 'every', 'does', 'here', 'even', 'after',
  'before', 'over', 'under', 'between', 'never', 'still',
]);

const BEND_TEMPLATES = [
  // === FORMAT TRANSFERS ===
  {
    type: 'format_transfer',
    name: 'Documentary → Home/DIY',
    sourcePatterns: ['documentary', 'explained', 'history', 'science'],
    targetNiche: 'home improvement / DIY',
    rpmEstimate: '$8-$15',
    competition: 'Low',
    generateTitles: (niche) => [
      `The Dark History of ${niche} That Builders Won't Tell You`,
      `Why ${niche} Was Banned in 14 Countries — The Real Reason`,
      `The $1 Fix That Stops ${niche} Damage Forever (Experts Exposed)`,
    ],
    why: 'Documentary-style storytelling drives watch time. Home/DIY has high RPM from advertiser demand. Very few channels combine both.',
  },
  {
    type: 'format_transfer',
    name: 'Exposé → Food Safety',
    sourcePatterns: ['exposed', 'truth', 'warning', 'secret', 'hidden'],
    targetNiche: 'food safety / health',
    rpmEstimate: '$15-$30',
    competition: 'Medium',
    generateTitles: (niche) => [
      `${niche} in Your Food Is Slowly Poisoning You — Exposed`,
      `Supermarkets Don't Want You to Know This About ${niche}`,
      `WARNING: The ${niche} Cover-Up in Your Kitchen`,
    ],
    why: 'Exposé format drives massive clicks through outrage/curiosity. Food/health niches command top RPM rates. Proven combo (see Aussie Exposed channel).',
  },
  {
    type: 'format_transfer',
    name: 'Mystery → Science',
    sourcePatterns: ['mystery', 'mysterious', 'unknown', 'strange', 'weird'],
    targetNiche: 'earth science / nature',
    rpmEstimate: '$8-$15',
    competition: 'Low',
    generateTitles: (niche) => [
      `Scientists Can't Explain What ${niche} Is Doing to the Earth`,
      `The Mysterious ${niche} Phenomenon That Defies Physics`,
      `This ${niche} Discovery Was Buried for 50 Years — Here's Why`,
    ],
    why: 'Mystery/curiosity framing transforms dry science into must-click content. Earth science has strong series potential with medium RPM.',
  },
  {
    type: 'format_transfer',
    name: 'Investigation → Corporate/Consumer',
    sourcePatterns: ['crime', 'investigation', 'case', 'evidence', 'cover'],
    targetNiche: 'corporate exposé / consumer protection',
    rpmEstimate: '$10-$20',
    competition: 'Low',
    generateTitles: (niche) => [
      `The ${niche} Scandal They Tried to Bury`,
      `Inside the ${niche} Cover-Up: What They Don't Want You to Know`,
      `How the ${niche} Industry Got Away With It for 20 Years`,
    ],
    why: 'Investigation format applied to corporate malfeasance. Avoids saturated true crime niche while keeping the tension/mystery hooks.',
  },

  // === AUDIENCE CROSS-POLLINATION ===
  {
    type: 'audience_cross',
    name: 'History → Prepper/Survivalist',
    sourcePatterns: ['history', 'ancient', 'civilization', 'empire', 'collapse'],
    targetNiche: 'survival / prepper',
    rpmEstimate: '$8-$15',
    competition: 'Low',
    generateTitles: (niche) => [
      `How Ancient ${niche} Knowledge Could Save Your Life When Society Collapses`,
      `The ${niche} Survival Technique the Government Doesn't Want You to Learn`,
      `Every Empire That Ignored ${niche} Collapsed — We're Next`,
    ],
    why: 'History content targeted at survivalist audience. Preppers are engaged, high-watch-time viewers. Historical parallels create urgency.',
  },
  {
    type: 'audience_cross',
    name: 'Science → Parents/Family',
    sourcePatterns: ['science', 'research', 'study', 'brain', 'health', 'body', 'genetic', 'dna'],
    targetNiche: 'parenting / family health',
    rpmEstimate: '$15-$25',
    competition: 'Low',
    generateTitles: (niche) => [
      `What ${niche} Research Reveals About Your Child's Future`,
      `Scientists Warn: ${niche} Is Changing Your Kids — And Nobody's Talking About It`,
      `The ${niche} Secret Every Parent Needs to Know Before It's Too Late`,
    ],
    why: 'Science content reframed for parents. Parenting niche has extremely high RPM. Parents click on child safety/development content compulsively.',
  },
  {
    type: 'audience_cross',
    name: 'Technology → Seniors',
    sourcePatterns: ['technology', 'tech', 'gadget', 'device', 'app', 'phone'],
    targetNiche: 'seniors / over 50s',
    rpmEstimate: '$10-$20',
    competition: 'Low',
    generateTitles: (niche) => [
      `${niche} Has a Secret Feature You Never Knew About (Over 50s Guide)`,
      `Stop Getting Scammed: The ${niche} Trick Everyone Over 60 Must Know`,
      `Why ${niche} Was Designed to Confuse You — And How to Fix It`,
    ],
    why: 'Tech content for seniors is massively underserved. High RPM (insurance, health, finance ads target this demo). Low competition.',
  },

  // === EMOTIONAL REFRAMES ===
  {
    type: 'emotional_reframe',
    name: 'DNA vs. History (Confrontational)',
    sourcePatterns: ['dna', 'genetic', 'ancestry', 'genome', 'gene'],
    targetNiche: 'same topic, confrontational framing',
    rpmEstimate: 'Same RPM, 2-3x clicks',
    competition: 'Low',
    generateTitles: (niche) => [
      `${niche} Just Proved Historians Were Wrong About Everything`,
      `Ancient ${niche} Evidence Destroyed the Textbook Narrative`,
      `The ${niche} Results They Tried to Suppress — Now Released`,
    ],
    why: '"DNA contradicts official history" framing adds conspiracy-adjacent tension without being conspiracy. Same content, dramatically higher CTR. OriginDecoder uses this angle.',
  },
  {
    type: 'emotional_reframe',
    name: 'Educational → Outrage',
    sourcePatterns: ['explained', 'how', 'what', 'history of', 'the story'],
    targetNiche: 'same topic, outrage framing',
    rpmEstimate: 'Same RPM, 2-3x clicks',
    competition: 'Medium',
    generateTitles: (niche) => [
      `Why the ${niche} Truth Should Make You Furious`,
      `They Lied About ${niche} for Decades — Here's the Proof`,
      `${niche} Was Covered Up for a Disturbing Reason`,
    ],
    why: 'Same content, stronger emotional hook. Outrage framing increases CTR 2-3x over neutral educational framing. Retains same audience.',
  },
  {
    type: 'emotional_reframe',
    name: 'Educational → Fear/Urgency',
    sourcePatterns: ['explained', 'science', 'nature', 'earth', 'environment'],
    targetNiche: 'same topic, urgency framing',
    rpmEstimate: 'Same RPM, higher CTR',
    competition: 'Medium',
    generateTitles: (niche) => [
      `${niche} Is Changing Right Now and No One Is Talking About It`,
      `You Have 10 Years Before ${niche} Rewrites Everything`,
      `WARNING: What Scientists Found About ${niche} Should Terrify You`,
    ],
    why: 'Urgency framing transforms passive educational content into must-watch content. Same production, dramatically higher CTR.',
  },
  {
    type: 'emotional_reframe',
    name: 'Informational → Personal Stakes',
    sourcePatterns: ['product', 'review', 'consumer', 'buying', 'cost'],
    targetNiche: 'same topic, personal impact framing',
    rpmEstimate: 'Same RPM, higher engagement',
    competition: 'Low',
    generateTitles: (niche) => [
      `${niche} Is Costing You Thousands — And You Don't Even Know`,
      `The ${niche} Mistake 90% of People Make (Are You One of Them?)`,
      `I Tested Every ${niche} Option — One Clear Winner (Saves You $$$)`,
    ],
    why: 'Making content personally relevant to the viewer increases watch time and engagement. "This affects YOU" beats "here are the facts."',
  },

  // === GEOGRAPHIC LOCALIZATION ===
  {
    type: 'geographic',
    name: 'US Format → Australian Market',
    sourcePatterns: ['food', 'health', 'consumer', 'exposed', 'warning', 'product'],
    targetNiche: 'Australian audience',
    rpmEstimate: '$10-$20 (AU market)',
    competition: 'Low',
    generateTitles: (niche) => [
      `Australian ${niche} Exposed: What Woolworths Won't Tell You`,
      `Why ${niche} Is Banned in 30 Countries But Legal in Australia`,
      `Aussie ${niche} Warning: The Truth About What You're Buying`,
    ],
    why: 'US-proven formats adapted for AU audience. Less competition in AU market. Proven model (Aussie Exposed, Food Flip already working).',
  },
  {
    type: 'geographic',
    name: 'US Format → UK Market',
    sourcePatterns: ['food', 'health', 'consumer', 'exposed', 'home', 'history'],
    targetNiche: 'UK audience',
    rpmEstimate: '$12-$22 (UK market)',
    competition: 'Low',
    generateTitles: (niche) => [
      `The ${niche} Truth About Britain They Don't Want You to Know`,
      `Why the NHS Is Warning About ${niche} — And Nobody Listens`,
      `UK ${niche} Exposed: What Tesco Won't Tell You`,
    ],
    why: 'UK market has high RPM (strong pound, premium advertisers). Same English language, just localized references. Very few faceless channels targeting UK specifically.',
  },

  // === HYBRID TOPICS ===
  {
    type: 'hybrid',
    name: 'History + Conspiracy',
    sourcePatterns: ['history', 'ancient', 'hidden', 'forgotten', 'lost'],
    targetNiche: 'alternative history / conspiracy-adjacent',
    rpmEstimate: '$5-$12',
    competition: 'Medium',
    generateTitles: (niche) => [
      `The ${niche} Site They Don't Want You to See on Google Maps`,
      `Historians Refuse to Explain This ${niche} Discovery — So We Did`,
      `${niche} Evidence Was Removed From Every Textbook — Here's Why`,
    ],
    why: 'Alternative history content gets massive engagement. Combining real history with mystery/conspiracy hooks drives clicks while maintaining credibility.',
  },
  {
    type: 'hybrid',
    name: 'Science + Horror',
    sourcePatterns: ['science', 'nature', 'ocean', 'deep', 'space', 'earth'],
    targetNiche: 'science horror / cosmic dread',
    rpmEstimate: '$5-$10',
    competition: 'Low',
    generateTitles: (niche) => [
      `What ${niche} Scientists Found at the Bottom of the Ocean Will Haunt You`,
      `The Most Terrifying ${niche} Discovery Ever Made`,
      `Scientists Opened a ${niche} Chamber — And Immediately Wished They Hadn't`,
    ],
    why: 'Horror framing on science content creates a unique niche with obsessive rewatch behavior. Low competition, strong thumbnail potential.',
  },
  {
    type: 'hybrid',
    name: 'Health + Finance',
    sourcePatterns: ['health', 'medical', 'doctor', 'hospital', 'food', 'nutrition'],
    targetNiche: 'health economics / medical costs',
    rpmEstimate: '$20-$35',
    competition: 'Low',
    generateTitles: (niche) => [
      `Why ${niche} Treatment Costs $50,000 in America But $50 Everywhere Else`,
      `The ${niche} Industry Is Stealing From You — Here's How`,
      `Exposed: How ${niche} Companies Keep You Sick for Profit`,
    ],
    why: 'Health + finance is the highest RPM niche combination possible. Both verticals attract premium advertisers. Very few channels combine them.',
  },
  {
    type: 'hybrid',
    name: 'Pest Control + Property',
    sourcePatterns: ['home', 'house', 'building', 'property', 'maintenance', 'pest'],
    targetNiche: 'pest control / property protection',
    rpmEstimate: '$10-$20',
    competition: 'Low',
    generateTitles: (niche) => [
      `The $1 Fix That Kills ${niche} Pests Permanently (Companies Hate This)`,
      `Your ${niche} Property Has THIS Problem Right Now — Check Immediately`,
      `Why Pest Control Companies Don't Want You to Know About This ${niche} Method`,
    ],
    why: 'Pest control + property protection targets homeowners (high-value demo). Shared advertiser base between home services and insurance. Leverages Claudio\'s pest control expertise.',
  },
];

/**
 * Generate 2-3 niche bend suggestions for a high-scoring candidate.
 */
function generateBends(candidate) {
  const niche = detectCandidateNiche(candidate);
  const matchedTemplates = matchBendTemplates(niche, candidate);
  return matchedTemplates.slice(0, 3);
}

// Common acronyms that should be fully uppercased
const ACRONYMS = new Set([
  'dna', 'uk', 'us', 'usa', 'nasa', 'cia', 'fbi', 'nhs', 'ceo', 'cfo',
  'ai', 'ufo', 'ufos', 'fda', 'epa', 'gmo', 'gmos', 'hiv', 'aids',
  'adhd', 'ptsd', 'bpa', 'pfas', 'mrna', 'irs', 'diy', 'nyc', 'la',
  'wwi', 'wwii', 'nato', 'opec', 'isis', 'nsa', 'dea', 'atf',
]);

/**
 * Capitalize a word properly — handles acronyms (DNA, UK, USA) and normal words.
 */
function capitalizeWord(word) {
  if (ACRONYMS.has(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Detect the candidate's primary niche from their content.
 * Filters out narrative/rhetorical words to find actual subject matter nouns.
 */
function detectCandidateNiche(candidate) {
  const allText = [
    candidate.channelTitle,
    candidate.description,
    ...candidate.videos.map(v => v.title),
  ].join(' ').toLowerCase();

  const words = allText
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const freq = {};
  for (const w of words) {
    if (STOP_WORDS.has(w) || NARRATIVE_WORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  // Get top topic words — these should be actual subjects (DNA, Viking, Egyptian, etc.)
  const topTopics = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => capitalizeWord(word));

  // Build a readable niche label from top 2-3 topics
  const nicheLabel = topTopics.slice(0, 3).join(' / ');

  return { topTopics, nicheLabel, allText };
}

/**
 * Match bend templates against the candidate's detected niche.
 */
function matchBendTemplates(niche, candidate) {
  const bends = [];
  // Build a niche phrase for title insertion (e.g., "DNA Ancestry" or "Ancient Egyptian")
  const nichePhrase = niche.topTopics.slice(0, 2).join(' ');

  for (const template of BEND_TEMPLATES) {
    const matchCount = template.sourcePatterns.filter(p =>
      niche.allText.includes(p)
    ).length;

    if (matchCount === 0) continue;

    const titles = template.generateTitles(nichePhrase || 'This Topic');

    bends.push({
      description: template.name,
      type: template.type.replace('_', ' '),
      baseNiche: `${niche.nicheLabel}`,
      targetNiche: template.targetNiche,
      whyItWorks: template.why,
      exampleTitles: titles,
      estimatedCompetition: template.competition,
      rpmEstimate: template.rpmEstimate,
      matchStrength: matchCount,
    });
  }

  bends.sort((a, b) => b.matchStrength - a.matchStrength);
  return diversifyBends(bends);
}

/**
 * Ensure bend suggestions include different types when possible.
 */
function diversifyBends(bends) {
  if (bends.length <= 3) return bends;

  const selected = [];
  const usedTypes = new Set();

  for (const bend of bends) {
    if (selected.length >= 3) break;
    if (!usedTypes.has(bend.type)) {
      selected.push(bend);
      usedTypes.add(bend.type);
    }
  }

  for (const bend of bends) {
    if (selected.length >= 3) break;
    if (!selected.includes(bend)) {
      selected.push(bend);
    }
  }

  return selected;
}

module.exports = { generateBends };
