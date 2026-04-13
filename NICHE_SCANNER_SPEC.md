# NICHE SCANNER SPECIFICATION
_For Claude Code to build. Read CLAUDE.md first for full business context._
_April 2026_

---

## PURPOSE

This is the single highest-priority automation in the business. Build a system that runs daily, scans for breakout faceless YouTube channel opportunities, scores them, suggests niche bends, and outputs a ranked shortlist Claudio reviews each morning.

**Why this matters:** Finding the right niche 2 weeks before competitors is worth more than any production optimization. Every day without this scanner is a day Claudio is doing manual research that could be automated.

---

## WHAT THE SCANNER DOES

### Daily Cycle
1. **SCAN** — Find new faceless YouTube channels matching criteria
2. **SCORE** — Rate each opportunity on a weighted scoring model
3. **BEND** — Suggest niche-bending angles for top opportunities
4. **OUTPUT** — Produce a ranked daily report as markdown

### Scan Frequency
- Run once daily (can be triggered manually or via cron)
- Full scan should complete in under 10 minutes
- Output saved to `/niche-research/daily/YYYY-MM-DD.md`

---

## SCAN CRITERIA

### Channel Filters (Hard Requirements)
Every channel surfaced must meet ALL of these:

| Criteria | Threshold | Notes |
|----------|-----------|-------|
| Channel age | Under 60 days old | Ideal: under 30 days. Under 60 acceptable. |
| Subscribers | Under 10,000 | Sweet spot: 500-5,000 with rapid growth |
| Consistent views | Multiple videos with views, not just one outlier | At least 3 videos with 1K+ views |
| Faceless format | No face on camera | Must be producible without a human presenter |
| English language | Primary content in English | US audience preferred, AU secondary |
| Upload frequency | At least 2 videos/week | Shows active operation, not abandoned test |

### Channel Signals (Soft Scoring — See Scoring Model Below)
| Signal | What It Indicates |
|--------|-------------------|
| Outlier video (10x+ channel average) | Topic/format resonance |
| Rapid subscriber growth (100+/day) | Algorithm pushing the channel |
| High view-to-sub ratio | Content quality exceeding brand recognition |
| Short channel history + strong metrics | Fresh niche, not saturated |
| Multiple channels in same niche appearing | Niche is heating up — could be opportunity OR saturation |
| Comment volume and engagement | Real audience, not bot traffic |

---

## SCANNING METHODS

### Method 1: YouTube Search API
Search for recently published videos in target niche categories.

**Search parameters:**
- `publishedAfter`: 30 days ago
- `type`: video
- `order`: viewCount
- `videoDuration`: medium or long (4+ minutes)
- `relevanceLanguage`: en
- `regionCode`: US

**Search queries to rotate through daily (examples):**
```
faceless documentary, explained documentary, history of, 
the truth about, what happened to, why does, how did,
hidden history, forgotten, abandoned, mysterious,
home hacks, life hacks, food exposed, health warning,
earth science, natural disaster, space documentary,
ancient, lost civilization, consumer warning, product review
```

**For each video found:**
- Get channel ID
- Check channel age (creation date)
- Check subscriber count
- Check total video count
- If channel passes hard filters → add to candidate list

### Method 2: YouTube Trending / Browse Monitoring
- Monitor YouTube trending in relevant categories
- Track which new small channels appear in suggested videos alongside established competitors
- Note: This may require browser automation or manual seeding

### Method 3: Social Blade / Socialblade API
- Scan for channels with rapid growth in last 7 days
- Filter by subscriber range (100-10,000)
- Filter by category

### Method 4: Competitor Suggested Video Mining
- For each known competitor channel in our portfolio, check "suggested videos" sidebar
- New small channels appearing alongside established ones = algorithm is testing them
- These are high-signal opportunities

### Method 5: VidIQ / Keyword Opportunity Scanner
- Search for keywords with high search volume but low competition
- Cross-reference with existing channel landscape
- Flag keywords where top-ranking videos are from channels under 6 months old

---

## SCORING MODEL

Every candidate channel gets scored on this weighted model. Maximum score: 100.

### Scoring Criteria

| Criteria | Max Points | Weight | How To Score |
|----------|-----------|--------|-------------|
| **Click Potential** | 15 | x3 | Would you click these titles/thumbnails? Rate title quality, curiosity gap, emotional hook |
| **Watch-Time Potential** | 15 | x3 | Can this niche sustain 8+ minute videos? Is the topic deep enough? |
| **RPM Potential** | 10 | x2 | What advertisers would bid on this content? Health/finance/tech = high. Entertainment = low |
| **Competition Density** | 10 | x2 | How many similar faceless channels exist? Fewer = better |
| **Production Feasibility** | 5 | x1 | Can this be produced with AI voiceover + stock/generated footage? |
| **Series Potential** | 5 | x1 | Can this become 50+ videos without topic exhaustion? |

**Total = Sum of (score × weight) normalized to 100**

### Auto-Escalate Triggers
Flag immediately if any of these are true:
- Channel under 14 days old with a video over 100K views
- Channel under 30 days old with 3+ videos over 50K views each
- New niche cluster: 3+ unrelated channels appearing in same niche within 30 days
- RPM niche (health, finance, legal, tech) with under 5 faceless competitors

### Auto-Reject Triggers
Skip immediately if any of these are true:
- Channel shows face on camera (not faceless)
- Niche requires licensed footage that can't be generated (sports highlights, movie clips)
- Content is in a language other than English
- Channel appears to be reupload/stolen content
- Niche is explicitly listed in saturated-niches list (see below)

---

## NICHE BENDING ENGINE

For every opportunity scoring 60+, the scanner should suggest 2-3 niche bends.

### Niche Bending Logic
A niche bend combines:
- **Format transfer:** Take a winning format from Niche A, apply it to Niche B
  - Example: "The $1 Fix" format (cheap solution + expensive problem) applied to gardening
- **Audience cross-pollination:** Take Niche A's topic, target Niche B's audience
  - Example: Space documentary content targeted at survivalist/prepper audience
- **Emotional reframe:** Same topic, different emotional hook
  - Example: "History of X" → "Why X Was Banned" (curiosity → outrage)
- **Geographic localization:** US-proven format adapted for AU audience
  - Example: US food safety exposé → Australian supermarket exposé (already proven with Aussie Exposed)
- **Hybrid topic:** Two niches merged into one channel identity
  - Example: Pest control + gardening hybrid (shared audience, shared advertiser base)

### Bend Output Format
For each suggested bend:
```markdown
**Bend:** [Description]
**Base niche:** [What it's borrowing from]
**Target niche:** [Where it's being applied]
**Why it works:** [1-2 sentences]
**Example titles:** [3 title examples in the bent format]
**Estimated competition:** [Low/Medium/High]
**RPM estimate:** [$/1000 views range]
```

---

## SATURATED NICHES LIST (Auto-Reject)

These niches are known to be oversaturated for faceless channels as of April 2026. Do not surface opportunities in these unless they show an extremely strong differentiator:

- War/military documentary (generic)
- True crime (generic format)
- Planet profiles / "This is [Planet]" format
- Generic motivational/self-help
- AI news commentary
- Cryptocurrency explainers (generic)
- Top 10 / countdown format (generic)
- Reaction content
- Reddit story narration

**Note:** A niche-bent version of any of these CAN be valid. "War documentary" is saturated. "Engineering failures of WWII" might not be. The scanner should distinguish between generic and specific.

---

## OUTPUT FORMAT

### Daily Report: `/niche-research/daily/YYYY-MM-DD.md`

```markdown
# Niche Scanner Report — [Date]
_Scan completed: [timestamp]_
_Channels scanned: [number]_
_Candidates found: [number]_
_Opportunities scored 60+: [number]_

---

## TOP OPPORTUNITIES (Ranked by Score)

### 1. [Opportunity Name / Niche Description]
**Score:** [X/100]
**Example channel:** [Channel name] ([subscriber count], [age])
**Key metrics:** [views, upload frequency, growth rate]
**Why it scored high:** [2-3 sentences]
**Niche bends:**
- [Bend 1]
- [Bend 2]
**Recommended action:** [Test immediately / Monitor / Research further]
**Estimated RPM range:** [$X-$Y]

### 2. [Next opportunity...]

---

## SIGNALS TO WATCH
- [Emerging patterns not yet scoring high enough]
- [Niches showing early movement]

## REJECTED TODAY
- [Channels that were scanned but failed criteria, with reason]
```

---

## TECHNICAL REQUIREMENTS

### APIs Needed
| API | Key Required | Purpose |
|-----|-------------|---------|
| YouTube Data API v3 | Yes (Google API key) | Channel data, video data, search |
| Social Blade | Optional (scraping fallback) | Growth metrics |

### Dependencies
- Node.js runtime
- YouTube Data API quota: 10,000 units/day (free tier)
- File system access for output reports

### Project Structure
```
/niche-scanner/
  src/
    scanner/
      youtube-search.js     # YouTube API search module
      channel-analyzer.js   # Channel metrics extraction
      competitor-mining.js  # Suggested video analysis
    scoring/
      opportunity-scorer.js # Weighted scoring model
      auto-triggers.js      # Auto-escalate and auto-reject
    bending/
      niche-bender.js       # Niche bending suggestion engine
    output/
      report-generator.js   # Markdown report builder
  data/
    saturated-niches.json   # Auto-reject list
    search-queries.json     # Rotating search query bank
    geo-priority.json       # Country priority for audience scoring
  config/
    config.js               # API keys, thresholds, scan parameters
  index.js                  # Main entry point
  package.json
```

### Build Phases
**Phase 1 (Build First):** YouTube search → channel filter → basic scoring → markdown output
**Phase 2:** Add niche bending engine
**Phase 3:** Add competitor suggested video mining
**Phase 4:** Add historical tracking (compare today's scan to yesterday's)
**Phase 5:** Add Social Blade integration for growth velocity data

### Running
```bash
# Manual run
node index.js

# Or via npm
npm run scan

# Schedule via cron for daily 6am run
0 6 * * * cd /path/to/niche-scanner && node index.js
```

---

## SUCCESS CRITERIA

The scanner is working when:
1. Claudio reviews a ranked shortlist over coffee each morning
2. At least 1 actionable opportunity is surfaced per week
3. Opportunities found by scanner lead to channel launches within 72 hours
4. Manual niche research time drops from hours/day to minutes/day
5. False positive rate (opportunities that score high but are actually bad) stays under 30%

---

## IMPORTANT CONTEXT

Read `CLAUDE.md` for:
- Full business context and financial pressure
- Trust score testing protocol (what happens AFTER a niche is selected)
- Channel file architecture (where new channel configs get created)
- Script generation rules (for when a niche progresses to content production)
- Team structure (who does what after scanner surfaces an opportunity)

The scanner's job is to answer ONE question every morning:
**"What should Claudio launch next, and why?"**
