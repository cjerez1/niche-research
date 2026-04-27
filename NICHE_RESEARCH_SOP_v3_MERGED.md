# NICHE RESEARCH — SOP v3 (MERGED)

**Purpose:** Unified niche discovery and validation, merging Warnner's NexLev-wired anti-hallucination prompt with composite filter logic from SOP v2.

**Runs in two modes:**
- **DISCOVERY MODE** — cold search, find scaled winners in under-saturated niches (Warnner's use case)
- **VALIDATION MODE** — evaluate manually-found channels, catch frontier-stage opportunities (SOP v2 use case)

**Last updated:** 23 April 2026. Supersedes v1 and v2.

---

## PART A — HARD RULES (apply in both modes)

Read before any tool call:

1. **No hallucinated channels.** Every channel in output must have a real `UC…` ID from a NexLev tool call in this session. No ID = doesn't exist.
2. **No guessed revenue or RPM.** All revenue and RPM numbers must come from `get_batch_channel_metrics_v2` or raw `search_niche_finder_channels` fields. If NexLev returns null, mark null. Do not invent.
3. **Faceless must be verified.** The `isFaceless` flag in search results is starting signal only. Verify top candidates with `check_faceless_channel` before final ranking.
4. **Filtering is aggressive.** Quality over quantity. If only 4 niches pass, return 4.
5. **No training-data defaults.** Don't rely on knowledge about which niches are "hot." Source of truth is what NexLev returns today.
6. **Flag all inferences explicitly.** When NexLev data is missing and a number is inferred (e.g. RPM from top country), tag it `[INFERRED]`.

---

## PART B — DISCOVERY MODE

Use when: starting cold, looking for niches you haven't already identified manually.

### Step 1 — Filter channels

Call `search_niche_finder_channels` with this primary query:

```
query: "*"
isFaceless: true
isMonetizationEnabled: true
channelCreatedAfter: <today minus 90 days>
minAvgViewsPerVideo: 5000       // lowered from Warnner's 1M monthly
minTotalVideos: 3                // lowered from Warnner's 5
minOutlierScore: 2
isShortsOnly: false
sortBy: outlierScore (fallback: avgViewsPerVideo)
sortOrder: desc
limit: 100
```

Then run a **parallel frontier pass** to catch Dogunee-class opportunities:

```
query: "*"
isFaceless: true
channelCreatedAfter: <today minus 30 days>
minAvgViewsPerVideo: 10000       // higher bar since age is lower
minTotalVideos: 3
sortBy: avgViewsPerVideo
limit: 50
```

If primary result set is thin (<20 channels), widen primary to 120 days and note it in output.

### Step 2 — Niche validation per candidate

For surviving candidates, use Step 1 response data plus:
- Top ~20 candidates: call `get_similar_channels` (async, level=1) to map competitive landscape

For each niche, determine:

- **Saturation level** — Low / Medium / High — based on count of similar channels using same format
- **Competing channels using same format** — exact count, not vibes
- **Trend vs evergreen** — if oldest similar channel is <90 days old, it's a trend wave. If oldest is 2+ years and still growing, evergreen. If 1–2 years, mature.
- **Format archetype** — classify thumbnail style: `split-screen-comparison` / `alarm-text-overlay` / `illustrated` / `ai-rendered-scene` / `talking-head-ai-avatar` / `photorealistic-product`

Drop any niche where saturation is High AND the channel isn't materially differentiated.

### Step 3 — Monetization analysis

For surviving candidates (~15), call `get_batch_channel_metrics_v2` (async, batches of 10, then poll `get_batch_channel_metrics_status`). Extract:

- RPM (actual from NexLev, not estimated)
- Monthly revenue (actual, with low/mid/high by seasonality)
- Top country → sanity-check RPM range
- Monetization status confirmed

Classify monetization type: AdSense / Affiliate / Digital product / Lead gen / Hybrid.

If RPM is null, infer from top country (US/UK/AU/CA high; global mixed mid; tier-3 low) and tag `[INFERRED]`.

### Step 4 — Composite filter screening

Apply tiered thresholds:

| Tier | Median v/vid | Action |
|---|---|---|
| Entry floor | ≥ 5,000 | Include, tag "emerging" |
| Strong signal | ≥ 10,000 | Shortlist |
| Hot / urgent | ≥ 25,000 | Immediate workup |
| Frontier | ≥ 50,000 | Start within 7 days or lose window |

Calculate and tag each channel:
- **Outlier ratio** (`max_views ÷ median_views`): accept 3x–30x, reject outside
- **Sub-to-view ratio** (`views ÷ subs`): flag `>100x` as browse-virality signal
- **Channel age bucket**: Frontier (0–30d) / Early (30–90d) / Established (90–180d) / Mature (180d+)
- **Upload cadence**: active (<7d) / slowing (7–30d) / dormant (reject)
- **Pivot flag**: if join date >1yr ago BUT first video <180d → `isRecentPivot=true`

### Step 5 — Red-flag overrides (reject despite metrics)

Reject if:
- YPP policy risk high (medical claims without disclaimer, unlicensed likeness, election misinformation, COVID-adjacent)
- Trademark/defamation risk (attacking named brands without evidentiary backing)
- Single-hit outlier >30x (unreplicable)
- Sub conversion <0.1% (algorithm loaning traffic with no retention)
- Presenter-dependent format (whole format relies on specific face/personality — faceless clone impossible)

### Step 6 — Opportunity scoring (Warnner's weighted formula)

Score 1–10 per niche. Weights:

| Criterion | Weight |
|---|---|
| Monetization strength | 30% |
| Scalability (run 3+ channels in niche?) | 25% |
| Longevity (evergreen vs trend-burn) | 20% |
| Ease of replication (production pipeline complexity) | 15% |
| Content production simplicity (VO+stock vs complex editing) | 10% |

### Step 7 — Content strategy per final pick

For each opportunity making the final list:

- **Exact content format** — hook beats, middle structure, CTA, length target
- **3 high-CTR video titles** — curiosity-gap style, no clickbait lies. Before locking, check via `search_videos` with the title keyword — if already a top-performer on competing channel, flag and offer alternative.
- **Hook style** — first 5–10 seconds concept
- **Thumbnail archetype** — from Step 2 classification

### Step 8 — Output format

Return top 10 best opportunities maximum. Pad to fewer if quality doesn't support 10. For each:

1. Rank
2. Niche name
3. Example channel (name + `https://www.youtube.com/channel/<channelId>`)
4. Channel age (days since first upload) + age bucket
5. Monthly views (exact from NexLev)
6. Estimated monthly revenue ($) — low / mid / high from real RPM
7. RPM (real value, flag `[INFERRED]` if not)
8. Saturation level + count of competing channels using same format
9. Format archetype tag
10. Trend vs evergreen classification
11. Opportunity score (1–10) + one-line weighted breakdown
12. Sub-to-view ratio flag if notable
13. Pivot flag if applicable
14. Why this works (2–3 sentences sharp insight)
15. 3 video titles to start
16. Content format breakdown (hook beat, middle structure, CTA, length target)
17. Red flags (if any)
18. Kill-criteria for post-launch (3 measurable thresholds)

---

## PART C — VALIDATION MODE

Use when: a channel has been found manually (browsing, tip, competitor find). Input is a channel URL. Output is a full clone-worthiness verdict.

### Step 1 — Resolve and pull analytics

1. `channel_resolver` → channelId
2. `get_channel_analytics` → subs, total views, video count, days since start, country, avg length, categories, tags
3. `get_geography_revenue` → top country, RPM, monthly revenue, audience demographics
4. `youtube_channel_outliers` or `youtube_channel_videos` → top 10 videos by views, publish dates

### Step 2 — Calculate composite signals

- Median views per video (NOT mean)
- Outlier ratio (max ÷ median)
- Sub-to-view ratio
- Upload cadence (days between last 5 uploads)
- Channel age bucket
- `isRecentPivot` check
- Format archetype classification

### Step 3 — Saturation check

`get_similar_channels` (async, level=2). From results, extract:
- Number of channels in same format + driver
- Number under 180 days old
- Identify the "scaled reference" (category winner, usually 90–180 days old) — is the frontier still open?
- Classify: WIDE OPEN / EARLY / COMPETITIVE / SATURATED

### Step 4 — Clone-worthiness verdict

Score against composite filters from Part B Step 4 AND red-flag overrides from Step 5. Assign tier: Frontier / Hot / Strong / Entry / Reject.

### Step 5 — Clone-with-differentiation workup (if Strong or higher)

Trigger the Clone-With-Differentiation sub-prompt:

- Decode 5 signals: format, emotional driver, subject core, audience, replicability 1–10
- Propose 3 differentiation paths (ranked by ROI, change at least one layer)
- Generate 10-idea starter calendar using the original's title formula, new subject
- Fit check against existing portfolio (Voidscape / Dark Atlas / Aussie Exposed / Foodflip / Crisis Alert / The $1 Fix) — bolt-on or new launch?
- Pre-committed kill-criteria

---

## PART D — NEXLEV QUERY PRESETS (reusable)

### Preset: Discovery (default)
```
query: "*"
isFaceless: true
isMonetizationEnabled: true
channelCreatedAfter: <today - 90 days>
minAvgViewsPerVideo: 5000
minTotalVideos: 3
minOutlierScore: 2
isShortsOnly: false
sortBy: outlierScore
limit: 100
```

### Preset: Frontier (parallel with Discovery)
```
query: "*"
isFaceless: true
channelCreatedAfter: <today - 30 days>
minAvgViewsPerVideo: 10000
minTotalVideos: 3
sortBy: avgViewsPerVideo
limit: 50
```

### Preset: Scaled-winner audit
```
query: "*"
isFaceless: true
isMonetizationEnabled: true
minMonthlyViews: 1000000
minAvgViewsPerVideo: 25000
channelCreatedAfter: <today - 180 days>
minTotalVideos: 10
sortBy: monthlyRevenue
limit: 50
```

### Preset: Australian opportunity scan
```
query: "*"
isFaceless: true
location: "AU"
channelCreatedAfter: <today - 180 days>
minAvgViewsPerVideo: 5000
sortBy: outlierScore
limit: 50
```

Run geo-neutral by default. Regional presets only when local-advantage is being sought.

---

## PART E — NICHE BENDING INTEGRATION

Use when: a niche or channel has cleared screening and the decision is HOW to differentiate before launch. This is where the "Art of YouTube" Niche Bend SOP plugs in.

### When to bend (vs. straight clone)

| Saturation level | Recommended action |
|---|---|
| WIDE OPEN | Straight format clone, change subject only |
| EARLY | Format clone + driver retention + subject shift |
| COMPETITIVE | Niche bend mandatory — change 2 of 3 layers |
| SATURATED | Niche bend + new audience repositioning, OR skip |

### Bend axes (pick 1 or 2 to flex)

1. **Subject axis** — same format, different vertical (Dogunee dog → Dogunee cat / horse / parrot)
2. **Demographic axis** — same format, narrower or wider age band (general senior health → arthritis-after-60 / heart-after-55)
3. **Geographic axis** — same format, regional reframe (Forgotten American Survival → Forgotten Australian / British)
4. **Emotional driver axis** — same subject, different driver (homestead skills "government hiding" → homestead skills "your grandparents were smarter")
5. **Format archetype axis** — same subject + driver, different visual style (AI-photo thumbnails → illustrated)

**Rule:** never bend all 5 at once. That's a new channel, not a bend. 1–2 axes max.

### Bend output (mandatory before production approval)

For each bent niche:
- Source channel + signal stack (format, driver, subject, audience, archetype)
- Bent version + which axes flexed + why
- Predicted overlap risk with source (low / medium / high)
- Why algorithm will treat as separate lane (suggested-feed analysis)

Hand off to existing Niche Bend Channel Description SOP for the full 10-section workup once axes are chosen.

---

## PART F — CHANNEL LAUNCH DASHBOARD (output deliverable)

When a niche/channel passes screening AND niche bending, generate a complete launch package. This replaces the scattered "here's some video ideas" output with a production-ready dashboard.

### F1 — Channel identity

- Channel name (3 candidates, ranked)
- Handle availability check (note: requires manual YouTube check)
- One-line positioning ("X for Y who Z")
- Channel description (50-word version + 250-word version)
- Banner concept + avatar concept
- Voice/avatar stack: ElevenLabs voice ID / HeyGen avatar / illustrated

### F2 — Title formula bank

- Source channel's title template, deconstructed
- 5 working variations of the template for the bent niche
- Banned phrases (anything too close to source's exact wording)

### F3 — Thumbnail style guide

- Archetype tag (from Part B Step 2)
- Color palette (3 hex codes)
- Text overlay rules (position, font weight, max words)
- Subject framing rules
- One reference image description per thumbnail variant
- Differentiator from source's thumbnails (so they're not algorithmically grouped)

### F4 — Content calendar (4-week launch window)

Table format:

| Week | Day | Title | Hook beat | Thumbnail concept | Length target | Production owner |
|---|---|---|---|---|---|---|

Minimum 8 videos for a 4-week launch (2/week pacing). 12 videos preferred (3/week).

### F5 — Posting schedule

- Days of week + time slot (in target audience timezone)
- Cadence recommendation based on channel age:
  - Days 1–14: 2 videos/week (warmup, give algorithm signal)
  - Days 15–60: 3 videos/week (growth window)
  - Days 60+: hold cadence or scale to 4–5/week if metrics support
- Trust score warmup checkpoints (tie to existing Channel Trust Score SOP v2)

### F6 — Hook bank

- 10 opening hooks (5–10 second concepts) using source's emotional driver
- Each hook tagged with which video in the calendar it fits

### F7 — Production stack

- Voiceover: ElevenLabs voice + emotion tag style
- Visual: HeyGen / AI-imagery / stock / illustrated
- Editing: which editor on team (Philippines or Zimbabwe)
- Estimated production hours per video
- Estimated cost per video (voice + visual + editor labor)

### F8 — Monetization plan

- Primary: AdSense (RPM target from source channel data)
- Secondary: affiliate vertical match (supplement / book / SaaS / lead-gen)
- Tertiary: digital product hypothesis (if applicable)

### F9 — Kill-criteria checkpoint table

Pre-committed thresholds with check-by dates (from Part G).

---

## PART G — COMPETITOR WATCHLIST (ongoing tracking)

One-shot niche research is wasted without a tracking layer. Once a channel is launched in a niche, maintain a watchlist of 5–10 reference channels and re-check weekly.

### G1 — Watchlist setup per launched channel

Create a tracking table for each cloned channel. Required fields per tracked competitor:

- Channel name + URL + channelId
- Role: source-clone / direct-competitor / category-leader / wildcard
- Date added to watchlist
- Snapshot at add: subs, total views, video count, channel age, top format
- Avg uploads/week
- Top 3 thumbnail archetypes used
- Title formula(s) currently winning
- Last upload date

### G2 — Weekly check (every Monday)

For each tracked channel:
- New videos this week + view counts
- Outlier videos (views >3x median) — flag the title/thumbnail/topic
- Format changes (did they switch thumbnail style? title formula? video length?)
- Cadence changes (uploading more or less than baseline?)
- Pivot signals (subject matter shifts, demographic shifts)

Tool sequence:
1. `youtube_channel_videos` (last 7 days) per tracked channel
2. `youtube_channel_outliers` if any video >3x median
3. Compare to last week's snapshot

### G3 — Monthly format-evolution review (every 4th week)

- Which competitors leveled up (production quality, new format)?
- Which competitors stagnated or declined?
- Has a new entrant scaled past 3x our channel's avg views? If yes, add to watchlist.
- Has anyone in the watchlist died (no uploads in 30 days)? Remove.

### G4 — Title/thumbnail intelligence layer

Maintain rolling lists per niche:

- **Winning titles** — any video from watchlist with views >2x channel median, copy template structure (not exact words)
- **Winning thumbnails** — same threshold, save URL + archetype tag
- **Losing experiments** — titles/thumbnails that underperformed, mark as "do not replicate"

This becomes a feed for MUSE — when ideating new videos, MUSE pulls from the winning titles bank and adapts to the bent niche, rather than ideating cold.

---

## PART H — KILL-CRITERIA (post-launch, per cloned channel)

Record at launch, not after. Every cloned channel must have:

- Video 6: median views <2,000 → pause, reassess
- Video 10: subscriber growth <100/week → kill or pivot
- Video 15: total channel views <50,000 → kill
- CPM <USD 2.00 after first 100k views → reassess monetization fit

---

## PART I — EXECUTION CHECKLIST

Before returning output, verify:

- [ ] Every channel has a real `UC…` ID from a tool call in this session
- [ ] Every RPM and revenue figure traces to a NexLev tool response (or is tagged `[INFERRED]`)
- [ ] Faceless status verified via `check_faceless_channel` for the final picks
- [ ] Saturation calls backed by similar-channel counts, not vibes
- [ ] Format archetype tagged per channel
- [ ] Pivot flag checked per channel
- [ ] Red-flag overrides applied
- [ ] Niche bend axes selected (Part E) — at least 1 axis flexed for COMPETITIVE saturation, 2 for SATURATED
- [ ] Launch dashboard generated (Part F) — all 9 sub-sections
- [ ] Competitor watchlist initialized (Part G) — minimum 5 channels per launch
- [ ] No training-data channel names in output
- [ ] If fewer than 10 niches passed, output has fewer than 10 entries
- [ ] Kill-criteria attached to every final recommendation

---

## APPENDIX — Resolved gaps from v2 field test

| Gap | v2 behavior | v3 behavior |
|---|---|---|
| Hallucinated channels | Not explicitly blocked | Part A rule 1 — hard reject |
| RPM fabrication | Not addressed | Part A rule 2 + batch metrics v2 step |
| Faceless claim unverified | Assumed from NexLev flag | `check_faceless_channel` required for finals |
| No weighted score | Tier-only | Warnner's 30/25/20/15/10 formula |
| No content strategy output | Separate prompt | Integrated Step 7 |
| 90-day age cutoff | — | Kept for discovery, age-bucketed for validation |
| Missing Dogunee-class channels | Filters excluded them | Frontier preset catches 0–30d window |
| Food Tell-class reused channels | Missed | Pivot flag in Step 4 |
| No trend vs evergreen | — | Step 2 classification |
| No execution checklist | — | Part I |
| Niche bending not wired | Standalone SOP | Part E — integrated decision matrix |
| Dashboard outputs scattered | Ad-hoc | Part F — 9-section launch package |
| Competitor tracking one-shot | — | Part G — weekly + monthly cadence |
| Title/thumbnail intelligence | — | Part G4 — rolling winners bank feeds MUSE |
