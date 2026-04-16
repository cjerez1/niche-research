const path = require('path');

const config = Object.freeze({
  apiKey: process.env.YOUTUBE_API_KEY,

  search: {
    maxResultsPerQuery: 50,
    publishedAfterDays: 30,
    videoDuration: 'medium',
    relevanceLanguage: 'en',
    regionCode: 'US',
    order: 'viewCount',
  },

  filters: {
    maxChannelAgeDays: 60, // content age (first video date), not channel creation
    idealChannelAgeDays: 30,
    maxSubscribers: 10000,
    minVideosWithViews: 3,
    minViewThreshold: 1000,
    minUploadsPerWeek: 2,
    minTotalVideos: 6,
    maxCandidatesForDeepAnalysis: 100,
  },

  scoring: {
    weights: {
      clickPotential: 3,
      watchTimePotential: 3,
      rpmPotential: 2,
      competitionDensity: 2,
      productionFeasibility: 1,
      seriesPotential: 1,
    },
    maxPoints: {
      clickPotential: 15,
      watchTimePotential: 15,
      rpmPotential: 10,
      competitionDensity: 10,
      productionFeasibility: 5,
      seriesPotential: 5,
    },
    escalateThreshold: 60,
  },

  quota: {
    maxSearchQueries: 22,
    dailyLimit: 10000,
    concurrency: 5,
  },

  history: {
    dir: path.join(__dirname, '..', 'niche-research', 'history'),
    file: 'channels.json',
    maxDays: 30,
    trendThreshold: 10,
  },

  competitors: {
    maxCompetitors: 5,
    searchesPerCompetitor: 2,
    enabled: true,
  },

  bending: {
    minScore: 60,
    maxBendsPerCandidate: 3,
  },

  competition: {
    enabled: true,
    queriesPerNiche: 3,
    minScoreForScan: 60,
    cacheDir: path.join(__dirname, '..', 'niche-research', 'competition-cache'),
    cacheTTLDays: 7,
  },

  nexlev: {
    cacheDir: path.join(__dirname, '..', 'niche-research', 'nexlev-cache'),
  },

  output: {
    dir: path.join(__dirname, '..', 'niche-research', 'daily'),
    dashboardDir: path.join(__dirname, '..', 'niche-research', 'dashboard'),
  },

  email: {
    enabled: !!process.env.RESEND_API_KEY,
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.REPORT_EMAIL,
    from: 'onboarding@resend.dev',
  },
});

module.exports = config;
