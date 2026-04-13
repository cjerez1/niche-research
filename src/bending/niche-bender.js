/**
 * Niche Bending Engine — suggests 2-3 twisted angles for high-scoring opportunities.
 * Purely rule-based, no API calls.
 */

const BEND_TEMPLATES = [
  // === FORMAT TRANSFERS ===
  {
    type: 'format_transfer',
    name: 'Documentary → Home/DIY',
    sourcePatterns: ['documentary', 'explained', 'history', 'science'],
    targetNiche: 'home improvement / DIY',
    rpmEstimate: '$8-$15',
    competition: 'Low',
    generateTitles: (topics) => [
      `The Dark History of ${topics[0] || 'Your Home'} That Builders Won't Tell You`,
      `Why ${topics[0] || 'This Common Material'} Was Banned in 14 Countries`,
      `The $1 Fix That Stops ${topics[0] || 'Home Damage'} Forever (Experts Exposed)`,
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
    generateTitles: (topics) => [
      `This ${topics[0] || 'Popular Food'} Is Slowly Poisoning You — Exposed`,
      `Supermarkets Don't Want You to Know This About ${topics[0] || 'Your Groceries'}`,
      `WARNING: The Truth About ${topics[0] || 'Everyday Foods'} Finally Revealed`,
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
    generateTitles: (topics) => [
      `Scientists Can't Explain What's Happening to ${topics[0] || 'the Earth'}`,
      `The Mysterious ${topics[0] || 'Phenomenon'} That Defies Physics`,
      `This ${topics[0] || 'Discovery'} Was Buried for 50 Years — Here's Why`,
    ],
    why: 'Mystery/curiosity framing transforms dry science into must-click content. Earth science has strong series potential with medium RPM.',
  },
  {
    type: 'format_transfer',
    name: 'True Crime → Corporate/Consumer',
    sourcePatterns: ['crime', 'investigation', 'case', 'evidence', 'cover up'],
    targetNiche: 'corporate exposé / consumer protection',
    rpmEstimate: '$10-$20',
    competition: 'Low',
    generateTitles: (topics) => [
      `The ${topics[0] || 'Company'} Scandal They Tried to Bury`,
      `Inside the ${topics[0] || 'Industry'} Cover-Up: What They Don't Want You to Know`,
      `How ${topics[0] || 'This Brand'} Got Away With It for 20 Years`,
    ],
    why: 'True crime investigation format applied to corporate malfeasance. Avoids saturated true crime niche while keeping the tension/mystery hooks.',
  },

  // === AUDIENCE CROSS-POLLINATION ===
  {
    type: 'audience_cross',
    name: 'History → Prepper/Survivalist',
    sourcePatterns: ['history', 'ancient', 'civilization', 'empire', 'collapse'],
    targetNiche: 'survival / prepper',
    rpmEstimate: '$8-$15',
    competition: 'Low',
    generateTitles: (topics) => [
      `How ${topics[0] || 'Ancient Civilizations'} Survived What's Coming Next`,
      `The ${topics[0] || 'Lost Technique'} That Could Save Your Life When Society Collapses`,
      `Every Empire Fell the Same Way — And We're Doing It Again`,
    ],
    why: 'History content targeted at survivalist audience. Preppers are engaged, high-watch-time viewers. Historical parallels create urgency.',
  },
  {
    type: 'audience_cross',
    name: 'Science → Parents/Family',
    sourcePatterns: ['science', 'research', 'study', 'brain', 'health', 'body'],
    targetNiche: 'parenting / family health',
    rpmEstimate: '$15-$25',
    competition: 'Low',
    generateTitles: (topics) => [
      `What ${topics[0] || 'This Research'} Reveals About Your Child's Brain`,
      `Scientists Warn: ${topics[0] || 'This Common Habit'} Is Changing Your Kids Forever`,
      `The ${topics[0] || 'Science'} Every Parent Needs to Know Before It's Too Late`,
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
    generateTitles: (topics) => [
      `${topics[0] || 'Your Phone'} Has a Secret Feature You Never Knew About (Over 50s Guide)`,
      `Stop Getting Scammed: The ${topics[0] || 'Tech'} Trick Everyone Over 60 Must Know`,
      `Why ${topics[0] || 'This Device'} Was Designed to Confuse You — And How to Fix It`,
    ],
    why: 'Tech content for seniors is massively underserved. High RPM (insurance, health, finance ads target this demo). Low competition.',
  },

  // === EMOTIONAL REFRAMES ===
  {
    type: 'emotional_reframe',
    name: 'Educational → Outrage',
    sourcePatterns: ['explained', 'how', 'what', 'history of', 'the story'],
    targetNiche: 'same topic, outrage framing',
    rpmEstimate: 'Same RPM, 2-3x clicks',
    competition: 'Medium',
    generateTitles: (topics) => [
      `Why ${topics[0] || 'This'} Should Make You Furious`,
      `They Lied About ${topics[0] || 'Everything'} — Here's the Proof`,
      `${topics[0] || 'This'} Was Banned for a Disturbing Reason`,
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
    generateTitles: (topics) => [
      `${topics[0] || 'This'} Is Happening Right Now and No One Is Talking About It`,
      `You Have 10 Years Before ${topics[0] || 'This'} Changes Everything`,
      `WARNING: ${topics[0] || 'What Scientists Found'} Should Terrify You`,
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
    generateTitles: (topics) => [
      `${topics[0] || 'This Product'} Is Costing You Thousands — And You Don't Even Know`,
      `The ${topics[0] || 'Buying'} Mistake 90% of People Make (Are You One of Them?)`,
      `I Tested ${topics[0] || 'Every Option'} — One Clear Winner (Saves You $$$)`,
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
    generateTitles: (topics) => [
      `Australian Supermarkets Exposed: The ${topics[0] || 'Truth'} About What You're Buying`,
      `Why ${topics[0] || 'This'} Is Banned in 30 Countries But Legal in Australia`,
      `Aussie ${topics[0] || 'Health'} Warning: What Woolworths and Coles Won't Tell You`,
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
    generateTitles: (topics) => [
      `The ${topics[0] || 'Truth'} About British ${topics[1] || 'Products'} They Don't Want You to Know`,
      `Why the NHS Is Warning About ${topics[0] || 'This'} — And Nobody Listens`,
      `UK ${topics[0] || 'Consumer'} Exposed: What Tesco Won't Tell You`,
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
    generateTitles: (topics) => [
      `The ${topics[0] || 'Ancient Structure'} They Don't Want You to See on Google Maps`,
      `Historians Refuse to Explain ${topics[0] || 'This Discovery'} — So We Did`,
      `${topics[0] || 'This Evidence'} Was Removed From Every Textbook — Here's Why`,
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
    generateTitles: (topics) => [
      `What Lives at the Bottom of ${topics[0] || 'the Ocean'} Will Haunt Your Dreams`,
      `The Most Terrifying ${topics[0] || 'Discovery'} Science Has Ever Made`,
      `Scientists Opened ${topics[0] || 'This'} — And Immediately Wished They Hadn't`,
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
    generateTitles: (topics) => [
      `Why ${topics[0] || 'This Treatment'} Costs $50,000 in America But $50 Everywhere Else`,
      `The ${topics[0] || 'Health'} Industry Is Stealing From You — Here's How`,
      `Exposed: How ${topics[0] || 'Pharma Companies'} Keep You Sick for Profit`,
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
    generateTitles: (topics) => [
      `The $1 Fix That Kills ${topics[0] || 'Termites'} Permanently (Pest Companies Hate This)`,
      `Your ${topics[0] || 'Home'} Has THIS Problem Right Now — Check Before It's Too Late`,
      `Why Pest Control Companies Don't Want You to Know About ${topics[0] || 'This Method'}`,
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

  // Return top 3 (or fewer if not enough matches)
  return matchedTemplates.slice(0, 3);
}

/**
 * Detect the candidate's primary niche from their content.
 */
function detectCandidateNiche(candidate) {
  const allText = [
    candidate.channelTitle,
    candidate.description,
    ...candidate.videos.map(v => v.title),
  ].join(' ').toLowerCase();

  // Extract top topic words
  const words = allText
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);

  const freq = {};
  const stopWords = new Set([
    'this', 'that', 'them', 'they', 'their', 'there', 'these', 'those',
    'with', 'from', 'about', 'were', 'been', 'have', 'will', 'your',
    'more', 'most', 'just', 'than', 'very', 'what', 'when', 'where',
    'which', 'while', 'would', 'could', 'should', 'into', 'only',
    'also', 'then', 'each', 'every', 'does', 'here', 'even', 'after',
    'before', 'over', 'under', 'between', 'never', 'still', 'video',
    'channel', 'subscribe', 'like', 'share', 'comment',
  ]);

  for (const w of words) {
    if (!stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  const topTopics = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

  return { topTopics, allText };
}

/**
 * Match bend templates against the candidate's detected niche.
 * Returns scored and sorted bend objects.
 */
function matchBendTemplates(niche, candidate) {
  const bends = [];

  for (const template of BEND_TEMPLATES) {
    // Count how many source patterns match the candidate's content
    const matchCount = template.sourcePatterns.filter(p =>
      niche.allText.includes(p)
    ).length;

    if (matchCount === 0) continue;

    // Use top keywords (capitalized single words) for clean title insertion
    const titles = template.generateTitles(niche.topTopics);

    const primaryTopic = niche.topTopics[0] || 'Topic';

    bends.push({
      description: template.name,
      type: template.type.replace('_', ' '),
      baseNiche: `${primaryTopic} / ${candidate.channelTitle}`,
      targetNiche: template.targetNiche,
      whyItWorks: template.why,
      exampleTitles: titles,
      estimatedCompetition: template.competition,
      rpmEstimate: template.rpmEstimate,
      matchStrength: matchCount,
    });
  }

  // Sort by match strength (most relevant first), then by type diversity
  bends.sort((a, b) => b.matchStrength - a.matchStrength);

  // Try to include diverse bend types
  return diversifyBends(bends);
}

/**
 * Ensure bend suggestions include different types when possible.
 */
function diversifyBends(bends) {
  if (bends.length <= 3) return bends;

  const selected = [];
  const usedTypes = new Set();

  // First pass: pick best from each unique type
  for (const bend of bends) {
    if (selected.length >= 3) break;
    if (!usedTypes.has(bend.type)) {
      selected.push(bend);
      usedTypes.add(bend.type);
    }
  }

  // Second pass: fill remaining slots with best overall
  for (const bend of bends) {
    if (selected.length >= 3) break;
    if (!selected.includes(bend)) {
      selected.push(bend);
    }
  }

  return selected;
}

module.exports = { generateBends };
